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
import { ServiceRequest } from '../service-request/service-request.model';
import { ObjectRecord, ObjectType } from './object-master.models';

/**
 * What blocks the deletion of an equipment type.
 *
 * The type is the thing a service request names, and `callSlaHours` on the type is what
 * sets that request's deadline — so a `canCreateCall` type is a live dependency of every
 * call raised against it WITHOUT ever being instantiated as an object. Guarding only the
 * object side left exactly that case open: the type deleted, and `extendSla` then re-read
 * nothing and rebased the window onto the global default.
 *
 * These cover both sides of the guard, and the terminal-status case, which blocks for the
 * reason recorded in `deleteBlockersOfType`.
 */

const API = '/api/v1';

let app: Express;
let token: string;
let fixture: ObjectFixture;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  return response.body.data.tokens.accessToken as string;
}

/** A real call, posted through the API, so the request names the type the way production does. */
async function raiseCall(objectTypeId: string): Promise<string> {
  const response = await request(app)
    .post(`${API}/service-requests`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      customerId: fixture.customerId,
      buildingId: fixture.buildingId,
      requestType: 'STANDARD_CALL',
      objectTypeId,
      isUrgent: false,
      description: 'Гэрэл асахгүй байна',
      contactName: 'Б. Болд',
      contactPhone: '9911-2233',
    });
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

async function deleteType(objectTypeId: string) {
  return request(app)
    .delete(`${API}/object-types/${objectTypeId}`)
    .set('Authorization', `Bearer ${token}`);
}

describe('Equipment type deletion', () => {
  beforeAll(async () => {
    app = await startTestApp();
  });
  afterAll(async () => {
    await stopTestApp();
  });
  beforeEach(async () => {
    await resetDomainCollections();
    fixture = await createObjectFixture();
    const user = await createUserWithPermissions('typedel@test.mn', [
      PERMISSIONS.OBJECT_TYPE_MANAGE,
      PERMISSIONS.OBJECT_MASTER_VIEW,
      PERMISSIONS.SERVICE_REQUEST_CREATE,
      PERMISSIONS.SERVICE_REQUEST_VIEW,
    ]);
    token = await login(user.email, user.password);
  });

  it('refuses a callable type that a live service request names, though no object uses it', async () => {
    const typeId = await createCallableObjectType({ callSlaHours: 24, name: 'Гэрэл' });
    await raiseCall(typeId);

    // The hole this test exists for: nothing was ever registered as an object of the type.
    expect(await ObjectRecord.countDocuments({ objectType: typeId })).toBe(0);

    const response = await deleteType(typeId);

    expect(response.status).toBe(409);
    expect(response.body.message).toContain('үйлчилгээний хүсэлт');
    expect(response.body.message).toContain('1');
    expect(await ObjectType.countDocuments({ _id: typeId })).toBe(1);
  });

  it('names the requests rather than the objects when only requests block', async () => {
    const typeId = await createCallableObjectType({ callSlaHours: 6, name: 'Автомат залгуур' });
    await raiseCall(typeId);
    await raiseCall(typeId);

    const response = await deleteType(typeId);

    expect(response.status).toBe(409);
    expect(response.body.message).toContain('2 үйлчилгээний хүсэлт');
    // Distinguishable from the object case: no object count is claimed.
    expect(response.body.message).not.toContain('объект');
  });

  it('still refuses a completed request, whose deadline extendSla can still move', async () => {
    const typeId = await createCallableObjectType({ callSlaHours: 24, name: 'Сэнс' });
    const requestId = await raiseCall(typeId);
    await ServiceRequest.updateOne(
      { _id: requestId },
      { $set: { status: 'COMPLETED', completedAt: new Date() } },
    );

    const response = await deleteType(typeId);

    expect(response.status).toBe(409);
    expect(response.body.message).toContain('үйлчилгээний хүсэлт');
  });

  it('deletes the same type once nothing references it', async () => {
    const typeId = await createCallableObjectType({ callSlaHours: 24, name: 'Гэрэл' });
    const requestId = await raiseCall(typeId);
    await ServiceRequest.deleteOne({ _id: requestId });

    const response = await deleteType(typeId);

    expect(response.status).toBe(200);
    expect(await ObjectType.countDocuments({ _id: typeId })).toBe(0);
  });

  it('still refuses a type an object uses', async () => {
    const typeId = await createCallableObjectType({ callSlaHours: 24, name: 'Гэрэл' });
    await ObjectRecord.create({
      code: 'EQ-1',
      name: 'Гэрэл 1',
      category: 'EQUIPMENT',
      objectType: typeId,
      customer: fixture.customerId,
      floor: fixture.floorId,
    });

    const response = await deleteType(typeId);

    expect(response.status).toBe(409);
    expect(response.body.message).toContain('объект');
    expect(response.body.message).toContain('Идэвхгүй болгоно уу');
  });

  it('refuses a DEACTIVATED type that a request still names', async () => {
    // Deactivation closes the call form, not the reference: `assertCallableEquipmentType`
    // rejects an inactive type for NEW calls while every existing one still points at it.
    const typeId = await createCallableObjectType({ callSlaHours: 24, name: 'Гэрэл' });
    await raiseCall(typeId);
    await ObjectType.updateOne({ _id: typeId }, { $set: { isActive: false } });

    const response = await deleteType(typeId);

    expect(response.status).toBe(409);
    expect(response.body.message).toContain('үйлчилгээний хүсэлт');
  });
});
