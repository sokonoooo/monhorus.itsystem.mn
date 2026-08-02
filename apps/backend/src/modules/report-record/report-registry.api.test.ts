import { PERMISSIONS, type ReportStatus, type ReportType } from '@monhorus/shared';
import type { Express } from 'express';
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createSuperUser,
  createUserWithPermissions,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
} from '../../test/helpers';
import { ObjectRecord, ObjectType } from '../object-master/object-master.models';
import { Customer, ObjectNode } from '../objects/object.models';
import { User } from '../user/user.model';
import { writeReport } from './report-record.service';

const API = '/api/v1';

let app: Express;
let token: string;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  return response.body.data.tokens.accessToken as string;
}

/** A staff account demoted to the customer tier and linked to one organisation. */
async function customerToken(email: string, customerId: string): Promise<string> {
  const user = await createUserWithPermissions(email, [PERMISSIONS.OBJECT_MASTER_VIEW]);
  await User.updateOne(
    { _id: new Types.ObjectId(user.userId) },
    { $set: { role: 'customer', customer: new Types.ObjectId(customerId) } },
  );
  return login(user.email, user.password);
}

interface Tenant {
  customerId: string;
  projectId: string;
  buildingId: string;
  floorId: string;
  /** A second location under the same project, so filters discriminate between siblings. */
  otherBuildingId: string;
  otherFloorId: string;
}

async function seedTenant(prefix: string, name: string): Promise<Tenant> {
  const customer = await Customer.create({ code: prefix, name });
  const project = await ObjectNode.create({
    kind: 'PROJECT',
    code: `${prefix}-PRJ`,
    name: `${name} төсөл`,
    customer: customer._id,
    parent: null,
    ancestors: [],
  });
  const building = await ObjectNode.create({
    kind: 'BUILDING',
    code: `${prefix}-BLD-1`,
    name: 'Main Tower',
    customer: customer._id,
    parent: project._id,
    ancestors: [project._id],
  });
  const floor = await ObjectNode.create({
    kind: 'FLOOR',
    code: `${prefix}-FL-1`,
    name: '2-р давхар',
    customer: customer._id,
    parent: building._id,
    ancestors: [project._id, building._id],
  });
  const otherBuilding = await ObjectNode.create({
    kind: 'BUILDING',
    code: `${prefix}-BLD-2`,
    name: 'Annex',
    customer: customer._id,
    parent: project._id,
    ancestors: [project._id],
  });
  const otherFloor = await ObjectNode.create({
    kind: 'FLOOR',
    code: `${prefix}-FL-2`,
    name: '1-р давхар',
    customer: customer._id,
    parent: otherBuilding._id,
    ancestors: [project._id, otherBuilding._id],
  });

  return {
    customerId: String(customer._id),
    projectId: String(project._id),
    buildingId: String(building._id),
    floorId: String(floor._id),
    otherBuildingId: String(otherBuilding._id),
    otherFloorId: String(otherFloor._id),
  };
}

async function seedObject(
  tenant: Tenant,
  code: string,
  floorId: string,
): Promise<Types.ObjectId> {
  const type =
    (await ObjectType.findOne({ code: 'DB' })) ??
    (await ObjectType.create({
      code: 'DB',
      name: 'Түгээх самбар',
      category: 'PANEL',
      showOnPlan: false,
      insidePanel: false,
      generatesConclusion: true,
      icon: 'PANEL',
      isActive: true,
    }));

  const object = await ObjectRecord.create({
    code,
    name: `Самбар ${code}`,
    category: 'PANEL',
    objectType: type._id,
    customer: tenant.customerId,
    floor: floorId,
    status: 'ACTIVE',
    panel: { capacityKw: 25, location: null, protection: null },
    latestAssessment: null,
  });
  return object._id;
}

async function seedReport(
  objectId: Types.ObjectId,
  score: number | null,
  options: {
    type?: ReportType;
    status?: ReportStatus;
    occurredAt?: Date;
    title?: string;
  } = {},
): Promise<string> {
  const report = await writeReport({
    type: options.type ?? 'OBJECT_ASSESSMENT',
    status: options.status ?? 'APPROVED',
    title: options.title ?? 'Тоноглолын үнэлгээ',
    sourceType: 'MANUAL',
    // Derived from the title so two fixtures never share searchable prose: a hardcoded
    // conclusion made every search match everything.
    conclusion: `${options.title ?? 'Тоноглолын үнэлгээ'} — дүгнэлт.`,
    items: [{ object: objectId, score, conclusion: 'Хэт халалт илэрсэн.' }],
    actor: { id: null, name: 'Б. Энхтөр' },
    occurredAt: options.occurredAt ?? new Date('2026-07-01'),
  });
  return String(report._id);
}

async function listWith(query: string, bearer = token): Promise<Record<string, unknown>[]> {
  const response = await request(app)
    .get(`${API}/reports-registry${query}`)
    .set('Authorization', `Bearer ${bearer}`);
  expect(response.status).toBe(200);
  return response.body.data.items as Record<string, unknown>[];
}

describe('Report registry API', () => {
  beforeAll(async () => {
    app = await startTestApp();
  });

  afterAll(async () => {
    await stopTestApp();
  });

  beforeEach(async () => {
    await resetDomainCollections();
    const superUser = await createSuperUser();
    token = await login(superUser.email, superUser.password);
  });

  it('narrows the list with each server-side filter', async () => {
    const tenant = await seedTenant('CT', 'Central Tower ХХК');
    const first = await seedObject(tenant, 'DB-01', tenant.floorId);
    const second = await seedObject(tenant, 'DB-02', tenant.otherFloorId);

    const firstReport = await seedReport(first, 38, {
      title: 'Кабелийн халалт',
      occurredAt: new Date('2026-07-01'),
    });
    const secondReport = await seedReport(second, 92, {
      type: 'PLANNED_WORK',
      status: 'PUBLISHED',
      title: 'Улирлын үзлэг',
      occurredAt: new Date('2026-06-01'),
    });

    const only = async (query: string, expected: string): Promise<void> => {
      const items = await listWith(query);
      expect(items.map((item) => item.id)).toEqual([expected]);
    };

    expect(await listWith('')).toHaveLength(2);
    expect(await listWith(`?projectId=${tenant.projectId}`)).toHaveLength(2);
    await only('?type=OBJECT_ASSESSMENT', firstReport);
    await only('?status=PUBLISHED', secondReport);
    await only('?riskLevel=CRITICAL', firstReport);
    await only(`?buildingId=${tenant.buildingId}`, firstReport);
    await only(`?floorId=${String(tenant.otherFloorId)}`, secondReport);
    await only(`?objectId=${String(first)}`, firstReport);
    await only('?from=2026-06-15T00:00:00.000Z', firstReport);
    await only('?to=2026-06-15T00:00:00.000Z', secondReport);
    await only('?search=Кабелийн', firstReport);
  });

  it('returns the full report with its items populated', async () => {
    const tenant = await seedTenant('CT', 'Central Tower ХХК');
    const objectId = await seedObject(tenant, 'DB-01', tenant.floorId);
    const reportId = await seedReport(objectId, 38);

    const response = await request(app)
      .get(`${API}/reports-registry/${reportId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    const report = response.body.data;
    expect(report.type).toBe('OBJECT_ASSESSMENT');
    expect(report.customerName).toBe('Central Tower ХХК');
    expect(report.buildingName).toBe('Main Tower');
    expect(report.overallScore).toBe(38);
    expect(report.itemCount).toBe(1);
    expect(report.items).toHaveLength(1);
    expect(report.items[0].objectCode).toBe('DB-01');
    expect(report.items[0].objectName).toBe('Самбар DB-01');
    expect(report.items[0].floorName).toBe('2-р давхар');
    expect(report.items[0].score).toBe(38);
    expect(report.items[0].evidenceAttachments).toEqual([]);
  });

  it('returns every report type recorded against a piece of equipment', async () => {
    const tenant = await seedTenant('CT', 'Central Tower ХХК');
    const objectId = await seedObject(tenant, 'DB-01', tenant.floorId);

    await seedReport(objectId, 38);
    await seedReport(objectId, 55, { type: 'PLANNED_WORK' });
    await seedReport(objectId, 70, { type: 'SERVICE_REQUEST' });
    await seedReport(objectId, null, { type: 'CONSOLIDATED' });

    // A report on different equipment must not leak into this object's list.
    const other = await seedObject(tenant, 'DB-02', tenant.otherFloorId);
    await seedReport(other, 90);

    const response = await request(app)
      .get(`${API}/objects-master/${String(objectId)}/reports`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(4);
    const types = response.body.data.map((row: { type: string }) => row.type);
    expect(new Set(types)).toEqual(
      new Set(['OBJECT_ASSESSMENT', 'PLANNED_WORK', 'SERVICE_REQUEST', 'CONSOLIDATED']),
    );
  });

  it('scopes a customer-tier caller to their own published reports', async () => {
    const own = await seedTenant('CT', 'Central Tower ХХК');
    const foreign = await seedTenant('OT', 'Өөр Байгууллага ХХК');

    const ownObject = await seedObject(own, 'DB-01', own.floorId);
    const foreignObject = await seedObject(foreign, 'FD-01', foreign.floorId);

    const ownPublished = await seedReport(ownObject, 62, { status: 'PUBLISHED' });
    const ownApproved = await seedReport(ownObject, 38, {
      type: 'SERVICE_REQUEST',
      status: 'APPROVED',
    });
    const foreignPublished = await seedReport(foreignObject, 90, { status: 'PUBLISHED' });

    const portal = await customerToken('portal@test.mn', own.customerId);

    // Their own PUBLISHED report and nothing else — not their own approved-but-unreleased
    // one, and not the other organisation's, even when its id is requested outright.
    const items = await listWith(`?customerId=${foreign.customerId}`, portal);
    expect(items.map((item) => item.id)).toEqual([ownPublished]);

    const foreignDetail = await request(app)
      .get(`${API}/reports-registry/${foreignPublished}`)
      .set('Authorization', `Bearer ${portal}`);
    expect(foreignDetail.status).toBe(404);

    const unreleasedDetail = await request(app)
      .get(`${API}/reports-registry/${ownApproved}`)
      .set('Authorization', `Bearer ${portal}`);
    expect(unreleasedDetail.status).toBe(404);

    const ownDetail = await request(app)
      .get(`${API}/reports-registry/${ownPublished}`)
      .set('Authorization', `Bearer ${portal}`);
    expect(ownDetail.status).toBe(200);

    const foreignObjectReports = await request(app)
      .get(`${API}/objects-master/${String(foreignObject)}/reports`)
      .set('Authorization', `Bearer ${portal}`);
    expect(foreignObjectReports.status).toBe(404);

    const ownObjectReports = await request(app)
      .get(`${API}/objects-master/${String(ownObject)}/reports`)
      .set('Authorization', `Bearer ${portal}`);
    expect(ownObjectReports.status).toBe(200);
    expect(ownObjectReports.body.data.map((row: { id: string }) => row.id)).toEqual([
      ownPublished,
    ]);
  });

  it('hides the registry from a caller without object_master.view', async () => {
    const outsider = await createUserWithPermissions('outsider@test.mn', [
      PERMISSIONS.DASHBOARD_VIEW,
    ]);
    const outsiderToken = await login(outsider.email, outsider.password);

    const response = await request(app)
      .get(`${API}/reports-registry`)
      .set('Authorization', `Bearer ${outsiderToken}`);

    expect(response.status).toBe(403);
  });
});
