import { Types } from 'mongoose';

import type { AuthContext } from '../types/express';
import { AppError } from '../errors/app-error';
import { ERROR_CODES } from '../errors/error-codes';

/**
 * The customer security boundary.
 *
 * Every customer-owned read and write resolves its tenant here and nowhere else. The rule
 * this file exists to enforce is simple and absolute: for a customer account the tenant
 * comes from the authenticated account, never from the request. A `customerId` in a query
 * string, a path or a body is a filter for staff and is ignored outright for a customer.
 *
 * Before this existed, `customerId` was a filter for everyone, so any authenticated caller
 * who sent another organisation's id received that organisation's records. The predicate is
 * cheap because `customer` is already denormalised and indexed on every owned collection.
 */

export type ResolvedCustomerScope =
  | { mode: 'CUSTOMER'; customerId: string }
  | { mode: 'STAFF'; customerId?: string };

/**
 * Resolves the scope for the authenticated caller.
 *
 * `requested` is whatever the client asked to filter by. It is honoured for staff and
 * discarded for a customer, which is the whole point: passing it in is safe by construction,
 * so callers do not have to remember to withhold it.
 */
export function resolveCustomerScope(
  auth: AuthContext,
  requested?: string | null,
): ResolvedCustomerScope {
  if (auth.role === 'customer') {
    if (!auth.customerId) {
      // A customer account with no organisation cannot be scoped, so it is refused rather
      // than defaulted. Defaulting to "no filter" would expose every tenant; defaulting to
      // "match nothing" would look like an empty account and hide a misconfiguration that
      // an administrator has to fix.
      throw AppError.forbidden(
        ERROR_CODES.FORBIDDEN,
        'Таны бүртгэл харилцагч байгууллагад холбогдоогүй байна. Админд хандана уу.',
      );
    }
    return { mode: 'CUSTOMER', customerId: auth.customerId };
  }

  return requested ? { mode: 'STAFF', customerId: requested } : { mode: 'STAFF' };
}

/**
 * The Mongo predicate for a scope, to be spread into a filter.
 *
 * Staff without a requested customer get `{}`, which preserves their existing cross-tenant
 * access exactly. A customer always gets a concrete `customer` match.
 */
export function customerScopeFilter(scope: ResolvedCustomerScope): { customer?: Types.ObjectId } {
  const id = scope.mode === 'CUSTOMER' ? scope.customerId : scope.customerId;
  if (!id) return {};
  return { customer: new Types.ObjectId(id) };
}

/**
 * Asserts a record the caller already fetched belongs to their scope.
 *
 * Reported as not-found rather than forbidden. Telling a caller "forbidden" for an id that
 * exists in another tenant confirms that the record is real, which turns a detail endpoint
 * into an oracle for probing other organisations' identifiers. Staff scope permits
 * everything, so their behaviour is unchanged.
 */
export function assertInCustomerScope(
  scope: ResolvedCustomerScope,
  recordCustomerId: Types.ObjectId | string | null | undefined,
  message = 'Хүссэн мэдээлэл олдсонгүй.',
): void {
  if (scope.mode === 'STAFF') return;
  if (recordCustomerId && String(recordCustomerId) === scope.customerId) return;
  throw AppError.notFound(ERROR_CODES.NOT_FOUND, message);
}

/**
 * The customer a newly created record must belong to.
 *
 * For a customer the answer is their own organisation and a mismatching request is refused
 * outright rather than quietly rewritten, so a client sending the wrong id learns it is
 * wrong instead of silently having it changed underneath them.
 */
export function resolveOwnerCustomerId(
  scope: ResolvedCustomerScope,
  requested: string | null | undefined,
): string {
  if (scope.mode === 'CUSTOMER') {
    if (requested && requested !== scope.customerId) {
      throw AppError.forbidden(
        ERROR_CODES.FORBIDDEN,
        'Өөр харилцагчийн нэр дээр бүртгэл үүсгэх боломжгүй.',
      );
    }
    return scope.customerId;
  }

  if (!requested) {
    throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Харилцагч заавал сонгоно.', [
      { field: 'customerId', message: 'Харилцагч заавал сонгоно.' },
    ]);
  }
  return requested;
}
