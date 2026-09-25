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
  createCallableObjectType,
} from '../../test/helpers';
import { Employee } from '../employee/employee.model';
import { Team } from '../org/org.models';

/**
 * LIST ASSIGNMENT SCOPE, for `GET /planned-work` and `GET /service-requests`.
 *
 * The hole these tests close was live and required no exploit at all: neither list took an
 * auth context, so the filter was built purely from client query parameters. A technician
 * who omitted `employeeId` — which is to say, anyone who typed the URL — received every job
 * in the company: customers, addresses, contact names, fault descriptions, and which
 * colleague was on each one. `planned_work.view` and `service_request.view` are in the
 * TECHNICIAN default, so that was every technician in the field.
 *
 * ONE FILE FOR BOTH ENDPOINTS, because it is one rule: `resolveAssignedWorkFilter` in
 * planned-work.scope.ts serves both, and asserting them apart would let the two drift.
 * Building the cast once also matters — `POST /auth/login` is rate limited to 100 per IP per
 * fifteen minutes outside production and this suite needs six signed-in identities.
 *
 * The permission sets are the load-bearing part of the fixture. Every caller here holds the
 * view key for the endpoint under test, so a row missing from a response is never a
 * permission refusal; only the data scope differs, which is what makes these tests about
 * scope. `DISPATCHER_KEYS` differs from `TECHNICIAN_KEYS` by exactly one key —
 * `dispatch.assign`, an oversight permission — so the two callers are a controlled pair.
 */

const API = '/api/v1';

/** The list-reading keys the seeded TECHNICIAN role grants. No oversight key among them. */
const TECHNICIAN_KEYS = [
  PERMISSIONS.PLANNED_WORK_VIEW,
  PERMISSIONS.PLANNED_WORK_CHANGE_STATUS,
  PERMISSIONS.PLANNED_WORK_RECORD_PROGRESS,
  PERMISSIONS.PLANNED_WORK_SUBMIT_REPORT,
  PERMISSIONS.SERVICE_REQUEST_VIEW,
  PERMISSIONS.SERVICE_REQUEST_CLAIM,
] as const;

/**
 * A technician as the DATABASE actually holds one, rather than as the source default
 * describes one: the seeded keys plus `report.view`.
 *
 * This pair is not hypothetical. `report.view` was briefly in `READ_OVERSIGHT_PERMISSIONS`
 * on the reasoning that it is absent from the TECHNICIAN default — true of
 * `DEFAULT_ROLE_PERMISSIONS`, false of every existing deployment, because `seedRbac` only
 * prunes keys the catalogue has dropped and never withdraws a grant made under an older
 * default. The result was that every technician in the field bypassed the scope while
 * [TECHNICIAN_KEYS] above, which deliberately holds no oversight key, kept the suite green.
 *
 * The fixture exists so that adding a key a field role can plausibly hold to either
 * oversight list fails here rather than in production.
 */
const FIELD_TECHNICIAN_KEYS = [...TECHNICIAN_KEYS, PERMISSIONS.REPORT_VIEW] as const;

/** A dispatcher: the same reads plus `dispatch.assign`, which lifts the scope. */
const DISPATCHER_KEYS = [
  ...TECHNICIAN_KEYS,
  PERMISSIONS.DISPATCH_ASSIGN,
  PERMISSIONS.SERVICE_REQUEST_CREATE,
] as const;

/**
 * An accountant, EXACTLY as `SYSTEM_ROLE_DEFAULT_PERMISSIONS.FINANCE` grants the relevant
 * part of it: both view keys, `invoice.view` and `report.view`, and not one supervisory
 * key. The point of the fixture is that this caller is on the unscoped side of a read and
 * the scoped side of a write, which is the whole reason there are two permission sets.
 */
const FINANCE_KEYS = [
  PERMISSIONS.PLANNED_WORK_VIEW,
  PERMISSIONS.SERVICE_REQUEST_VIEW,
  PERMISSIONS.INVOICE_VIEW,
  PERMISSIONS.REPORT_VIEW,
] as const;

/**
 * A planner, used to create the fixture records so authorship is never under test.
 *
 * Holds `planned_work.approve` because the fixtures have to reach PLANNED, and that now
 * takes an APPROVE on top of the PLAN — see `planAndApprove` below.
 */
const SUPERVISOR_KEYS = [
  ...DISPATCHER_KEYS,
  PERMISSIONS.PLANNED_WORK_CREATE,
  PERMISSIONS.PLANNED_WORK_UPDATE,
  PERMISSIONS.PLANNED_WORK_APPROVE,
] as const;

let app: Express;
let org: OrgFixture;
let objects: ObjectFixture;

let supervisorToken: string;
let callableTypeId: string;
let dispatcherToken: string;
let technicianToken: string;
let fieldTechnicianToken: string;
let teamMateToken: string;
let colleagueToken: string;
let unlinkedToken: string;
let financeToken: string;

let technicianEmployeeId: string;
let colleagueEmployeeId: string;
/**
 * The supervisor's own card, used as the crew on the TEAM-assigned fixture.
 *
 * APPROVE will not promote a work with nobody on it, so a work whose scope is meant to come
 * from `assignedTeam` still has to name somebody individually. It names the supervisor —
 * who is unscoped, on no team, and asserted about nowhere — precisely so the individual
 * branch cannot be what makes the team-mate cases below pass.
 */
let supervisorEmployeeId: string;
let otherTeamId: string;

/** Planned work ids, by the relationship each has to `technicianToken`. */
let pwMine: string;
let pwMyTeam: string;
let pwColleague: string;
let pwNobody: string;

/** Service request numbers, which is what the list rows are identified by below. */
let srMine: string;
let srMyTeam: string;
let srColleague: string;
let srOpen: string;

/** The same records by id, for the single-record reads. */
let srColleagueId: string;
let srOpenId: string;
let srMineId: string;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  expect(response.status).toBe(200);
  return response.body.data.tokens.accessToken as string;
}

/**
 * An account holding `permissions`, with an employee card linked to it unless `team` is
 * `undefined`. The `Employee.systemUser` link is what `AuthContext.employeeId` resolves
 * from, so it is the only way to make a caller "an employee" as far as the policy is
 * concerned — and withholding it is the only way to test an unlinked account.
 */
async function createStaff(
  email: string,
  code: string,
  permissions: readonly PermissionKey[],
  team: string | null | undefined,
): Promise<{ token: string; employeeId: string | null }> {
  const user = await createUserWithPermissions(email, [...permissions]);

  if (team === undefined) {
    return { token: await login(user.email, user.password), employeeId: null };
  }

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

async function createWork(overrides: Record<string, unknown>): Promise<string> {
  const response = await request(app)
    .post(`${API}/planned-work`)
    .set('Authorization', `Bearer ${supervisorToken}`)
    .send({
      projectId: objects.projectId,
      buildingId: objects.buildingId,
      title: 'Хагас жилийн урьдчилан сэргийлэх үзлэг',
      plannedStartDate: '2026-07-01T00:00:00.000Z',
      plannedEndDate: '2026-07-31T00:00:00.000Z',
      assignedEmployeeIds: [],
      ...overrides,
    });
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

/**
 * Takes a freshly created work all the way to PLANNED, staffed with `crewEmployeeIds`.
 *
 * REACHING PLANNED IS TWO ACTIONS NOW. PLAN parks the work in PENDING_APPROVAL and APPROVE
 * is what promotes it, so a one-step PLAN leaves the record short of PLANNED. APPROVE also
 * refuses to run unstaffed and writes the crew itself, which is why the crew is named here
 * rather than only in the create body.
 *
 * The fixtures below have to be PLANNED and not merely created, because a scoped caller's
 * list excludes DRAFT/PENDING_APPROVAL/REJECTED outright — an unapproved work is invisible
 * to the technician regardless of who is named on it, which would make every scope
 * assertion here pass for the wrong reason.
 */
async function planAndApprove(workId: string, crewEmployeeIds: string[]): Promise<string> {
  const planned = await request(app)
    .post(`${API}/planned-work/${workId}/transition`)
    .set('Authorization', `Bearer ${supervisorToken}`)
    .send({ action: 'PLAN' });
  expect(planned.status).toBe(200);

  const approved = await request(app)
    .post(`${API}/planned-work/${workId}/transition`)
    .set('Authorization', `Bearer ${supervisorToken}`)
    .send({ action: 'APPROVE', assignedEmployeeIds: crewEmployeeIds });
  expect(approved.status).toBe(200);

  return workId;
}

/** Creates a request and, when told to, assigns it. */
async function createRequest(
  description: string,
  assignment: { employeeIds?: string[]; teamId?: string } | null,
): Promise<{ id: string; number: string }> {
  const created = await request(app)
    .post(`${API}/service-requests`)
    .set('Authorization', `Bearer ${supervisorToken}`)
    .send({
      customerId: objects.customerId,
      buildingId: objects.buildingId,
      requestType: 'STANDARD_CALL',
      objectTypeId: callableTypeId,
      isUrgent: false,
      description,
      contactName: 'Б. Болд',
      contactPhone: '9911-2233',
    });
  expect(created.status).toBe(201);

  const id = created.body.data.id as string;
  const number = created.body.data.requestNumber as string;

  if (assignment) {
    const assigned = await request(app)
      .post(`${API}/service-requests/${id}/assign`)
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({ employeeIds: assignment.employeeIds ?? [], teamId: assignment.teamId ?? null });
    expect(assigned.status).toBe(200);
  }

  return { id, number };
}

/** Every planned-work id a token can see, across the whole (small) collection. */
async function listWorkIds(bearer: string, query = ''): Promise<string[]> {
  const response = await request(app)
    .get(`${API}/planned-work?limit=100${query}`)
    .set('Authorization', `Bearer ${bearer}`);
  expect(response.status).toBe(200);
  // The reported total must agree with the rows, or the count is leaking what the page hides.
  expect(response.body.data.total).toBe(response.body.data.items.length);
  return (response.body.data.items as { id: string }[]).map((item) => item.id);
}

async function listRequestNumbers(bearer: string, query = ''): Promise<string[]> {
  const response = await request(app)
    .get(`${API}/service-requests?limit=100${query}`)
    .set('Authorization', `Bearer ${bearer}`);
  expect(response.status).toBe(200);
  expect(response.body.data.total).toBe(response.body.data.items.length);
  return (response.body.data.items as { requestNumber: string }[]).map(
    (item) => item.requestNumber,
  );
}

beforeAll(async () => {
  app = await startTestApp();
  await resetDomainCollections();
  // After the reset, and after startTestApp connected: object types are domain data and
  // are wiped by the reset like everything else.
  callableTypeId = await createCallableObjectType();

  org = await createOrgFixture();
  objects = await createObjectFixture();

  const otherTeam = await Team.create({
    company: org.companyId,
    department: org.departmentId,
    code: 'TEAM2',
    name: 'Баг 2',
  });
  otherTeamId = String(otherTeam._id);

  const supervisor = await createStaff('lssup@test.mn', 'LS-SUP', SUPERVISOR_KEYS, null);
  supervisorToken = supervisor.token;
  supervisorEmployeeId = supervisor.employeeId!;

  const dispatcher = await createStaff('lsdisp@test.mn', 'LS-DISP', DISPATCHER_KEYS, otherTeamId);
  dispatcherToken = dispatcher.token;

  const technician = await createStaff('lstech@test.mn', 'LS-T1', TECHNICIAN_KEYS, org.teamId);
  technicianToken = technician.token;
  technicianEmployeeId = technician.employeeId!;

  // The same field tier, but carrying the extra key a real deployment's role document has.
  const fieldTech = await createStaff(
    'lsfield@test.mn',
    'LS-T4',
    FIELD_TECHNICIAN_KEYS,
    org.teamId,
  );
  fieldTechnicianToken = fieldTech.token;

  // Same team as the technician, but named on nothing individually.
  const mate = await createStaff('lsmate@test.mn', 'LS-T2', TECHNICIAN_KEYS, org.teamId);
  teamMateToken = mate.token;

  // A different team, and the owner of the work the technician must not see.
  const colleague = await createStaff('lsother@test.mn', 'LS-T3', TECHNICIAN_KEYS, otherTeamId);
  colleagueToken = colleague.token;
  colleagueEmployeeId = colleague.employeeId!;

  // No employee card at all: `GET /employees/me` 404s for this account.
  const unlinked = await createStaff('lsnone@test.mn', 'LS-NONE', TECHNICIAN_KEYS, undefined);
  unlinkedToken = unlinked.token;

  // Also no employee card, which is the usual shape of an office account and the thing
  // that made the first version of this scope empty every finance screen in the product.
  const finance = await createStaff('lsfin@test.mn', 'LS-FIN', FINANCE_KEYS, undefined);
  financeToken = finance.token;

  pwMine = await planAndApprove(
    await createWork({ assignedEmployeeIds: [technicianEmployeeId] }),
    [technicianEmployeeId],
  );
  pwMyTeam = await planAndApprove(await createWork({ assignedTeamId: org.teamId }), [
    supervisorEmployeeId,
  ]);
  pwColleague = await planAndApprove(
    await createWork({ assignedEmployeeIds: [colleagueEmployeeId] }),
    [colleagueEmployeeId],
  );
  // Stays in DRAFT, and cannot be anything else: APPROVE refuses to promote a work with
  // nobody on it, so "PLANNED and unassigned" is no longer a state that exists. It is still
  // the record the technician must not be handed, which is what the cases below assert.
  pwNobody = await createWork({});

  const mineRequest = await createRequest('Миний хүсэлт', {
    employeeIds: [technicianEmployeeId],
  });
  srMine = mineRequest.number;
  srMineId = mineRequest.id;

  srMyTeam = (await createRequest('Багийн хүсэлт', { teamId: org.teamId })).number;

  const colleagueRequest = await createRequest('Хамт олны хүсэлт', {
    employeeIds: [colleagueEmployeeId],
  });
  srColleague = colleagueRequest.number;
  srColleagueId = colleagueRequest.id;

  const openRequest = await createRequest('Эзэнгүй хүсэлт', null);
  srOpen = openRequest.number;
  srOpenId = openRequest.id;
});

afterAll(async () => {
  await stopTestApp();
});

describe('GET /planned-work is bounded by assignment', () => {
  it('answers a technician with their own and their team\'s work, and nothing else', async () => {
    const ids = await listWorkIds(technicianToken);

    expect(ids).toContain(pwMine);
    expect(ids).toContain(pwMyTeam);

    // The two the hole used to hand over. A colleague's job is the leak; an unassigned one
    // is not this caller's either, and planned work has no claim flow that would make it so.
    expect(ids).not.toContain(pwColleague);
    expect(ids).not.toContain(pwNobody);
    expect(ids).toHaveLength(2);
  });

  it('counts a caller as assigned through their team alone', async () => {
    // The mate is named on no record at all. Before the server enforced this, the client
    // sent `employeeId` XOR `teamId` and the two ANDed server-side, so "mine OR my team's"
    // was not expressible from the outside — this is the half of it the client could never
    // ask for.
    const ids = await listWorkIds(teamMateToken);
    expect(ids).toEqual([pwMyTeam]);
  });

  it('answers an account with no employee card with nothing rather than everything', async () => {
    // The dangerous default. `AuthContext.employeeId` is null here, and "no card" must read
    // as "no record", never as "any record".
    expect(await listWorkIds(unlinkedToken)).toEqual([]);
  });

  it('still shows a dispatcher every job in the company', async () => {
    const ids = await listWorkIds(dispatcherToken);
    expect(ids).toEqual(
      expect.arrayContaining([pwMine, pwMyTeam, pwColleague, pwNobody]),
    );
    expect(ids).toHaveLength(4);
  });

  it('refuses to let a query parameter widen the scope', async () => {
    // Naming the colleague is the obvious attempt, and the one the old filter honoured
    // outright. It is ANDed with the enforced predicate now, so it can only ever subtract.
    expect(await listWorkIds(technicianToken, `&employeeId=${colleagueEmployeeId}`)).toEqual([]);
    expect(await listWorkIds(technicianToken, `&teamId=${otherTeamId}`)).toEqual([]);
  });

  it('keeps employeeId working as narrowing for a caller who may see everything', async () => {
    // The dispatcher's own use of the parameter must survive: filtering to one person is
    // exactly what the dispatch board does.
    expect(await listWorkIds(dispatcherToken, `&employeeId=${colleagueEmployeeId}`)).toEqual([
      pwColleague,
    ]);
  });

  it('scopes a technician who also holds report.view, as every real one does', async () => {
    // Guards the regression described on FIELD_TECHNICIAN_KEYS: a reporting key held by the
    // field tier must not read as oversight. Their team's work is theirs; a colleague's is not.
    const ids = await listWorkIds(fieldTechnicianToken);

    expect(ids).toContain(pwMyTeam);
    expect(ids).not.toContain(pwColleague);
    expect(ids).not.toContain(pwNobody);
  });

  it('narrows a technician further rather than replacing their scope', async () => {
    expect(await listWorkIds(technicianToken, `&employeeId=${technicianEmployeeId}`)).toEqual([
      pwMine,
    ]);
  });

  it('leaves the search term working alongside the scope', async () => {
    // Search occupies `$or`; the scope occupies `$and`. If either overwrote the other this
    // would return the colleague's work, or none.
    const ids = await listWorkIds(technicianToken, '&search=Хагас');
    expect(ids).toEqual(expect.arrayContaining([pwMine, pwMyTeam]));
    expect(ids).toHaveLength(2);
  });
});

/**
 * READ OVERSIGHT: the second permission set, and the reason there has to be one.
 *
 * FINANCE and SALES hold both view keys, hold no supervisory key, and typically have no
 * employee card at all. Bounding reads with `OVERSIGHT_PERMISSIONS` alone therefore emptied
 * their screens completely — an accountant cannot invoice a job they cannot see. Adding
 * `invoice.view` to that set would have fixed the read and simultaneously handed every
 * accountant authority to drive any job in the company through its lifecycle, so the keys
 * live in `READ_OVERSIGHT_PERMISSIONS` and are reachable only from the read path.
 *
 * Both halves are asserted here, because the pair IS the requirement: sees everything,
 * touches nothing.
 */
describe('a read-oversight role sees everything and still cannot act', () => {
  it('answers FINANCE with every planned work despite having no employee card', async () => {
    const ids = await listWorkIds(financeToken);
    expect(ids).toEqual(
      expect.arrayContaining([pwMine, pwMyTeam, pwColleague, pwNobody]),
    );
    expect(ids).toHaveLength(4);
  });

  it('answers FINANCE with every service request', async () => {
    const numbers = await listRequestNumbers(financeToken);
    expect(numbers).toEqual(
      expect.arrayContaining([srMine, srMyTeam, srColleague, srOpen]),
    );
    expect(numbers).toHaveLength(4);
  });

  it('opens any single record for FINANCE', async () => {
    // The per-record read consults the same union, so an accountant following a link out of
    // an invoice reaches the job rather than a 404.
    const work = await request(app)
      .get(`${API}/planned-work/${pwColleague}`)
      .set('Authorization', `Bearer ${financeToken}`);
    expect(work.status).toBe(200);

    const req = await request(app)
      .get(`${API}/service-requests/${srColleagueId}`)
      .set('Authorization', `Bearer ${financeToken}`);
    expect(req.status).toBe(200);
  });

  it('does not let reading everything become touching anything', async () => {
    // `report.view` and `invoice.view` are absent from OVERSIGHT_PERMISSIONS on purpose.
    // If somebody ever "simplifies" the two sets into one, this is the test that fails.
    const transition = await request(app)
      .post(`${API}/planned-work/${pwColleague}/transition`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ action: 'PLAN' });
    // 403 either way — the permission gate refuses before scope is even consulted, which
    // is the belt to the scope's braces.
    expect(transition.status).toBe(403);

    const update = await request(app)
      .patch(`${API}/planned-work/${pwColleague}`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ title: 'Санхүү өөрчиллөө' });
    expect(update.status).toBe(403);

    const assign = await request(app)
      .post(`${API}/service-requests/${srColleagueId}/assign`)
      .set('Authorization', `Bearer ${financeToken}`)
      .send({ employeeIds: [technicianEmployeeId] });
    expect(assign.status).toBe(403);
  });
});

describe('GET /service-requests is bounded by assignment', () => {
  it('answers a technician with their own, their team\'s, and the open queue', async () => {
    const numbers = await listRequestNumbers(technicianToken);

    expect(numbers).toContain(srMine);
    expect(numbers).toContain(srMyTeam);
    // Unclaimed work is the pool the "Нээлттэй" segment lists and `POST /:id/claim` takes
    // from; hiding it would leave the claim endpoint with no reachable input.
    expect(numbers).toContain(srOpen);

    expect(numbers).not.toContain(srColleague);
    expect(numbers).toHaveLength(3);
  });

  it('counts a caller as assigned through their team alone', async () => {
    const numbers = await listRequestNumbers(teamMateToken);
    expect(numbers).toEqual(expect.arrayContaining([srMyTeam, srOpen]));
    expect(numbers).toHaveLength(2);
  });

  it('gives an unlinked account the open queue and nobody else\'s work', async () => {
    expect(await listRequestNumbers(unlinkedToken)).toEqual([srOpen]);
  });

  it('still shows a dispatcher every request in the company', async () => {
    const numbers = await listRequestNumbers(dispatcherToken);
    expect(numbers).toEqual(
      expect.arrayContaining([srMine, srMyTeam, srColleague, srOpen]),
    );
    expect(numbers).toHaveLength(4);
  });

  it('refuses to let a query parameter widen the scope', async () => {
    expect(
      await listRequestNumbers(technicianToken, `&employeeId=${colleagueEmployeeId}`),
    ).toEqual([]);
  });

  it('keeps employeeId working as narrowing for a caller who may see everything', async () => {
    expect(
      await listRequestNumbers(dispatcherToken, `&employeeId=${colleagueEmployeeId}`),
    ).toEqual([srColleague]);
  });

  it('does not let a colleague\'s request through on a search term', async () => {
    expect(await listRequestNumbers(technicianToken, '&search=Хамт олны')).toEqual([]);
    expect(await listRequestNumbers(colleagueToken, '&search=Хамт олны')).toEqual([srColleague]);
  });
});

/**
 * SINGLE-RECORD READS, which the list scope on its own left wide open.
 *
 * Bounding only the list narrowed what a technician is HANDED without narrowing what they
 * can ASK FOR: `GET /planned-work/:id` and `GET /service-requests/:id` still answered any
 * id to anyone holding the view key. The ids are 24 hex characters, so walking them is not
 * the threat — a leaked link, a forwarded notification or a shared screenshot is.
 *
 * Answered 404 and never 403, matching `assertInCustomerScope`: a "forbidden" confirms the
 * id names a real record, which is exactly the fact being withheld.
 */
describe('single-record reads are bounded by the same rule', () => {
  async function getWork(bearer: string, id: string): Promise<request.Response> {
    return request(app)
      .get(`${API}/planned-work/${id}`)
      .set('Authorization', `Bearer ${bearer}`);
  }

  async function getRequest(bearer: string, id: string): Promise<request.Response> {
    return request(app)
      .get(`${API}/service-requests/${id}`)
      .set('Authorization', `Bearer ${bearer}`);
  }

  it('opens the technician their own and their team\'s planned work', async () => {
    expect((await getWork(technicianToken, pwMine)).status).toBe(200);
    expect((await getWork(technicianToken, pwMyTeam)).status).toBe(200);
    // The team-mate is named on nothing individually and still opens the team's job.
    expect((await getWork(teamMateToken, pwMyTeam)).status).toBe(200);
  });

  it('answers a colleague\'s planned work as if it did not exist', async () => {
    const denied = await getWork(technicianToken, pwColleague);
    const invented = await getWork(technicianToken, '0'.repeat(24));

    expect(denied.status).toBe(404);
    expect(invented.status).toBe(404);
    // Same status AND same body: a difference in either is the oracle.
    expect(denied.body.message).toBe(invented.body.message);
  });

  it('does not hand a technician an unassigned planned work', async () => {
    // Planned work has no claim flow, so "nobody holds it" is not a reason to show it.
    expect((await getWork(technicianToken, pwNobody)).status).toBe(404);
    expect((await getWork(dispatcherToken, pwNobody)).status).toBe(200);
  });

  it('opens the technician their own service request and hides a colleague\'s', async () => {
    expect((await getRequest(technicianToken, srMineId)).status).toBe(200);

    const denied = await getRequest(technicianToken, srColleagueId);
    expect(denied.status).toBe(404);
    expect(denied.body.message).toBe(
      (await getRequest(technicianToken, '0'.repeat(24))).body.message,
    );
  });

  /**
   * THE REGRESSION THIS CHANGE MOST EASILY INTRODUCES.
   *
   * The "Нээлттэй" segment lists requests nobody holds and the technician taps one to read
   * the fault description before deciding to take it. If the detail read applied the
   * assigned-or-team rule without the unclaimed allowance, every row in that list would
   * 404 on tap — a list of jobs that vanish when touched — and `POST /:id/claim` would stay
   * routed and guarded while being unreachable from the only screen that offers it.
   *
   * So: list it, open it, claim it, and then confirm it is still open to the person who
   * now holds it. That is the whole employee-app sequence in one case.
   */
  it('lets an unassigned technician open an unclaimed request, then claim it', async () => {
    // Exactly what the employee app asks for: `listOpenServiceRequests` issues one call
    // per claimable status and merges the pages, so the pool is NEW plus UNASSIGNED.
    const openPool = [
      ...(await listRequestNumbers(technicianToken, '&status=NEW')),
      ...(await listRequestNumbers(technicianToken, '&status=UNASSIGNED')),
    ];
    expect(openPool).toContain(srOpen);

    const opened = await getRequest(technicianToken, srOpenId);
    expect(opened.status).toBe(200);
    expect(opened.body.data.requestNumber).toBe(srOpen);

    const claimed = await request(app)
      .post(`${API}/service-requests/${srOpenId}/claim`)
      .set('Authorization', `Bearer ${technicianToken}`);
    expect(claimed.status).toBe(200);

    // The claim response is itself a detail read, so a broken scope would 404 the very
    // request the caller has just been given.
    expect(claimed.body.data.requestNumber).toBe(srOpen);

    // Still readable afterwards — now through the assigned branch rather than the
    // unclaimed one, since it is no longer unclaimed.
    expect((await getRequest(technicianToken, srOpenId)).status).toBe(200);

    // And it has left the open queue for everybody else who is scoped.
    expect(await listRequestNumbers(colleagueToken)).not.toContain(srOpen);
    expect((await getRequest(colleagueToken, srOpenId)).status).toBe(404);
  });
});
