import { PERMISSIONS, type PermissionKey } from '@monhorus/shared';
import type { Express } from 'express';
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { hashPassword } from '../../utils/password.util';
import {
  createObjectFixture,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
  type ObjectFixture,
} from '../../test/helpers';
import { Role } from '../rbac/role.model';
import { Customer } from '../objects/object.models';
import {
  ObjectAssessment,
  ObjectRecord,
  ObjectType,
} from '../object-master/object-master.models';
import { ServiceRequest, nextRequestNumber } from '../service-request/service-request.model';
import { User } from '../user/user.model';

/**
 * `GET /portal/summary` — the customer portal's history block.
 *
 * The request-count-per-month series used to live here and is now a dashboard widget; its
 * cases moved with it rather than being duplicated.
 *
 * TWO THINGS ARE UNDER TEST AND ONLY ONE OF THEM IS THE ARITHMETIC. The other is the
 * tenant boundary, and it is the one worth the fixture: every case below seeds a matching
 * record under a SECOND organisation, so a figure of one rather than two is what proves
 * the scope rather than the query. An endpoint that returned the right months for the
 * wrong organisation would pass every count assertion written without that second seed.
 *
 * THE RISK SERIES IS A STANDING, NOT A TALLY. An object assessed three times in a month
 * stands in one band at the end of it, and an object assessed a year ago still stands
 * where that assessment left it. Both are asserted, because summing assessments per month
 * is the obvious wrong implementation and it agrees with the right one on any fixture
 * where each object is assessed exactly once.
 */

const API = '/api/v1';

const PORTAL_KEYS: readonly PermissionKey[] = [
  PERMISSIONS.PORTAL_SERVICE_REQUEST_VIEW,
  PERMISSIONS.PORTAL_OBJECT_VIEW,
];

let app: Express;
let objects: ObjectFixture;
let otherCustomerId: string;
let token: string;
let blindToken: string;

let roleSequence = 0;

/**
 * A portal login as the product issues one: `role: 'customer'` with the organisation on
 * the ACCOUNT.
 *
 * That is the whole reason the scope helper can be trusted — the tenant is never read from
 * the request — so a fixture that set it any other way would be testing a different system.
 */
async function createCustomerLogin(
  email: string,
  customerId: string,
  permissions: readonly PermissionKey[],
): Promise<string> {
  roleSequence += 1;
  const role = await Role.create({
    key: `TEST_PORTAL_ROLE_${roleSequence}`,
    name: `Portal role ${email}`,
    description: null,
    permissions: [...permissions],
    isSystem: false,
  });

  const password = 'PortalPassword2026x';
  await User.create({
    fullName: `Portal ${email}`,
    email,
    password: await hashPassword(password),
    role: 'customer',
    customer: customerId,
    roles: [role._id],
    status: 'active',
    passwordChangedAt: new Date(),
  });

  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  expect(response.status).toBe(200);
  return response.body.data.tokens.accessToken as string;
}

interface Summary {
  months: string[];
  requestsByStatus: { status: string; count: number }[];
  riskByMonth?: { month: string; counts: { level: string; count: number }[] }[];
}

async function summary(bearer: string): Promise<Summary> {
  const response = await request(app)
    .get(`${API}/portal/summary`)
    .set('Authorization', `Bearer ${bearer}`);
  expect(response.status).toBe(200);
  return response.body.data as Summary;
}

/** A moment `back` whole months before now, mid-month so no boundary is in play. */
function monthsAgo(back: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 15, 6, 0, 0));
}

function monthKey(moment: Date): string {
  return `${moment.getUTCFullYear()}-${String(moment.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function seedRequest(
  customerId: string,
  createdAt: Date,
  status = 'NEW',
): Promise<void> {
  const created = await ServiceRequest.create({
    requestNumber: await nextRequestNumber(),
    customer: customerId,
    building: objects.buildingId,
    floor: objects.floorId,
    requestType: 'STANDARD_CALL',
    isUrgent: false,
    description: 'Гэрэл асахгүй байна.',
    contactName: 'Бат',
    contactPhone: '99112233',
    status,
    slaStartedAt: createdAt,
    slaDueAt: new Date(createdAt.getTime() + 3_600_000),
    assignedEmployees: [],
    assignedTeam: null,
  });
  // `createdAt` is stamped on insert and IMMUTABLE under `timestamps: true`, so Mongoose
  // silently discards a `$set` on it. The raw collection is the only way to place a
  // fixture in the past, and placing it in the past is the whole point of these cases.
  await ServiceRequest.collection.updateOne(
    { _id: created._id },
    { $set: { createdAt } },
  );
}

let objectSequence = 0;

/** The shared equipment type. Global by design, so one serves every case in the file. */
async function equipmentType(): Promise<Types.ObjectId> {
  const existing = await ObjectType.findOne({ code: 'DB' });
  if (existing) return existing._id as Types.ObjectId;
  const created = await ObjectType.create({
    code: 'DB',
    name: 'Түгээх самбар',
    category: 'PANEL',
    showOnPlan: false,
    insidePanel: false,
    generatesConclusion: true,
    icon: 'PANEL',
    isActive: true,
  });
  return created._id as Types.ObjectId;
}

async function seedObject(customerId: string): Promise<Types.ObjectId> {
  objectSequence += 1;
  const record = await ObjectRecord.create({
    customer: customerId,
    code: `OBJ-${objectSequence}`,
    name: `Тоноглол ${objectSequence}`,
    category: 'PANEL',
    objectType: await equipmentType(),
    status: 'ACTIVE',
    floor: objects.floorId,
    panel: { capacityKw: 25, location: null, protection: null },
    latestAssessment: null,
  });
  return record._id as Types.ObjectId;
}

async function seedAssessment(
  objectId: Types.ObjectId,
  riskLevel: string,
  assessedAt: Date,
  newScore: number,
): Promise<void> {
  await ObjectAssessment.create({
    object: objectId,
    previousScore: null,
    newScore,
    riskLevel,
    assessedBy: null,
    assessedByName: 'Тест',
    judgedBy: null,
    judgedByName: null,
    assessedAt,
    photos: [],
    conclusion: 'Тест дүгнэлт',
    recommendation: null,
    actionTaken: null,
    measuredLoadKw: null,
    measurements: [],
    attributes: [],
    repairRequired: false,
    revisitRequired: false,
    revisitDate: null,
    revisitOwner: null,
    revisitOwnerName: null,
    sourceLabel: null,
    sourceReport: null,
    sourceReportItem: null,
  });
}

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await stopTestApp();
});

beforeEach(async () => {
  await resetDomainCollections();
  objects = await createObjectFixture();
  const other = await Customer.create({ code: 'OTH', name: 'Бусад ХХК' });
  otherCustomerId = String(other._id);

  token = await createCustomerLogin('portal@test.mn', objects.customerId, PORTAL_KEYS);
  blindToken = await createCustomerLogin('blind@test.mn', objects.customerId, [
    PERMISSIONS.PORTAL_SERVICE_REQUEST_VIEW,
  ]);
});

describe('GET /portal/summary - the window', () => {
  it('returns six months, oldest first, ending with the current one', async () => {
    const data = await summary(token);

    expect(data.months).toHaveLength(6);
    expect(data.months[5]).toBe(monthKey(monthsAgo(0)));
    expect(data.months[0]).toBe(monthKey(monthsAgo(5)));
    expect([...data.months].sort()).toEqual(data.months);
  });

  it('publishes the window even when nothing has been assessed in it', async () => {
    const data = await summary(token);

    expect(data.riskByMonth).toHaveLength(6);
    expect(data.riskByMonth?.map((entry) => entry.month)).toEqual(data.months);
  });
});

describe('GET /portal/summary - request standing', () => {
  it('counts every request by status, however old', async () => {
    await seedRequest(objects.customerId, monthsAgo(11), 'IN_PROGRESS');
    await seedRequest(objects.customerId, monthsAgo(1), 'IN_PROGRESS');
    await seedRequest(objects.customerId, monthsAgo(1), 'COMPLETED');

    const data = await summary(token);
    const byStatus = new Map(data.requestsByStatus.map((row) => [row.status, row.count]));

    // The month window does not apply here: an open request from last year is still open.
    expect(byStatus.get('IN_PROGRESS')).toBe(2);
    expect(byStatus.get('COMPLETED')).toBe(1);
  });

  it('omits a status nobody is in', async () => {
    await seedRequest(objects.customerId, monthsAgo(1), 'NEW');

    const data = await summary(token);

    expect(data.requestsByStatus).toEqual([{ status: 'NEW', count: 1 }]);
  });

  it('counts only the caller organisation', async () => {
    await seedRequest(objects.customerId, monthsAgo(1), 'NEW');
    await seedRequest(otherCustomerId, monthsAgo(1), 'NEW');

    const data = await summary(token);

    expect(data.requestsByStatus).toEqual([{ status: 'NEW', count: 1 }]);
  });
});

describe('GET /portal/summary - risk standing', () => {
  it('counts an object under its latest band, not once per assessment', async () => {
    const objectId = await seedObject(objects.customerId);
    await seedAssessment(objectId, 'CRITICAL', monthsAgo(2), 30);
    await seedAssessment(objectId, 'NORMAL', monthsAgo(1), 90);

    const data = await summary(token);
    const latest = data.riskByMonth?.find((entry) => entry.month === monthKey(monthsAgo(0)));

    expect(latest?.counts).toEqual([{ level: 'NORMAL', count: 1 }]);
    expect(latest?.counts.reduce((sum, entry) => sum + entry.count, 0)).toBe(1);
  });

  it('carries a standing forward into later months with no new assessment', async () => {
    const objectId = await seedObject(objects.customerId);
    await seedAssessment(objectId, 'ATTENTION', monthsAgo(4), 70);

    const data = await summary(token);

    for (const month of [monthsAgo(3), monthsAgo(1), monthsAgo(0)]) {
      const entry = data.riskByMonth?.find((row) => row.month === monthKey(month));
      expect(entry?.counts).toEqual([{ level: 'ATTENTION', count: 1 }]);
    }
  });

  it('shows a month before the assessment as empty', async () => {
    const objectId = await seedObject(objects.customerId);
    await seedAssessment(objectId, 'CRITICAL', monthsAgo(1), 25);

    const data = await summary(token);
    const early = data.riskByMonth?.find((entry) => entry.month === monthKey(monthsAgo(4)));

    expect(early?.counts).toEqual([]);
  });

  /** Unassessed is not a band, and must never be counted as a healthy one. */
  it('leaves an object with no assessment out of every month', async () => {
    await seedObject(objects.customerId);

    const data = await summary(token);

    expect(data.riskByMonth?.every((entry) => entry.counts.length === 0)).toBe(true);
  });

  it('counts only the caller organisation', async () => {
    const mine = await seedObject(objects.customerId);
    const theirs = await seedObject(otherCustomerId);
    await seedAssessment(mine, 'CRITICAL', monthsAgo(1), 25);
    await seedAssessment(theirs, 'CRITICAL', monthsAgo(1), 25);

    const data = await summary(token);
    const latest = data.riskByMonth?.find((entry) => entry.month === monthKey(monthsAgo(0)));

    expect(latest?.counts).toEqual([{ level: 'CRITICAL', count: 1 }]);
  });
});

describe('GET /portal/summary - permissions', () => {
  /** Omitted, not zeroed: the screen must be able to tell the two apart. */
  it('omits the risk block for a caller without portal.object.view', async () => {
    const objectId = await seedObject(objects.customerId);
    await seedAssessment(objectId, 'NORMAL', monthsAgo(1), 95);

    const data = await summary(blindToken);

    expect(data.riskByMonth).toBeUndefined();
    expect(data.months).toHaveLength(6);
  });

  it('refuses a caller without portal.service_request.view', async () => {
    const strangerToken = await createCustomerLogin('nokeys@test.mn', objects.customerId, [
      PERMISSIONS.PORTAL_PROFILE_VIEW,
    ]);

    const response = await request(app)
      .get(`${API}/portal/summary`)
      .set('Authorization', `Bearer ${strangerToken}`);

    expect(response.status).toBe(403);
  });

  it('refuses an anonymous caller', async () => {
    const response = await request(app).get(`${API}/portal/summary`);
    expect(response.status).toBe(401);
  });
});
