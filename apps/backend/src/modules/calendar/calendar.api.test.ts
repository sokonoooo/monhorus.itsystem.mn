import { PERMISSIONS, type PermissionKey } from '@monhorus/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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

const API = '/api/v1';

/**
 * The fixture author, and deliberately an UNSCOPED one: `planned_work.create` and
 * `planned_work.update` are oversight keys, so this caller sees the whole company's
 * calendar. Every projection test below reads through it, which is what keeps those tests
 * about projection rather than about scope. Scope has its own describe block.
 */
const OPERATOR_PERMISSIONS = [
  PERMISSIONS.PLANNED_WORK_VIEW,
  PERMISSIONS.PLANNED_WORK_CREATE,
  PERMISSIONS.PLANNED_WORK_UPDATE,
  PERMISSIONS.PLANNED_WORK_CHANGE_STATUS,
  PERMISSIONS.SERVICE_REQUEST_VIEW,
  PERMISSIONS.SERVICE_REQUEST_CREATE,
] as const;

/** Both view keys and not one oversight key: the seeded TECHNICIAN shape. */
const TECHNICIAN_PERMISSIONS = [
  PERMISSIONS.PLANNED_WORK_VIEW,
  PERMISSIONS.PLANNED_WORK_CHANGE_STATUS,
  PERMISSIONS.SERVICE_REQUEST_VIEW,
  PERMISSIONS.SERVICE_REQUEST_CLAIM,
] as const;

/** The same reads plus `dispatch.assign`, the one key that lifts the scope. */
const DISPATCHER_PERMISSIONS = [
  ...TECHNICIAN_PERMISSIONS,
  PERMISSIONS.DISPATCH_ASSIGN,
] as const;

let app: Express;
let org: OrgFixture;
let objects: ObjectFixture;
let token: string;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  return response.body.data.tokens.accessToken as string;
}

async function createWork(
  overrides: Record<string, unknown> = {},
  bearer = token,
): Promise<string> {
  const response = await request(app)
    .post(`${API}/planned-work`)
    .set('Authorization', `Bearer ${bearer}`)
    .send({
      projectId: objects.projectId,
      buildingId: objects.buildingId,
      title: 'Улирлын үзлэг',
      plannedStartDate: '2026-07-05T00:00:00.000Z',
      plannedEndDate: '2026-07-20T00:00:00.000Z',
      assignedEmployeeIds: [],
      ...overrides,
    });
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

async function createRequest(): Promise<string> {
  const response = await request(app)
    .post(`${API}/service-requests`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      customerId: objects.customerId,
      buildingId: objects.buildingId,
      requestType: 'URGENT_CALL',
      isUrgent: true,
      description: 'Гэрэлтүүлэг ажиллахгүй байна',
      contactName: 'Бат',
      contactPhone: '99001122',
      attachmentIds: [],
    });
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

/**
 * An employee card, optionally linked to a login and optionally on a team.
 *
 * The `systemUser` link is the only thing that makes a caller "an employee" as far as
 * assignment scope is concerned — `AuthContext.employeeId` resolves from it on every
 * request — so a card without one models the ordinary case of an employee who has no
 * account, and an account without a card models an office login.
 */
async function activeEmployee(
  code = 'EMP-CAL',
  options: {
    systemUser?: string;
    team?: string | null;
    firstName?: string;
    lastName?: string;
  } = {},
): Promise<string> {
  const employee = await Employee.create({
    employeeCode: code,
    firstName: options.firstName ?? 'Дорж',
    lastName: options.lastName ?? 'Бат',
    company: org.companyId,
    department: org.departmentId,
    position: org.positionId,
    team: options.team ?? null,
    employeeType: 'FULL_TIME',
    employmentStartDate: new Date('2024-01-01'),
    status: 'ACTIVE',
    systemUser: options.systemUser,
  });
  return String(employee._id);
}

/** A signed-in account with an employee card behind it. */
async function createStaff(
  email: string,
  code: string,
  permissions: readonly PermissionKey[],
  team: string | null = null,
): Promise<{ token: string; employeeId: string }> {
  const user = await createUserWithPermissions(email, [...permissions]);
  const employeeId = await activeEmployee(code, { systemUser: user.userId, team });
  return { token: await login(user.email, user.password), employeeId };
}

/** Window covering the fixture dates. */
const WINDOW = 'from=2026-07-01T00:00:00.000Z&to=2026-07-31T00:00:00.000Z';

beforeAll(async () => {
  app = await startTestApp();
}, 60_000);

afterAll(async () => {
  await stopTestApp();
});

beforeEach(async () => {
  await resetDomainCollections();
  org = await createOrgFixture();
  objects = await createObjectFixture();
  const user = await createUserWithPermissions('cal@test.mn', OPERATOR_PERMISSIONS);
  token = await login(user.email, user.password);
});

describe('GET /calendar', () => {
  it('requires an explicit window', async () => {
    const response = await request(app)
      .get(`${API}/calendar`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
  });

  it('refuses a window wider than the configured maximum', async () => {
    const response = await request(app)
      .get(`${API}/calendar?from=2026-01-01T00:00:00.000Z&to=2027-01-01T00:00:00.000Z`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body.issues)).toContain('хоногоос их байж болохгүй');
  });

  it('refuses an inverted window', async () => {
    const response = await request(app)
      .get(`${API}/calendar?from=2026-07-31T00:00:00.000Z&to=2026-07-01T00:00:00.000Z`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
  });

  it('projects a planned work with its backend derived status and progress', async () => {
    const workId = await createWork();

    const response = await request(app)
      .get(`${API}/calendar?${WINDOW}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    const event = (response.body.data.events as { sourceId: string }[]).find(
      (entry) => entry.sourceId === workId,
    ) as Record<string, unknown> | undefined;

    expect(event).toBeDefined();
    expect(event?.source).toBe('PLANNED_WORK');
    expect(event?.status).toBe('DRAFT');
    expect(event?.statusLabel).toBe('Төсөл');
    expect(event?.progressPercent).toBe(0);
    expect(event?.detailPath).toBe(`/planned-work/${workId}`);
    expect(event?.id).toBe(`PLANNED_WORK:${workId}`);
  });

  it('reports the server timezone so the client renders in one place', async () => {
    const response = await request(app)
      .get(`${API}/calendar?${WINDOW}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.data.timezone).toBe('Asia/Ulaanbaatar');
  });

  it('projects a service request against its SLA deadline', async () => {
    const requestId = await createRequest();

    const now = new Date();
    const from = new Date(now.getTime() - 86_400_000).toISOString();
    const to = new Date(now.getTime() + 7 * 86_400_000).toISOString();

    const response = await request(app)
      .get(`${API}/calendar?from=${from}&to=${to}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    const event = (response.body.data.events as { sourceId: string }[]).find(
      (entry) => entry.sourceId === requestId,
    ) as Record<string, unknown> | undefined;

    expect(event).toBeDefined();
    expect(event?.source).toBe('SERVICE_REQUEST');
    expect(event?.isUrgent).toBe(true);
    // A request carries no quantity based progress.
    expect(event?.progressPercent).toBeNull();
    expect(event?.detailPath).toBe(`/service-requests/${requestId}`);
  });

  it('shows an overdue planned work as OVERDUE, derived by the backend', async () => {
    await createWork({
      plannedStartDate: '2020-01-05T00:00:00.000Z',
      plannedEndDate: '2020-01-20T00:00:00.000Z',
    });
    // The work must be past DRAFT before it can read as overdue.
    const list = await request(app)
      .get(`${API}/planned-work`)
      .set('Authorization', `Bearer ${token}`);
    const workId = list.body.data.items[0].id as string;
    await request(app)
      .post(`${API}/planned-work/${workId}/transition`)
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'PLAN' });

    const response = await request(app)
      .get(`${API}/calendar?from=2020-01-01T00:00:00.000Z&to=2020-01-31T00:00:00.000Z`)
      .set('Authorization', `Bearer ${token}`);

    const event = (response.body.data.events as { sourceId: string }[]).find(
      (entry) => entry.sourceId === workId,
    ) as Record<string, unknown> | undefined;

    expect(event?.status).toBe('OVERDUE');
    expect(event?.isOverdue).toBe(true);
    expect(event?.statusLabel).toBe('Хугацаа хэтэрсэн');
  });

  it('excludes a work outside the requested window', async () => {
    await createWork({
      plannedStartDate: '2026-09-01T00:00:00.000Z',
      plannedEndDate: '2026-09-10T00:00:00.000Z',
    });

    const response = await request(app)
      .get(`${API}/calendar?${WINDOW}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.data.events).toHaveLength(0);
  });

  it('includes a work that merely overlaps the window', async () => {
    await createWork({
      plannedStartDate: '2026-06-20T00:00:00.000Z',
      plannedEndDate: '2026-08-10T00:00:00.000Z',
    });

    const response = await request(app)
      .get(`${API}/calendar?${WINDOW}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.data.events).toHaveLength(1);
  });

  it('excludes a cancelled work, which is not a schedule commitment', async () => {
    const canceller = await createUserWithPermissions('calcancel@test.mn', [
      ...OPERATOR_PERMISSIONS,
      PERMISSIONS.PLANNED_WORK_CANCEL,
    ]);
    const cancellerToken = await login(canceller.email, canceller.password);
    const workId = await createWork({}, cancellerToken);

    await request(app)
      .post(`${API}/planned-work/${workId}/transition`)
      .set('Authorization', `Bearer ${cancellerToken}`)
      .send({ action: 'CANCEL', reason: 'Захиалагч татгалзав' });

    const response = await request(app)
      .get(`${API}/calendar?${WINDOW}`)
      .set('Authorization', `Bearer ${cancellerToken}`);

    expect(response.body.data.events).toHaveLength(0);
  });

  it('filters by source', async () => {
    await createWork();
    await createRequest();

    const response = await request(app)
      .get(`${API}/calendar?${WINDOW}&sources=PLANNED_WORK`)
      .set('Authorization', `Bearer ${token}`);

    const sources = new Set(
      (response.body.data.events as { source: string }[]).map((entry) => entry.source),
    );
    expect(sources).toEqual(new Set(['PLANNED_WORK']));
  });

  it('filters by assigned employee', async () => {
    const employeeId = await activeEmployee('EMP-CAL-1');
    await createWork({ title: 'Хуваарилагдсан', assignedEmployeeIds: [employeeId] });
    await createWork({ title: 'Хуваарилагдаагүй' });

    const response = await request(app)
      .get(`${API}/calendar?${WINDOW}&employeeId=${employeeId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.data.events).toHaveLength(1);
    expect(response.body.data.events[0].title).toBe('Хуваарилагдсан');
    expect(response.body.data.events[0].assignedNames).toEqual(['Бат Дорж']);
  });

  it('filters by building and by project', async () => {
    await createWork();

    const matching = await request(app)
      .get(`${API}/calendar?${WINDOW}&buildingId=${objects.buildingId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(matching.body.data.events).toHaveLength(1);

    const other = await request(app)
      .get(`${API}/calendar?${WINDOW}&buildingId=${objects.foreignBuildingId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(other.body.data.events).toHaveLength(0);
  });

  it('filters by status', async () => {
    await createWork();

    const draft = await request(app)
      .get(`${API}/calendar?${WINDOW}&status=DRAFT`)
      .set('Authorization', `Bearer ${token}`);
    expect(draft.body.data.events).toHaveLength(1);

    const started = await request(app)
      .get(`${API}/calendar?${WINDOW}&status=STARTED`)
      .set('Authorization', `Bearer ${token}`);
    expect(started.body.data.events).toHaveLength(0);
  });

  it('returns events sorted by start instant', async () => {
    await createWork({
      title: 'Хожим',
      plannedStartDate: '2026-07-20T00:00:00.000Z',
      plannedEndDate: '2026-07-25T00:00:00.000Z',
    });
    await createWork({
      title: 'Эрт',
      plannedStartDate: '2026-07-02T00:00:00.000Z',
      plannedEndDate: '2026-07-06T00:00:00.000Z',
    });

    const response = await request(app)
      .get(`${API}/calendar?${WINDOW}`)
      .set('Authorization', `Bearer ${token}`);

    const titles = (response.body.data.events as { title: string }[]).map((entry) => entry.title);
    expect(titles).toEqual(['Эрт', 'Хожим']);
  });
});

describe('calendar source permissions', () => {
  it('omits planned work for a caller who may only read requests', async () => {
    await createWork();
    await createRequest();

    // No employee card and no oversight, and the request still shows: it is unassigned,
    // which is the open queue the calendar admits for the same reason the list does.
    const requestsOnly = await createUserWithPermissions('calreq@test.mn', [
      PERMISSIONS.SERVICE_REQUEST_VIEW,
    ]);
    const requestsToken = await login(requestsOnly.email, requestsOnly.password);

    const now = new Date();
    const from = new Date(now.getTime() - 86_400_000).toISOString();
    const to = new Date(now.getTime() + 7 * 86_400_000).toISOString();

    const response = await request(app)
      .get(`${API}/calendar?from=${from}&to=${to}`)
      .set('Authorization', `Bearer ${requestsToken}`);

    expect(response.status).toBe(200);
    const sources = new Set(
      (response.body.data.events as { source: string }[]).map((entry) => entry.source),
    );
    expect(sources.has('PLANNED_WORK')).toBe(false);
    expect(sources.has('SERVICE_REQUEST')).toBe(true);
  });

  it('omits requests for a caller who may only read planned work', async () => {
    // The work has to be ASSIGNED to this caller now, and that is not incidental to the
    // test: `planned_work.view` alone is no longer sight of every job, so an unassigned
    // fixture would make this assertion pass or fail on the scope rather than on the
    // source filter it is named after.
    const worksOnly = await createStaff('calwork@test.mn', 'EMP-CAL-W', [
      PERMISSIONS.PLANNED_WORK_VIEW,
    ]);
    const worksToken = worksOnly.token;

    await createWork({ assignedEmployeeIds: [worksOnly.employeeId] });
    await createRequest();

    const response = await request(app)
      .get(`${API}/calendar?${WINDOW}`)
      .set('Authorization', `Bearer ${worksToken}`);

    expect(response.status).toBe(200);
    const sources = new Set(
      (response.body.data.events as { source: string }[]).map((entry) => entry.source),
    );
    expect(sources.has('SERVICE_REQUEST')).toBe(false);
    expect(sources.has('PLANNED_WORK')).toBe(true);
  });

  it('refuses a caller who may read neither source', async () => {
    const outsider = await createUserWithPermissions('calnone@test.mn', [
      PERMISSIONS.DASHBOARD_VIEW,
    ]);
    const outsiderToken = await login(outsider.email, outsider.password);

    const response = await request(app)
      .get(`${API}/calendar?${WINDOW}`)
      .set('Authorization', `Bearer ${outsiderToken}`);

    expect(response.status).toBe(403);
  });
});

/**
 * ASSIGNMENT SCOPE, which this endpoint had none of.
 *
 * `GET /calendar` took the caller only to decide which SOURCES to include; every filter
 * beyond that came from the query string. The route guard is
 * `requireAnyPermission(planned_work.view, service_request.view)` and both keys are in the
 * TECHNICIAN default, so any technician who omitted `employeeId` — which the employee app
 * did for them, behind a `Бүгд` chip on the Хуанли screen — received up to 500 planned works
 * and 500 requests per window covering the whole company, each row carrying `assignedNames`,
 * the customer and the building. The two list endpoints had been closed against exactly this
 * and the calendar is a projection of the same two collections, so the closed doors bought
 * nothing while this one stood open.
 *
 * WHY THESE CASES AND NOT THE ONE ABOVE. `GET /calendar?employeeId=…` was already asserted
 * to filter, and that test is untouched — but "the parameter narrows when you pass it" and
 * "the caller is bounded when they do not" are different claims, and only the first was ever
 * made. Every assertion here is about what comes back when the client asks for everything.
 *
 * The rule itself lives in planned-work.scope.ts and is exercised in depth by
 * planned-work.list-scope.api.test.ts. What is under test here is that the calendar applies
 * it — to BOTH sources, and as narrowing that the query string cannot undo.
 */
describe('GET /calendar is bounded by assignment', () => {
  /** Titles, which is what the planned-work fixtures below are identified by. */
  async function calendarTitles(bearer: string, query = ''): Promise<string[]> {
    const response = await request(app)
      .get(`${API}/calendar?${WINDOW}&sources=PLANNED_WORK${query}`)
      .set('Authorization', `Bearer ${bearer}`);
    expect(response.status).toBe(200);
    return (response.body.data.events as { title: string }[]).map((entry) => entry.title);
  }

  /**
   * The four relationships a planned work can have to a technician, plus the two logins
   * needed to tell them apart. Built per test because `resetDomainCollections` runs in
   * `beforeEach`.
   */
  async function scopeFixture(): Promise<{
    technicianToken: string;
    technicianEmployeeId: string;
    colleagueEmployeeId: string;
  }> {
    const technician = await createStaff(
      'caltech@test.mn',
      'EMP-CAL-T',
      TECHNICIAN_PERMISSIONS,
      org.teamId,
    );
    // On no team at all, so nothing reaches the technician through team membership. Named
    // differently from every other card here, so the leak can be asserted on the NAME.
    const colleagueId = await activeEmployee('EMP-CAL-C', {
      firstName: 'Сараа',
      lastName: 'Ганаа',
    });

    await createWork({ title: 'Миний', assignedEmployeeIds: [technician.employeeId] });
    await createWork({ title: 'Багийн', assignedTeamId: org.teamId });
    await createWork({ title: 'Хамт олны', assignedEmployeeIds: [colleagueId] });
    await createWork({ title: 'Эзэнгүй' });

    return {
      technicianToken: technician.token,
      technicianEmployeeId: technician.employeeId,
      colleagueEmployeeId: colleagueId,
    };
  }

  it('answers a technician with their own and their team\'s work and nothing else', async () => {
    const fixture = await scopeFixture();

    const titles = await calendarTitles(fixture.technicianToken);

    expect(titles).toEqual(expect.arrayContaining(['Миний', 'Багийн']));
    // The leak, named: a colleague's job carried that colleague's full name in
    // `assignedNames`, and it was one tap away on the Хуанли screen.
    expect(titles).not.toContain('Хамт олны');
    // Planned work has no claim flow, so "nobody holds it" is not a reason to show it.
    expect(titles).not.toContain('Эзэнгүй');
    expect(titles).toHaveLength(2);
  });

  it('never puts a colleague\'s name in front of a technician', async () => {
    const fixture = await scopeFixture();

    const response = await request(app)
      .get(`${API}/calendar?${WINDOW}`)
      .set('Authorization', `Bearer ${fixture.technicianToken}`);

    const names = (response.body.data.events as { assignedNames: string[] }[]).flatMap(
      (entry) => entry.assignedNames,
    );
    // `assignedNames` is the payload the leak actually delivered: colleague identities,
    // rendered on the agenda card. Asserting on the field rather than on the row count says
    // what was at stake.
    expect(names).toContain('Бат Дорж');
    expect(names).not.toContain('Ганаа Сараа');
  });

  it('counts a caller as assigned through their team alone', async () => {
    await scopeFixture();

    // Named on nothing individually; the team branch is the only thing that can match, and
    // it is the half of "mine OR my team's" the client could never express as a query.
    const mate = await createStaff(
      'calmate@test.mn',
      'EMP-CAL-M',
      TECHNICIAN_PERMISSIONS,
      org.teamId,
    );

    expect(await calendarTitles(mate.token)).toEqual(['Багийн']);
  });

  it('still shows a dispatcher the whole organisation\'s schedule', async () => {
    await scopeFixture();

    // One key apart from the technician above. `resolveAssignedWorkFilter` returns null for
    // them, so nothing is added to the filter at all.
    const dispatcher = await createStaff(
      'caldisp@test.mn',
      'EMP-CAL-D',
      DISPATCHER_PERMISSIONS,
    );

    const titles = await calendarTitles(dispatcher.token);
    expect(titles).toEqual(
      expect.arrayContaining(['Миний', 'Багийн', 'Хамт олны', 'Эзэнгүй']),
    );
    expect(titles).toHaveLength(4);
  });

  it('keeps employeeId narrowing the board for an oversight caller', async () => {
    const fixture = await scopeFixture();

    const dispatcher = await createStaff(
      'caldisp2@test.mn',
      'EMP-CAL-D2',
      DISPATCHER_PERMISSIONS,
    );

    // The parameter's real use: filtering the schedule to one person. Removing it would
    // have been the lazy fix and would have broken the dispatch board.
    expect(
      await calendarTitles(dispatcher.token, `&employeeId=${fixture.colleagueEmployeeId}`),
    ).toEqual(['Хамт олны']);
  });

  it('refuses to let employeeId or teamId widen a technician\'s scope', async () => {
    const fixture = await scopeFixture();

    // The obvious attempt, and the one the old filter honoured outright. ANDed now, so it
    // can only ever subtract.
    expect(
      await calendarTitles(fixture.technicianToken, `&employeeId=${fixture.colleagueEmployeeId}`),
    ).toEqual([]);
  });

  it('narrows a technician further rather than replacing their scope', async () => {
    const fixture = await scopeFixture();

    expect(
      await calendarTitles(fixture.technicianToken, `&employeeId=${fixture.technicianEmployeeId}`),
    ).toEqual(['Миний']);
  });

  it('bounds the service-request source too, while keeping the open queue', async () => {
    // Both sources are projections of collections carrying the same two assignment fields,
    // and scoping only one of them would leave half the leak in place.
    const technician = await createStaff(
      'calsr@test.mn',
      'EMP-CAL-SR',
      TECHNICIAN_PERMISSIONS,
    );
    const dispatcher = await createStaff(
      'calsrd@test.mn',
      'EMP-CAL-SRD',
      DISPATCHER_PERMISSIONS,
    );

    const openId = await createRequest();
    const colleagueRequestId = await createRequest();
    await request(app)
      .post(`${API}/service-requests/${colleagueRequestId}/assign`)
      .set('Authorization', `Bearer ${dispatcher.token}`)
      .send({ employeeIds: [dispatcher.employeeId] })
      .expect(200);

    const now = new Date();
    const from = new Date(now.getTime() - 86_400_000).toISOString();
    const to = new Date(now.getTime() + 7 * 86_400_000).toISOString();

    const response = await request(app)
      .get(`${API}/calendar?from=${from}&to=${to}&sources=SERVICE_REQUEST`)
      .set('Authorization', `Bearer ${technician.token}`);

    expect(response.status).toBe(200);
    const ids = (response.body.data.events as { sourceId: string }[]).map(
      (entry) => entry.sourceId,
    );
    // Unclaimed work is the pool "Нээлттэй" lists and `POST /:id/claim` takes from; hiding
    // it would leave the claim endpoint with no reachable input.
    expect(ids).toContain(openId);
    expect(ids).not.toContain(colleagueRequestId);
  });

  it('answers an account with no employee card with nothing rather than everything', async () => {
    await scopeFixture();

    // The dangerous default. `AuthContext.employeeId` is null here, and "no card" has to
    // read as "no record", never as "any record".
    const unlinked = await createUserWithPermissions(
      'calunlinked@test.mn',
      [...TECHNICIAN_PERMISSIONS],
    );
    const unlinkedToken = await login(unlinked.email, unlinked.password);

    expect(await calendarTitles(unlinkedToken)).toEqual([]);
  });
});
