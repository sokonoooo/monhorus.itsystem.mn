import type { PermissionKey } from '@monhorus/shared';
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';

import type { AuthContext } from '../types/express';
import { AppError } from '../errors/app-error';
import {
  assertInCustomerScope,
  customerScopeFilter,
  resolveCustomerScope,
  resolveOwnerCustomerId,
} from './customer-scope';

/**
 * The customer security boundary.
 *
 * These are the tests for the one place that decides which tenant a request may touch.
 * Everything else trusts this file, so its behaviour is pinned directly rather than only
 * through the endpoints that call it.
 */

const CUSTOMER_A = '507f1f77bcf86cd799439011';
const CUSTOMER_B = '507f1f77bcf86cd799439012';

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: '507f1f77bcf86cd799439001',
    email: 'someone@test.mn',
    fullName: 'Тест хэрэглэгч',
    role: 'admin',
    customerId: null,
    employeeId: null,
    roleIds: [],
    permissions: new Set<PermissionKey>(),
    ...overrides,
  };
}

describe('resolveCustomerScope', () => {
  it('binds a customer to their own organisation', () => {
    const scope = resolveCustomerScope(auth({ role: 'customer', customerId: CUSTOMER_A }));

    expect(scope).toEqual({ mode: 'CUSTOMER', customerId: CUSTOMER_A });
  });

  /**
   * The vulnerability this whole change exists to close: a customerId in the request used to
   * be honoured for everyone.
   */
  it('ignores a customer id the customer supplied themselves', () => {
    const scope = resolveCustomerScope(
      auth({ role: 'customer', customerId: CUSTOMER_A }),
      CUSTOMER_B,
    );

    expect(scope).toEqual({ mode: 'CUSTOMER', customerId: CUSTOMER_A });
  });

  /**
   * Refused rather than defaulted. Defaulting to no filter would expose every tenant;
   * defaulting to match-nothing would look like an empty account and hide the
   * misconfiguration from the administrator who has to fix it.
   */
  it('refuses a customer account with no organisation', () => {
    expect(() => resolveCustomerScope(auth({ role: 'customer', customerId: null }))).toThrow(
      AppError,
    );

    try {
      resolveCustomerScope(auth({ role: 'customer', customerId: null }));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as AppError).statusCode).toBe(403);
      expect((error as AppError).message).toContain('холбогдоогүй');
    }
  });

  it('leaves staff unscoped when they ask for nothing', () => {
    expect(resolveCustomerScope(auth({ role: 'admin' }))).toEqual({ mode: 'STAFF' });
  });

  it('honours a customer filter for staff', () => {
    expect(resolveCustomerScope(auth({ role: 'admin' }), CUSTOMER_B)).toEqual({
      mode: 'STAFF',
      customerId: CUSTOMER_B,
    });
  });

  /** A staff account carrying a stale link must not be silently confined by it. */
  it('does not confine staff to a customer link that should not be there', () => {
    expect(resolveCustomerScope(auth({ role: 'technician', customerId: CUSTOMER_A }))).toEqual({
      mode: 'STAFF',
    });
  });
});

describe('customerScopeFilter', () => {
  it('produces a concrete predicate for a customer', () => {
    const filter = customerScopeFilter({ mode: 'CUSTOMER', customerId: CUSTOMER_A });

    expect(filter.customer).toBeInstanceOf(Types.ObjectId);
    expect(String(filter.customer)).toBe(CUSTOMER_A);
  });

  it('produces no predicate for unscoped staff, preserving their existing access', () => {
    expect(customerScopeFilter({ mode: 'STAFF' })).toEqual({});
  });

  it('produces a predicate for staff who filtered by customer', () => {
    expect(String(customerScopeFilter({ mode: 'STAFF', customerId: CUSTOMER_B }).customer)).toBe(
      CUSTOMER_B,
    );
  });
});

describe('assertInCustomerScope', () => {
  it('passes a record the customer owns', () => {
    expect(() =>
      assertInCustomerScope({ mode: 'CUSTOMER', customerId: CUSTOMER_A }, CUSTOMER_A),
    ).not.toThrow();
  });

  /**
   * Not-found rather than forbidden, deliberately. A forbidden reply for an id that exists in
   * another tenant confirms the record is real, which turns any detail endpoint into an
   * oracle for probing other organisations' identifiers.
   */
  it('reports another tenant record as not found, never as forbidden', () => {
    try {
      assertInCustomerScope({ mode: 'CUSTOMER', customerId: CUSTOMER_A }, CUSTOMER_B);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as AppError).statusCode).toBe(404);
      expect((error as AppError).statusCode).not.toBe(403);
    }
  });

  it('treats a record with no owner as not found for a customer', () => {
    expect(() =>
      assertInCustomerScope({ mode: 'CUSTOMER', customerId: CUSTOMER_A }, null),
    ).toThrow(AppError);
  });

  it('lets staff through regardless of owner', () => {
    expect(() => assertInCustomerScope({ mode: 'STAFF' }, CUSTOMER_B)).not.toThrow();
    expect(() => assertInCustomerScope({ mode: 'STAFF' }, null)).not.toThrow();
  });

  it('accepts an ObjectId as readily as a string', () => {
    expect(() =>
      assertInCustomerScope(
        { mode: 'CUSTOMER', customerId: CUSTOMER_A },
        new Types.ObjectId(CUSTOMER_A),
      ),
    ).not.toThrow();
  });
});

describe('resolveOwnerCustomerId', () => {
  it('owns a new record to the customer themselves', () => {
    expect(resolveOwnerCustomerId({ mode: 'CUSTOMER', customerId: CUSTOMER_A }, undefined)).toBe(
      CUSTOMER_A,
    );
  });

  it('accepts a customer naming their own organisation', () => {
    expect(resolveOwnerCustomerId({ mode: 'CUSTOMER', customerId: CUSTOMER_A }, CUSTOMER_A)).toBe(
      CUSTOMER_A,
    );
  });

  /**
   * Refused rather than quietly rewritten, so a client sending the wrong owner learns it is
   * wrong instead of having it changed underneath them.
   */
  it('refuses a customer creating a record for another organisation', () => {
    try {
      resolveOwnerCustomerId({ mode: 'CUSTOMER', customerId: CUSTOMER_A }, CUSTOMER_B);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as AppError).statusCode).toBe(403);
    }
  });

  it('lets staff name the owner', () => {
    expect(resolveOwnerCustomerId({ mode: 'STAFF' }, CUSTOMER_B)).toBe(CUSTOMER_B);
  });

  it('makes staff name one rather than defaulting', () => {
    expect(() => resolveOwnerCustomerId({ mode: 'STAFF' }, null)).toThrow(AppError);
  });
});
