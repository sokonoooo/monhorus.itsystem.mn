import { PERMISSIONS } from '@monhorus/shared';
import type { Express } from 'express';
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createUserWithPermissions,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
} from '../../test/helpers';
import { ObjectRecord, ObjectType } from '../object-master/object-master.models';
import { Customer, ObjectNode } from '../objects/object.models';
import { PlannedWork, PlannedWorkTask } from '../planned-work/planned-work.models';
import { MaterialItem } from './material.models';

const API = '/api/v1';

let app: Express;
let token: string;
let customerId: Types.ObjectId;
let projectId: Types.ObjectId;
let buildingId: Types.ObjectId;
let floorId: Types.ObjectId;
let otherFloorId: Types.ObjectId;
let workId: Types.ObjectId;
let taskId: Types.ObjectId;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  return response.body.data.tokens.accessToken as string;
}

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await stopTestApp();
});

beforeEach(async () => {
  await resetDomainCollections();

  const user = await createUserWithPermissions('mat@test.mn', [
    PERMISSIONS.MATERIAL_VIEW,
    PERMISSIONS.MATERIAL_MANAGE,
    PERMISSIONS.PLANNED_WORK_VIEW,
    PERMISSIONS.PLANNED_WORK_CREATE,
    PERMISSIONS.PLANNED_WORK_UPDATE,
  ]);
  token = await login(user.email, user.password);

  const customer = await Customer.create({ code: 'CT', name: 'Central Tower ХХК' });
  customerId = customer._id;

  const project = await ObjectNode.create({
    kind: 'PROJECT',
    code: 'P1',
    name: 'Төсөл',
    parent: null,
    customer: customerId,
    ancestors: [],
  });
  projectId = project._id;

  const building = await ObjectNode.create({
    kind: 'BUILDING',
    code: 'B1',
    name: 'Барилга',
    parent: projectId,
    customer: customerId,
    ancestors: [projectId],
  });
  buildingId = building._id;

  const floor = await ObjectNode.create({
    kind: 'FLOOR',
    code: 'F2',
    name: '2-р давхар',
    parent: buildingId,
    customer: customerId,
    ancestors: [projectId, buildingId],
  });
  floorId = floor._id;

  // A second building entirely, so "same customer, wrong place" can be exercised.
  const otherBuilding = await ObjectNode.create({
    kind: 'BUILDING',
    code: 'B2',
    name: 'Хоёр дахь барилга',
    parent: projectId,
    customer: customerId,
    ancestors: [projectId],
  });
  const otherFloor = await ObjectNode.create({
    kind: 'FLOOR',
    code: 'F1',
    name: '1-р давхар',
    parent: otherBuilding._id,
    customer: customerId,
    ancestors: [projectId, otherBuilding._id],
  });
  otherFloorId = otherFloor._id;

  const work = await PlannedWork.create({
    workNumber: 'PW-202608-0001',
    project: projectId,
    building: buildingId,
    customer: customerId,
    title: 'Сарын үзлэг',
    status: 'PLANNED',
    plannedStartDate: new Date('2026-08-01'),
    plannedEndDate: new Date('2026-08-31'),
    originalPlannedEndDate: new Date('2026-08-31'),
  });
  workId = work._id;

  const task = await PlannedWorkTask.create({
    plannedWork: workId,
    floor: floorId,
    title: 'Самбар үзэх',
    unit: 'PIECE',
    totalQuantity: 5,
    plannedStartDate: new Date('2026-08-01'),
    plannedEndDate: new Date('2026-08-10'),
  });
  taskId = task._id;

  // One seeded catalogue row, so the list count and the duplicate-code refusal both have
  // something to be measured against.
  await MaterialItem.create({
    code: 'CBL-3X2.5',
    name: 'Кабель 3x2.5',
    category: 'CABLE',
    defaultUnit: 'METRE',
  });
});

describe('Material catalogue', () => {
  it('lists and creates catalogue items', async () => {
    const created = await request(app)
      .post(`${API}/materials`)
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'brk-16a', name: 'Таслуур 16A', category: 'BREAKER', defaultUnit: 'PIECE' });

    expect(created.status).toBe(201);
    // Upper-cased by the schema, so the same item cannot be entered twice in two cases.
    expect(created.body.data.code).toBe('BRK-16A');

    const list = await request(app)
      .get(`${API}/materials`)
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.data.total).toBe(2);
  });

  it('refuses a duplicate code', async () => {
    const response = await request(app)
      .post(`${API}/materials`)
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'CBL-3X2.5', name: 'Давхардсан', category: 'CABLE', defaultUnit: 'METRE' });

    expect(response.status).toBe(409);
  });

  it('hides the catalogue from a caller without material.view', async () => {
    const outsider = await createUserWithPermissions('nomat@test.mn', [
      PERMISSIONS.PLANNED_WORK_VIEW,
    ]);
    const outsiderToken = await login(outsider.email, outsider.password);

    const response = await request(app)
      .get(`${API}/materials`)
      .set('Authorization', `Bearer ${outsiderToken}`);

    expect(response.status).toBe(403);
  });
});

describe('Sub-task equipment selection', () => {
  async function makeObject(onFloor: Types.ObjectId, code: string): Promise<Types.ObjectId> {
    const type = await ObjectType.findOne({ code: 'PANEL' }).select('_id');
    const objectType =
      type ??
      (await ObjectType.create({
        code: 'PANEL',
        name: 'Самбар',
        category: 'PANEL',
      }));

    const object = await ObjectRecord.create({
      code,
      name: `Самбар ${code}`,
      objectType: objectType._id,
      category: 'PANEL',
      floor: onFloor,
      customer: customerId,
    });
    return object._id;
  }

  /**
   * The location half of the chain. Tenancy alone would admit this object: it belongs to
   * the same customer, and only its floor is wrong.
   */
  it('refuses equipment that sits outside the sub-task floor', async () => {
    const stray = await makeObject(otherFloorId, 'DB-OTHER');

    const response = await request(app)
      .patch(`${API}/planned-work/${String(workId)}/tasks/${String(taskId)}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ relatedObjectIds: [String(stray)] });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('байршилд хамаарахгүй');
  });

  it('accepts equipment on the sub-task floor', async () => {
    const onFloor = await makeObject(floorId, 'DB-2F-01');

    const response = await request(app)
      .patch(`${API}/planned-work/${String(workId)}/tasks/${String(taskId)}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ relatedObjectIds: [String(onFloor)] });

    expect(response.status).toBe(200);
    const saved = await PlannedWorkTask.findById(taskId);
    expect(saved?.relatedObjects.map(String)).toEqual([String(onFloor)]);
  });
});
