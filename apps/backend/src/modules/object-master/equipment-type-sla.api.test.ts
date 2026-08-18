import { PERMISSIONS } from '@monhorus/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createCallableObjectType,
  createObjectFixture,
  createUserWithPermissions,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
  type ObjectFixture,
} from '../../test/helpers';
import { ObjectType } from './object-master.models';

const API = '/api/v1';

let app: Express;
let token: string;
let fixture: ObjectFixture;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  return response.body.data.tokens.accessToken as string;
}

function callBody(objectTypeId: string, overrides: Record<string, unknown> = {}) {
  return {
    customerId: fixture.customerId,
    buildingId: fixture.buildingId,
    requestType: 'STANDARD_CALL',
    objectTypeId,
    isUrgent: false,
    description: 'Гэрэл асахгүй байна',
    contactName: 'Б. Болд',
    contactPhone: '9911-2233',
    ...overrides,
  };
}

/**
 * The SLA window now comes from the equipment type rather than from the urgency flag, and
 * a type may only be called about when an administrator has said so and supplied hours.
 *
 * These cover the rule itself. The point of most of them is that the backend holds the line
 * on its own: the call forms only ever list callable types, but a filtered list is a
 * convenience for whoever is looking at it, not a constraint on what can be posted.
 */
describe('Equipment type SLA', () => {
  beforeAll(async () => {
    app = await startTestApp();
  });
  afterAll(async () => {
    await stopTestApp();
  });
  beforeEach(async () => {
    await resetDomainCollections();
    fixture = await createObjectFixture();
    const user = await createUserWithPermissions('sla@test.mn', [
      PERMISSIONS.SERVICE_REQUEST_CREATE,
      PERMISSIONS.SERVICE_REQUEST_VIEW,
      PERMISSIONS.OBJECT_TYPE_MANAGE,
      PERMISSIONS.OBJECT_MASTER_VIEW,
    ]);
    token = await login(user.email, user.password);
  });

  describe('the window a call receives', () => {
    it('uses the hours configured on the equipment type', async () => {
      const typeId = await createCallableObjectType({ callSlaHours: 24, name: 'Гэрэл' });

      const response = await request(app)
        .post(`${API}/service-requests`)
        .set('Authorization', `Bearer ${token}`)
        .send(callBody(typeId));

      expect(response.status).toBe(201);
      const started = new Date(response.body.data.slaStartedAt).getTime();
      const due = new Date(response.body.data.slaDueAt).getTime();
      expect(Math.round((due - started) / (60 * 60 * 1000))).toBe(24);
    });

    /** The worked example the rule was specified with: a light is a day, a socket is six hours. */
    it('gives different types different windows', async () => {
      const light = await createCallableObjectType({ callSlaHours: 24, name: 'Гэрэл' });
      const socket = await createCallableObjectType({ callSlaHours: 6, name: 'Автомат залгуур' });

      const hoursFor = async (typeId: string): Promise<number> => {
        const response = await request(app)
          .post(`${API}/service-requests`)
          .set('Authorization', `Bearer ${token}`)
          .send(callBody(typeId));
        expect(response.status).toBe(201);
        const started = new Date(response.body.data.slaStartedAt).getTime();
        const due = new Date(response.body.data.slaDueAt).getTime();
        return Math.round((due - started) / (60 * 60 * 1000));
      };

      expect(await hoursFor(light)).toBe(24);
      expect(await hoursFor(socket)).toBe(6);
    });

    /**
     * The part people find surprising, so it is pinned: urgency orders the queue and does
     * not shorten the deadline. Without this an urgent call would silently collapse to the
     * global six hours and the type's configured day would be ignored.
     */
    it('ignores the urgent flag when setting the deadline', async () => {
      const typeId = await createCallableObjectType({ callSlaHours: 24 });

      const urgent = await request(app)
        .post(`${API}/service-requests`)
        .set('Authorization', `Bearer ${token}`)
        .send(callBody(typeId, { isUrgent: true }));

      expect(urgent.status).toBe(201);
      const started = new Date(urgent.body.data.slaStartedAt).getTime();
      const due = new Date(urgent.body.data.slaDueAt).getTime();
      expect(Math.round((due - started) / (60 * 60 * 1000))).toBe(24);
    });
  });

  describe('which types may be called about', () => {
    it('refuses a call against a type that is not callable', async () => {
      const typeId = await createCallableObjectType({ canCreateCall: false });

      const response = await request(app)
        .post(`${API}/service-requests`)
        .set('Authorization', `Bearer ${token}`)
        .send(callBody(typeId));

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('дуудлага үүсгэх боломжгүй');
    });

    it('refuses a call against a retired type', async () => {
      const typeId = await createCallableObjectType();
      await ObjectType.updateOne({ _id: typeId }, { $set: { isActive: false } });

      const response = await request(app)
        .post(`${API}/service-requests`)
        .set('Authorization', `Bearer ${token}`)
        .send(callBody(typeId));

      expect(response.status).toBe(404);
    });

    it('refuses a call naming no type at all', async () => {
      const body = callBody('ignored');
      delete (body as Record<string, unknown>).objectTypeId;

      const response = await request(app)
        .post(`${API}/service-requests`)
        .set('Authorization', `Bearer ${token}`)
        .send(body);

      expect(response.status).toBe(400);
    });
  });

  describe('configuring a type', () => {
    /** Calls enabled with no window would silently fall back to the global hours. */
    it('refuses to enable calls without an SLA window', async () => {
      const response = await request(app)
        .post(`${API}/object-types`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          code: 'NOHOURS',
          name: 'Цаггүй',
          category: 'EQUIPMENT',
          canCreateCall: true,
        });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('SLA');
    });

    it('accepts calls enabled together with a window', async () => {
      const response = await request(app)
        .post(`${API}/object-types`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          code: 'WITHHOURS',
          name: 'Гэрэл',
          category: 'EQUIPMENT',
          canCreateCall: true,
          callSlaHours: 24,
        });

      expect(response.status).toBe(201);
      expect(response.body.data.canCreateCall).toBe(true);
      expect(response.body.data.callSlaHours).toBe(24);
    });

    /**
     * The case a per-field schema cannot catch: the patch looks complete on its own, and is
     * only wrong once merged with what is already stored.
     */
    it('refuses a patch that switches calls on and leaves the hours behind', async () => {
      const typeId = await createCallableObjectType({ canCreateCall: false });

      const response = await request(app)
        .patch(`${API}/object-types/${typeId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ canCreateCall: true });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('SLA');
    });

    it('clears the hours when calls are switched off', async () => {
      const typeId = await createCallableObjectType({ callSlaHours: 24 });

      const response = await request(app)
        .patch(`${API}/object-types/${typeId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ canCreateCall: false });

      expect(response.status).toBe(200);
      expect(response.body.data.canCreateCall).toBe(false);
      // Left set, it would be inherited by whoever re-enables calls later.
      expect(response.body.data.callSlaHours).toBeNull();
    });
  });
});
