import { PERMISSIONS, type PermissionKey } from '@monhorus/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createObjectFixture,
  createOrgFixture,
  createUserWithPermissions,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
  type ObjectFixture,
  type OrgFixture,
} from '../../test/helpers';
import { Employee } from '../employee/employee.model';
import { PlannedWork, nextWorkNumber } from '../planned-work/planned-work.models';
import { ServiceRequest, nextRequestNumber } from '../service-request/service-request.model';

/**
 * DASHBOARD ASSIGNMENT SCOPE, for `GET /dashboard/summary`.
 *
 * The hole these tests close needed no exploit: the summary took the actor only to decide
 * which BLOCKS to build, never which RECORDS to count. `service_request.view` and
 * `planned_work.view` are both in the technician default, so every technician's dashboard
 * reported the whole company's workload — request counts, SLA breaches, the fourteen-day
 * trend, today's list with customer names and fault descriptions on it — beneath headings
 * that read as their own figures.
 *
 * THE ASSERTIONS THAT MATTER ARE THE COUNTS. A test that only checks `isScoped` proves
 * nothing: the flag was the easy half and could be true over a payload still carrying
 * everybody's numbers. So each case below seeds a record that belongs to the caller and a
 * record that belongs to a colleague, and asserts the figure is one rather than two.
 *
 * THE PERMISSION SETS ARE THE LOAD-BEARING PART OF THE FIXTURE. The technician here holds
 * `customer.view`, `employee.view` and `object_master.view` deliberately — permissions a
 * real technician role can and does carry. That is what makes the omission assertions
 * about SCOPE rather than about a missing key: those blocks are absent from their payload
 * even though they hold every permission that would build them. The dispatcher differs
 * from the technician by exactly one key, `dispatch.assign`, so the pair is controlled and
 * any divergence between the two payloads is the scope and nothing else.
 */

const API = '/api/v1';

/**
 * A field technician as a deployment actually holds one: the view keys, and not one
 * oversight key among them.
 *
 * `report.view` is included because the live TECHNICIAN role document carries it. It was
 * briefly on the read-oversight list, which silently unscoped every technician in the
 * field, so its presence here is what makes that regression fail in this file.
 */
const TECHNICIAN_KEYS: readonly PermissionKey[] = [
  PERMISSIONS.DASHBOARD_VIEW,
  PERMISSIONS.SERVICE_REQUEST_VIEW,
  PERMISSIONS.PLANNED_WORK_VIEW,
  PERMISSIONS.CUSTOMER_VIEW,
  PERMISSIONS.EMPLOYEE_VIEW,
  PERMISSIONS.OBJECT_MASTER_VIEW,
  PERMISSIONS.REPORT_VIEW,
];

/**
 * A dispatcher: every key the technician holds, plus `dispatch.assign`.
 *
 * One key apart, and that key is an oversight permission, so this caller stands on the
 * unscoped side of the same read. `invoice.view` comes along because the finance block is
 * one of the things a scoped caller must not receive, and somebody has to receive it for
 * the absence to mean anything.
 */
const DISPATCHER_KEYS: readonly PermissionKey[] = [
  ...TECHNICIAN_KEYS,
  PERMISSIONS.DISPATCH_ASSIGN,
  PERMISSIONS.INVOICE_VIEW,
];

let app: Express;
let org: OrgFixture;
let objects: ObjectFixture;

let technicianToken: string;
let dispatcherToken: string;
let cardlessToken: string;

/** Employee cards, by their relationship to the technician. */
let mineEmployeeId: string;
let teamMateEmployeeId: string;
let strangerEmployeeId: string;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  expect(response.status).toBe(200);
  return response.body.data.tokens.accessToken as string;
}

interface Summary {
  isScoped: boolean;
  requests?: { inProgress: number; newRequests: number; completedToday: number };
  requestsByStatus?: { key: string; count: number }[];
  trend?: { date: string; created: number; completed: number }[];
  plannedWork?: { total: number; inProgress: number };
  today?: { items: { reference: string }[]; completedCount: number };
  customers?: unknown;
  employees?: unknown;
  workload?: unknown;
  risk?: unknown;
  finance?: unknown;
}

async function summary(bearer: string): Promise<Summary> {
  const response = await request(app)
    .get(`${API}/dashboard/summary`)
    .set('Authorization', `Bearer ${bearer}`);
  expect(response.status).toBe(200);
  return response.body.data as Summary;
}

/**
 * An account with an employee card linked to it, which is the only thing that makes a
 * caller "an employee" as far as the policy is concerned: `AuthContext.employeeId`
 * resolves from `Employee.systemUser` on every request.
 */
async function createStaff(
  email: string,
  code: string,
  permissions: readonly PermissionKey[],
  team: string | null,
): Promise<{ token: string; employeeId: string }> {
  const user = await createUserWithPermissions(email, [...permissions]);
  const employee = await Employee.create({
    employeeCode: code,
    firstName: 'Дорж',
    lastName: 'Бат',
    company: org.companyId,
    department: org.departmentId,
    position: org.positionId,
    team,
    employeeType: 'FULL_TIME',
    employmentStartDate: new Date('2024-01-01'),
    status: 'ACTIVE',
    systemUser: user.userId,
  });

  return {
    token: await login(user.email, user.password),
    employeeId: String(employee._id),
  };
}

/** An employee card with no account behind it, to own the work that is not the caller's. */
async function createColleague(code: string, team: string | null): Promise<string> {
  const employee = await Employee.create({
    employeeCode: code,
    firstName: 'Сараа',
    lastName: 'Ганбат',
    company: org.companyId,
    department: org.departmentId,
    position: org.positionId,
    team,
    employeeType: 'FULL_TIME',
    employmentStartDate: new Date('2024-01-01'),
    status: 'ACTIVE',
  });
  return String(employee._id);
}

async function seedRequest(overrides: Record<string, unknown>): Promise<string> {
  const created = await ServiceRequest.create({
    requestNumber: await nextRequestNumber(),
    customer: objects.customerId,
    building: objects.buildingId,
    floor: objects.floorId,
    requestType: 'STANDARD_CALL',
    isUrgent: false,
    description: 'Гэрэл асахгүй байна.',
    contactName: 'Бат',
    contactPhone: '99112233',
    status: 'IN_PROGRESS',
    slaStartedAt: new Date(),
    slaDueAt: new Date(Date.now() + 3_600_000),
    assignedEmployees: [],
    assignedTeam: null,
    ...overrides,
  });
  return created.requestNumber;
}

async function seedPlannedWork(overrides: Record<string, unknown>): Promise<string> {
  const created = await PlannedWork.create({
    workNumber: await nextWorkNumber(),
    customer: objects.customerId,
    building: objects.buildingId,
    title: 'Урьдчилан сэргийлэх үзлэг',
    plannedStartDate: new Date(Date.now() - 86_400_000),
    plannedEndDate: new Date(Date.now() + 86_400_000),
    originalPlannedEndDate: new Date(Date.now() + 86_400_000),
    status: 'STARTED',
    totalQuantity: 10,
    completedQuantity: 5,
    taskCount: 1,
    assignedEmployees: [],
    assignedTeam: null,
    ...overrides,
  });
  return created.workNumber;
}

/**
 * One cast and one seed for the whole file.
 *
 * Every case here is a read, so there is nothing to isolate between them, and `POST
 * /auth/login` is rate limited per IP — building the cast once keeps the suite well clear
 * of that ceiling.
 */
beforeAll(async () => {
  app = await startTestApp();
  await resetDomainCollections();

  org = await createOrgFixture();
  objects = await createObjectFixture();

  const technician = await createStaff('tech@scope.test', 'EMP-TECH', TECHNICIAN_KEYS, org.teamId);
  technicianToken = technician.token;
  mineEmployeeId = technician.employeeId;

  const dispatcher = await createStaff('disp@scope.test', 'EMP-DISP', DISPATCHER_KEYS, null);
  dispatcherToken = dispatcher.token;

  // An account with the same view keys and NO employee card behind it.
  const cardless = await createUserWithPermissions('cardless@scope.test', [...TECHNICIAN_KEYS]);
  cardlessToken = await login(cardless.email, cardless.password);

  teamMateEmployeeId = await createColleague('EMP-MATE', org.teamId);
  strangerEmployeeId = await createColleague('EMP-OTHER', null);

  // Two live requests: one the technician is on, one a stranger is on. Every request
  // figure asserted below is built from exactly this pair.
  await seedRequest({ assignedEmployees: [mineEmployeeId] });
  await seedRequest({ assignedEmployees: [strangerEmployeeId] });

  // The same shape again for planned work.
  await seedPlannedWork({ assignedEmployees: [mineEmployeeId] });
  await seedPlannedWork({ assignedEmployees: [strangerEmployeeId] });
});

afterAll(async () => {
  await stopTestApp();
});

describe('Dashboard summary assignment scope', () => {
  /**
   * THE TEST THIS FILE EXISTS FOR.
   *
   * Two live requests, one of them the caller's. The figure has to be one. Before the
   * scoping it was two, and the heading above it said nothing about whose two.
   */
  it('counts only the requests assigned to the technician', async () => {
    const data = await summary(technicianToken);
    expect(data.requests?.inProgress).toBe(1);
  });

  /** The controlled half of the pair: one oversight key, and the same seed reads as two. */
  it('gives an oversight caller the organisation-wide request figure', async () => {
    const data = await summary(dispatcherToken);
    expect(data.requests?.inProgress).toBe(2);
  });

  it('counts only the planned work assigned to the technician', async () => {
    const technician = await summary(technicianToken);
    const dispatcher = await summary(dispatcherToken);

    expect(technician.plannedWork?.total).toBe(1);
    expect(dispatcher.plannedWork?.total).toBe(2);
  });

  /**
   * The distribution behind the donut is a separate code path from the counters — an
   * aggregation rather than a `countDocuments` — so it gets its own assertion. A chart
   * scoped differently from the tile beside it would be the same leak in a slower form.
   */
  it('scopes the status distribution, not only the counters', async () => {
    const technician = await summary(technicianToken);
    const dispatcher = await summary(dispatcherToken);

    const mine = technician.requestsByStatus?.find((slice) => slice.key === 'IN_PROGRESS');
    const all = dispatcher.requestsByStatus?.find((slice) => slice.key === 'IN_PROGRESS');

    expect(mine?.count).toBe(1);
    expect(all?.count).toBe(2);
  });

  /** The trend line is drawn from raw documents, so it is a third path to the same records. */
  it('scopes the fourteen day trend', async () => {
    const technician = await summary(technicianToken);
    const dispatcher = await summary(dispatcherToken);

    const sum = (points?: { created: number }[]): number =>
      (points ?? []).reduce((total, point) => total + point.created, 0);

    expect(sum(technician.trend)).toBe(1);
    expect(sum(dispatcher.trend)).toBe(2);
  });

  /**
   * The today list is the worst of the blocks to leave unscoped: it is not a number but
   * the records themselves, carrying customer name, address and fault description.
   */
  it("lists only the technician's own work in today", async () => {
    const technician = await summary(technicianToken);
    const dispatcher = await summary(dispatcherToken);

    expect(technician.today?.items).toHaveLength(2);
    expect(dispatcher.today?.items).toHaveLength(4);
  });

  /**
   * Work held by the caller's TEAM is the caller's work. This is the branch a hand-rolled
   * "assigned to me" predicate would drop, which would leave a technician unable to see
   * the job their own crew is on.
   *
   * Note what the branch actually matches: the record's `assignedTeam`, not "assigned to
   * somebody who happens to share my team". A request handed to a team-mate personally,
   * with no team on the record, is deliberately not the caller's — the first draft of this
   * test asserted otherwise and failed, which is the predicate being right and the test
   * being wrong. The record here therefore carries both, as a real team assignment does.
   */
  it("counts the technician's team's request as their own", async () => {
    const reference = await seedRequest({
      assignedEmployees: [teamMateEmployeeId],
      assignedTeam: org.teamId,
    });
    try {
      const data = await summary(technicianToken);
      expect(data.requests?.inProgress).toBe(2);
      expect(data.today?.items.map((item) => item.reference)).toContain(reference);
    } finally {
      await ServiceRequest.deleteOne({ requestNumber: reference });
    }
  });

  /**
   * An unclaimed request is the open queue this caller may pick up, so it belongs in their
   * figures — the same `includeUnclaimed` choice `GET /service-requests` makes. Planned
   * work deliberately does not do this: an unassigned job is not yours until assigned.
   */
  it('admits an unclaimed request into the technician figures', async () => {
    const reference = await seedRequest({ status: 'NEW', assignedEmployees: [] });
    try {
      const data = await summary(technicianToken);
      expect(data.requests?.newRequests).toBe(1);
      expect(data.today?.items.map((item) => item.reference)).toContain(reference);
    } finally {
      await ServiceRequest.deleteOne({ requestNumber: reference });
    }
  });
});

/**
 * An account with view permissions and no employee card.
 *
 * The dangerous failure mode for any scoping predicate is returning an EMPTY filter for
 * the caller it cannot place, because an empty filter matches every document rather than
 * none — the caller who can be tied to no work would then be shown all of it. Most office
 * accounts legitimately have no card, so this is not a rare path.
 */
describe('Dashboard summary for an account with no employee card', () => {
  it('shows no colleague work rather than all of it', async () => {
    const data = await summary(cardlessToken);

    expect(data.isScoped).toBe(true);
    // Planned work admits no unclaimed branch, so nothing can match this caller at all.
    expect(data.plannedWork?.total).toBe(0);
    // Requests admit the open queue, and both seeded requests are assigned to somebody.
    expect(data.requests?.inProgress).toBe(0);
    expect(data.today?.items).toHaveLength(0);
  });
});

describe('Dashboard summary organisation-wide blocks', () => {
  /**
   * NOT MERELY HIDDEN — ABSENT.
   *
   * The technician holds `customer.view`, `employee.view` and `object_master.view`, so
   * every one of these blocks would be built for them under the permission gate alone.
   * They are missing because of the scope, and they are missing from the RESPONSE rather
   * than from the rendering: a figure the UI hides is still in the JSON, and a technician
   * who opens the network tab has still been shown the company's books.
   */
  it('omits the blocks that cannot be scoped, despite the caller holding their permissions', async () => {
    const data = await summary(technicianToken);

    expect(data.customers).toBeUndefined();
    expect(data.employees).toBeUndefined();
    expect(data.workload).toBeUndefined();
    expect(data.risk).toBeUndefined();
    expect(data.finance).toBeUndefined();
  });

  it('keeps the organisation-wide blocks for an oversight caller', async () => {
    const data = await summary(dispatcherToken);

    expect(data.customers).toBeDefined();
    expect(data.employees).toBeDefined();
    expect(data.workload).toBeDefined();
    expect(data.risk).toBeDefined();
    expect(data.finance).toBeDefined();
  });

  /**
   * The flag is the cheap half and is asserted last on purpose: it is what lets the web
   * say whose figures these are, but it proves nothing about the figures themselves. The
   * counts above are the evidence; this only checks the payload describes itself honestly.
   */
  it('declares which of the two payloads it is', async () => {
    expect((await summary(technicianToken)).isScoped).toBe(true);
    expect((await summary(dispatcherToken)).isScoped).toBe(false);
  });
});
