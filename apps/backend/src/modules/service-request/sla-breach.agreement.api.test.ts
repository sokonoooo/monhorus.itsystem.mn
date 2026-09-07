import type { ServiceRequestStatus } from '@monhorus/shared';
import type { Express } from 'express';
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createObjectFixture,
  createSuperUser,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
  type ObjectFixture,
} from '../../test/helpers';
import { ObjectNode } from '../objects/object.models';
import { ServiceRequest, nextRequestNumber } from './service-request.model';

/**
 * "SLA зөрчил" means the same thing on all three screens that count it.
 *
 * WHY THIS FILE EXISTS. The KPI tile (`SLA_BREACHED_COUNT`), the 15.2 SLA report footer
 * and the dashboard `slaBreached` counter each carried their own version of the test and
 * each returned a different number for the same database — the KPI and the report called
 * every cancelled request a permanent breach, the dashboard forgot every breach that had
 * since been completed. THE AGREEMENT IS THE ASSERTION: this suite seeds one table of
 * requests, states the verdict each one should get, and then demands that all three
 * screens return that number. A change to any one of them that does not go through
 * `isSlaBreached` fails here, which is the point.
 */

const API = '/api/v1';

let app: Express;
let token: string;
let fixture: ObjectFixture;

/** Far enough either side of the seeded rows that every one of them is in range. */
const RANGE_FROM = new Date(Date.now() - 7 * 86_400_000).toISOString();
const RANGE_TO = new Date(Date.now() + 86_400_000).toISOString();

const HOUR = 3_600_000;

interface BreachCase {
  /** What the row is, in the words the definition uses. */
  name: string;
  status: ServiceRequestStatus;
  /** Offset from now, in hours. Negative is in the past. */
  dueHours: number;
  /** Offset from now, in hours, or null for "never settled". */
  completedHours: number | null;
  /** Whether the one definition says this row is in breach. */
  breached: boolean;
  /** Set when the row hangs off an archived project rather than the live one. */
  archivedProject?: true;
}

/**
 * The table is the specification. Each row names a question the definition had to answer.
 */
const CASES: readonly BreachCase[] = [
  {
    name: 'open, deadline already passed',
    status: 'ASSIGNED',
    dueHours: -1,
    completedHours: null,
    breached: true,
  },
  {
    name: 'open, deadline still ahead',
    status: 'ASSIGNED',
    dueHours: 1,
    completedHours: null,
    breached: false,
  },
  {
    name: 'completed before the deadline',
    status: 'COMPLETED',
    dueHours: -1,
    completedHours: -2,
    breached: false,
  },
  {
    name: 'completed after the deadline stays a breach for ever',
    status: 'COMPLETED',
    dueHours: -3,
    completedHours: -1,
    breached: true,
  },
  {
    // Settled by status but carrying no stamp: `now` stands in, exactly as `evaluateSla`
    // does with `completedAt ?? now`.
    name: 'settled after the deadline with no completedAt',
    status: 'COMPLETED',
    dueHours: -2,
    completedHours: null,
    breached: true,
  },
  {
    // The bug this round: a cancellation never writes `completedAt`, so the old
    // `completedAt == null && slaDueAt < now` test called it a breach for ever.
    name: 'cancelled long past its deadline is never a breach',
    status: 'CANCELLED',
    dueHours: -48,
    completedHours: null,
    breached: false,
  },
  {
    // There is no REJECTED status; RETURNED is a write-up sent back, i.e. still live work.
    name: 'returned for rework is open and still accruing breach',
    status: 'RETURNED',
    dueHours: -1,
    completedHours: null,
    breached: true,
  },
  {
    name: 'revisit required, deadline still ahead',
    status: 'REVISIT_REQUIRED',
    dueHours: 2,
    completedHours: null,
    breached: false,
  },
  {
    // Archival is an `isActive` flag on the object tree, never a request state, so it
    // must not quietly remove work from the count.
    name: 'open and past due under an archived project',
    status: 'ASSIGNED',
    dueHours: -5,
    completedHours: null,
    breached: true,
    archivedProject: true,
  },
];

const EXPECTED_BREACHES = CASES.filter((entry) => entry.breached).length;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  return response.body.data.tokens.accessToken as string;
}

async function seedCases(): Promise<void> {
  const now = Date.now();
  if (CASES.some((entry) => entry.archivedProject)) {
    await ObjectNode.updateOne({ _id: fixture.projectId }, { $set: { isActive: false } });
  }
  for (const entry of CASES) {
    await ServiceRequest.create({
      requestNumber: await nextRequestNumber(),
      customer: fixture.customerId,
      building: fixture.buildingId,
      floor: fixture.floorId,
      requestType: 'STANDARD_CALL',
      isUrgent: false,
      description: entry.name,
      contactName: 'Бат',
      contactPhone: '99112233',
      status: entry.status,
      slaStartedAt: new Date(now + entry.dueHours * HOUR - 24 * HOUR),
      slaDueAt: new Date(now + entry.dueHours * HOUR),
      completedAt: entry.completedHours === null ? null : new Date(now + entry.completedHours * HOUR),
    });
  }
}

/** `SLA_BREACHED_COUNT` off the KPI endpoint. */
async function kpiBreaches(): Promise<number> {
  const response = await request(app)
    .get(`${API}/reports/kpi?dateFrom=${RANGE_FROM}&dateTo=${RANGE_TO}`)
    .set('Authorization', `Bearer ${token}`);
  expect(response.status).toBe(200);
  const value = (response.body.data.values as { key: string; value: number | null }[]).find(
    (entry) => entry.key === 'SLA_BREACHED_COUNT',
  );
  expect(value).toBeDefined();
  return Number(value?.value);
}

const BREACH_RESULTS = new Set(['Зөрчсөн', 'Хугацаа хэтэрсэн']);

/**
 * The SLA report's own count, taken from the rows rather than from the footer.
 *
 * The footer is derived from one page and is item 4C's problem, not this suite's; counting
 * the rows asks the row predicate directly and keeps this assertion true whichever way 4C
 * settles the footer.
 */
async function reportBreaches(): Promise<number> {
  const response = await request(app)
    .get(`${API}/reports/SLA?dateFrom=${RANGE_FROM}&dateTo=${RANGE_TO}`)
    .set('Authorization', `Bearer ${token}`);
  expect(response.status).toBe(200);
  const rows = response.body.data.rows as { slaResult: string }[];
  return rows.filter((row) => BREACH_RESULTS.has(row.slaResult)).length;
}

/** How many rows the single SLA page carried, so a silent truncation cannot pass. */
async function reportRowCount(): Promise<number> {
  const response = await request(app)
    .get(`${API}/reports/SLA?dateFrom=${RANGE_FROM}&dateTo=${RANGE_TO}`)
    .set('Authorization', `Bearer ${token}`);
  return (response.body.data.rows as unknown[]).length;
}

/** The dashboard tile. */
async function dashboardBreaches(): Promise<number> {
  const response = await request(app)
    .get(`${API}/dashboard/summary`)
    .set('Authorization', `Bearer ${token}`);
  expect(response.status).toBe(200);
  return (response.body.data.requests as { slaBreached: number }).slaBreached;
}

describe('SLA breach, defined once', () => {
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
    fixture = await createObjectFixture();
    await seedCases();
  });

  it('counts the same breaches on the KPI, the SLA report and the dashboard', async () => {
    // Every seeded row fits on one page, so the report is counting the same set the other
    // two are. The paginated footer is item 4C and is deliberately not what is asserted.
    expect(await reportRowCount()).toBe(CASES.length);

    const [kpi, report, dashboard] = await Promise.all([
      kpiBreaches(),
      reportBreaches(),
      dashboardBreaches(),
    ]);

    expect({ kpi, report, dashboard }).toEqual({
      kpi: EXPECTED_BREACHES,
      report: EXPECTED_BREACHES,
      dashboard: EXPECTED_BREACHES,
    });
  });

  it('never counts a cancelled request, on any of the three', async () => {
    await ServiceRequest.deleteMany({});
    await ServiceRequest.create({
      requestNumber: await nextRequestNumber(),
      customer: fixture.customerId,
      building: fixture.buildingId,
      floor: fixture.floorId,
      requestType: 'STANDARD_CALL',
      isUrgent: false,
      description: 'Цуцалсан дуудлага',
      contactName: 'Бат',
      contactPhone: '99112233',
      status: 'CANCELLED',
      slaStartedAt: new Date(Date.now() - 72 * HOUR),
      slaDueAt: new Date(Date.now() - 48 * HOUR),
    });

    expect(await kpiBreaches()).toBe(0);
    expect(await reportBreaches()).toBe(0);
    expect(await dashboardBreaches()).toBe(0);
  });

  /**
   * `slaDueAt` is `required: true`, so a request without one cannot be created through the
   * model — this row is written straight to the collection to reach the state anyway. It
   * is here because the two query languages disagree about it: a `$lte` range query on a
   * Date cannot match a missing field, but in an aggregation `$lt: ['$slaDueAt', now]` is
   * TRUE for one, since null sorts below every date. Without the explicit null guard the
   * KPI would count a deadline-less request that the other two screens ignore.
   */
  it('cannot reach a missing slaDueAt through the model at all', () => {
    // Which is why the case above has to be written straight to the collection, and why
    // the null branch of the definition is a guard against a query-language footgun rather
    // than a state the domain produces.
    expect(ServiceRequest.schema.path('slaDueAt').isRequired).toBe(true);
  });

  it('treats a request with no slaDueAt as no breach, on all three', async () => {
    await ServiceRequest.collection.insertOne({
      requestNumber: 'SR-NO-SLA',
      customer: new Types.ObjectId(fixture.customerId),
      building: new Types.ObjectId(fixture.buildingId),
      status: 'ASSIGNED',
      completedAt: null,
      slaExtendedMinutes: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const [kpi, report, dashboard] = await Promise.all([
      kpiBreaches(),
      reportBreaches(),
      dashboardBreaches(),
    ]);
    expect({ kpi, report, dashboard }).toEqual({
      kpi: EXPECTED_BREACHES,
      report: EXPECTED_BREACHES,
      dashboard: EXPECTED_BREACHES,
    });
  });

  it('labels a cancelled row as cancelled rather than as active work', async () => {
    const response = await request(app)
      .get(`${API}/reports/SLA?dateFrom=${RANGE_FROM}&dateTo=${RANGE_TO}`)
      .set('Authorization', `Bearer ${token}`);
    const rows = response.body.data.rows as { status: string; slaResult: string }[];
    const cancelled = rows.find((row) => row.status === 'Цуцалсан');
    expect(cancelled?.slaResult).toBe('Цуцалсан');
  });
});
