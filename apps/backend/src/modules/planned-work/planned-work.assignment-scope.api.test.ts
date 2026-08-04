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
import { InspectionReport } from '../inspection-report/inspection-report.model';
import { Team } from '../org/org.models';
import { StoredFile } from '../storage/stored-file.model';
import { PlannedWork, PlannedWorkReport, PlannedWorkTask } from './planned-work.models';

/**
 * PLANNED-WORK ASSIGNMENT SCOPE.
 *
 * The hole these tests close was live and reproducible: a technician who had never been
 * assigned to a planned work drove it through PLAN, START, PAUSE, RESUME and COMPLETE, and
 * also recorded task progress, uploaded evidence and submitted the report. Holding
 * `planned_work.change_status` was authority over every job in the company.
 *
 * The permission sets below are the load-bearing part of the fixture. `TECHNICIAN_KEYS` is
 * exactly the planned-work half of the seeded TECHNICIAN default, and `SUPERVISOR_KEYS`
 * adds `planned_work.update`, which is one of the oversight keys. Both callers can perform
 * every action under test as far as the permission gate is concerned; only the data scope
 * differs, which is what makes these tests about scope rather than about permissions.
 */

const API = '/api/v1';

/** The planned-work keys the seeded TECHNICIAN role grants, and nothing more. */
const TECHNICIAN_KEYS = [
  PERMISSIONS.PLANNED_WORK_VIEW,
  PERMISSIONS.PLANNED_WORK_CHANGE_STATUS,
  PERMISSIONS.PLANNED_WORK_RECORD_PROGRESS,
  PERMISSIONS.PLANNED_WORK_SUBMIT_REPORT,
] as const;

/** A planner: the same doing keys plus one oversight key. */
const SUPERVISOR_KEYS = [
  ...TECHNICIAN_KEYS,
  PERMISSIONS.PLANNED_WORK_CREATE,
  PERMISSIONS.PLANNED_WORK_UPDATE,
] as const;

/** A dispatcher as seeded: no planned-work write key beyond the doing ones. */
const DISPATCHER_KEYS = [...TECHNICIAN_KEYS, PERMISSIONS.DISPATCH_ASSIGN] as const;

let app: Express;
let org: OrgFixture;
let objects: ObjectFixture;

/** Bearer tokens. */
let supervisorToken: string;
let assignedToken: string;
let strangerToken: string;
let teamMateToken: string;
let dispatcherToken: string;

let assignedEmployeeId: string;
let strangerEmployeeId: string;
let otherTeamId: string;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  expect(response.status).toBe(200);
  return response.body.data.tokens.accessToken as string;
}

/**
 * Creates an account holding `permissions` and, when a team is given or not, an employee
 * card linked to it. The link is what `AuthContext.employeeId` resolves from, so this is
 * the only way to make a caller "an employee" as far as the policy is concerned.
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

function validWork(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    projectId: objects.projectId,
    buildingId: objects.buildingId,
    title: 'Хагас жилийн урьдчилан сэргийлэх үзлэг',
    plannedStartDate: '2026-07-01T00:00:00.000Z',
    plannedEndDate: '2026-07-31T00:00:00.000Z',
    assignedEmployeeIds: [],
    ...overrides,
  };
}

/** A work created by the supervisor, so creation authority is never the thing under test. */
async function createWork(overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await request(app)
    .post(`${API}/planned-work`)
    .set('Authorization', `Bearer ${supervisorToken}`)
    .send(validWork(overrides));
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

async function addTask(workId: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await request(app)
    .post(`${API}/planned-work/${workId}/tasks`)
    .set('Authorization', `Bearer ${supervisorToken}`)
    .send({
      floorId: objects.floorId,
      title: 'Самбарын үзлэг',
      unit: 'PIECE',
      totalQuantity: 10,
      plannedStartDate: '2026-07-05T00:00:00.000Z',
      plannedEndDate: '2026-07-20T00:00:00.000Z',
      ...overrides,
    });
  expect(response.status).toBe(201);
  const tasks = response.body.data.tasks as { id: string }[];
  return tasks[tasks.length - 1]!.id;
}

async function transition(
  workId: string,
  action: string,
  bearer: string,
  reason?: string,
): Promise<request.Response> {
  return request(app)
    .post(`${API}/planned-work/${workId}/transition`)
    .set('Authorization', `Bearer ${bearer}`)
    .send({ action, ...(reason ? { reason } : {}) });
}

/**
 * The cast is built ONCE.
 *
 * `POST /auth/login` is rate limited to 100 per IP per fifteen minutes outside production,
 * and this suite needs five signed-in identities. Rebuilding them per test spent the whole
 * budget by the twentieth case and the suite began failing on 429s that had nothing to do
 * with the policy. Only the planned-work records are reset between tests; the org, the
 * object hierarchy, the accounts and their employee cards persist for the file.
 */
beforeAll(async () => {
  app = await startTestApp();
  await resetDomainCollections();

  org = await createOrgFixture();
  objects = await createObjectFixture();

  const otherTeam = await Team.create({
    company: org.companyId,
    department: org.departmentId,
    code: 'TEAM2',
    name: 'Баг 2',
  });
  otherTeamId = String(otherTeam._id);

  const supervisor = await createStaff('pwsup@test.mn', 'SUP-1', SUPERVISOR_KEYS, null);
  supervisorToken = supervisor.token;

  const assigned = await createStaff('pwassigned@test.mn', 'TECH-1', TECHNICIAN_KEYS, org.teamId);
  assignedToken = assigned.token;
  assignedEmployeeId = assigned.employeeId;

  // Same permissions, a different team, and never named on any work.
  const stranger = await createStaff('pwstranger@test.mn', 'TECH-2', TECHNICIAN_KEYS, otherTeamId);
  strangerToken = stranger.token;
  strangerEmployeeId = stranger.employeeId;

  // On the team a work is assigned to, but not named individually.
  const teamMate = await createStaff('pwmate@test.mn', 'TECH-3', TECHNICIAN_KEYS, org.teamId);
  teamMateToken = teamMate.token;

  const dispatcher = await createStaff('pwdisp@test.mn', 'DISP-1', DISPATCHER_KEYS, otherTeamId);
  dispatcherToken = dispatcher.token;
});

afterAll(async () => {
  await stopTestApp();
});

beforeEach(async () => {
  await Promise.all([
    PlannedWork.deleteMany({}),
    PlannedWorkTask.deleteMany({}),
    PlannedWorkReport.deleteMany({}),
    InspectionReport.deleteMany({}),
    StoredFile.deleteMany({}),
    // The audit log is append-only at the schema level, so it is left alone. Nothing here
    // asserts on it, and rows accumulating across cases is harmless.
  ]);

  // Several cases move an employee between teams; put everyone back where they started.
  await Promise.all([
    Employee.updateOne({ _id: assignedEmployeeId }, { $set: { team: org.teamId } }),
    Employee.updateOne({ _id: strangerEmployeeId }, { $set: { team: otherTeamId } }),
  ]);
});

/** A PLANNED work assigned to `assignedEmployeeId` and to no team. */
async function plannedWorkForAssignee(): Promise<string> {
  const workId = await createWork({ assignedEmployeeIds: [assignedEmployeeId] });
  expect((await transition(workId, 'PLAN', supervisorToken)).status).toBe(200);
  return workId;
}

describe('the proven hole: an unassigned technician driving the lifecycle', () => {
  it('refuses PLAN, START, PAUSE, RESUME and COMPLETE to a stranger', async () => {
    const workId = await createWork({ assignedEmployeeIds: [assignedEmployeeId] });

    // DRAFT -> PLANNED. The stranger holds planned_work.change_status, so the permission
    // gate passes and only the assignment scope stands between them and the job.
    const plan = await transition(workId, 'PLAN', strangerToken);
    expect(plan.status).toBe(403);
    expect(plan.body.message).toContain('хуваарилагдаагүй');
    expect((await PlannedWork.findById(workId))!.status).toBe('DRAFT');

    // Drive it forward with the supervisor so each later action is genuinely available.
    await transition(workId, 'PLAN', supervisorToken);
    expect((await transition(workId, 'START', strangerToken)).status).toBe(403);

    await transition(workId, 'START', supervisorToken);
    expect((await transition(workId, 'PAUSE', strangerToken, 'Материал хүрэлцээгүй')).status).toBe(
      403,
    );

    await transition(workId, 'PAUSE', supervisorToken, 'Материал хүрэлцээгүй');
    expect((await transition(workId, 'RESUME', strangerToken)).status).toBe(403);

    await transition(workId, 'RESUME', supervisorToken);
    // COMPLETE would fail its own completion gate too, so assert the record never moved.
    expect((await transition(workId, 'COMPLETE', strangerToken)).status).toBe(403);
    expect((await PlannedWork.findById(workId))!.status).toBe('STARTED');
  });

  it('still lets the assigned technician run the same lifecycle', async () => {
    const workId = await plannedWorkForAssignee();

    expect((await transition(workId, 'START', assignedToken)).status).toBe(200);
    expect((await transition(workId, 'PAUSE', assignedToken, 'Хүчдэл тасарсан')).status).toBe(200);
    expect((await transition(workId, 'RESUME', assignedToken)).status).toBe(200);
    expect((await PlannedWork.findById(workId))!.status).toBe('STARTED');
  });
});

describe('team membership is a server-side fact', () => {
  it('admits a technician on the assigned team who is not named individually', async () => {
    const workId = await createWork({ assignedTeamId: org.teamId });
    await transition(workId, 'PLAN', supervisorToken);

    expect((await transition(workId, 'START', teamMateToken)).status).toBe(200);
  });

  it('refuses a technician on a different team', async () => {
    const workId = await createWork({ assignedTeamId: org.teamId });
    await transition(workId, 'PLAN', supervisorToken);

    expect((await transition(workId, 'START', strangerToken)).status).toBe(403);
  });

  it('does not let two unset teams match: a teamless work admits nobody by team', async () => {
    await Employee.updateOne({ _id: strangerEmployeeId }, { $set: { team: null } });
    // assignedTeam is null and the caller's team is null; that must not read as equal.
    const workId = await createWork({ assignedEmployeeIds: [assignedEmployeeId] });
    await transition(workId, 'PLAN', supervisorToken);

    expect((await transition(workId, 'START', strangerToken)).status).toBe(403);
  });

  it('follows a team change on the very next request, in both directions', async () => {
    const workId = await createWork({ assignedTeamId: org.teamId });
    await transition(workId, 'PLAN', supervisorToken);

    // Moved onto the assigned team: admitted without a new token.
    await Employee.updateOne({ _id: strangerEmployeeId }, { $set: { team: org.teamId } });
    expect((await transition(workId, 'START', strangerToken)).status).toBe(200);

    // Moved off it again: refused, again on the same token.
    await Employee.updateOne({ _id: strangerEmployeeId }, { $set: { team: otherTeamId } });
    expect((await transition(workId, 'PAUSE', strangerToken, 'Багаас гарсан')).status).toBe(403);
  });

  it('ignores a team claimed in the request body', async () => {
    const workId = await createWork({ assignedTeamId: org.teamId });
    await transition(workId, 'PLAN', supervisorToken);

    const response = await request(app)
      .post(`${API}/planned-work/${workId}/transition`)
      // Both a forged team and a forged acting employee, in one body.
      .set('Authorization', `Bearer ${strangerToken}`)
      .send({ action: 'START', teamId: org.teamId, employeeId: assignedEmployeeId });

    expect(response.status).toBe(403);
  });
});

describe('an account with no employee card', () => {
  it('is refused rather than treated as matching any assignment', async () => {
    const officeUser = await createUserWithPermissions('pwnocard@test.mn', [...TECHNICIAN_KEYS]);
    const officeToken = await login(officeUser.email, officeUser.password);

    const workId = await plannedWorkForAssignee();
    const response = await transition(workId, 'START', officeToken);

    expect(response.status).toBe(403);
    expect(response.body.message).toContain('хуваарилагдаагүй');
  });
});

describe('progress, evidence and report writes', () => {
  async function startedWork(): Promise<{ workId: string; taskId: string }> {
    const workId = await createWork({ assignedEmployeeIds: [assignedEmployeeId] });
    const taskId = await addTask(workId);
    await transition(workId, 'PLAN', supervisorToken);
    await transition(workId, 'START', supervisorToken);
    return { workId, taskId };
  }

  it('refuses task progress from a stranger and accepts it from the assignee', async () => {
    const { workId, taskId } = await startedWork();

    const refused = await request(app)
      .post(`${API}/planned-work/${workId}/tasks/${taskId}/progress`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .send({ completedQuantity: 4, score: 70 });
    expect(refused.status).toBe(403);
    expect((await PlannedWorkTask.findById(taskId))!.completedQuantity).toBe(0);

    const allowed = await request(app)
      .post(`${API}/planned-work/${workId}/tasks/${taskId}/progress`)
      .set('Authorization', `Bearer ${assignedToken}`)
      .send({ completedQuantity: 4, score: 70 });
    expect(allowed.status).toBe(200);
    expect((await PlannedWorkTask.findById(taskId))!.completedQuantity).toBe(4);
  });

  it('refuses an evidence photo upload from a stranger', async () => {
    const { workId, taskId } = await startedWork();

    const response = await request(app)
      .post(`${API}/planned-work/${workId}/tasks/${taskId}/photos`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .field('kind', 'BEFORE')
      .attach('file', Buffer.from('fake-image-bytes'), {
        filename: 'before.png',
        contentType: 'image/png',
      });

    expect(response.status).toBe(403);
    expect((await PlannedWorkTask.findById(taskId))!.beforePhotos).toHaveLength(0);
  });

  it('refuses removing an evidence photo the assignee uploaded', async () => {
    const { workId, taskId } = await startedWork();

    const upload = await request(app)
      .post(`${API}/planned-work/${workId}/tasks/${taskId}/photos`)
      .set('Authorization', `Bearer ${assignedToken}`)
      .field('kind', 'BEFORE')
      .attach('file', Buffer.from('fake-image-bytes'), {
        filename: 'before.png',
        contentType: 'image/png',
      });
    expect(upload.status).toBe(201);
    const fileId = String((await PlannedWorkTask.findById(taskId))!.beforePhotos[0]);

    const response = await request(app)
      .delete(`${API}/planned-work/${workId}/tasks/${taskId}/photos/${fileId}`)
      .set('Authorization', `Bearer ${strangerToken}`);

    expect(response.status).toBe(403);
    expect((await PlannedWorkTask.findById(taskId))!.beforePhotos).toHaveLength(1);
  });

  /** Drives a task to genuine completion so the report workflow can be reached. */
  async function completedWork(): Promise<string> {
    const { workId, taskId } = await startedWork();

    for (const kind of ['BEFORE', 'AFTER']) {
      const photo = await request(app)
        .post(`${API}/planned-work/${workId}/tasks/${taskId}/photos`)
        .set('Authorization', `Bearer ${assignedToken}`)
        .field('kind', kind)
        .attach('file', Buffer.from('fake-image-bytes'), {
          filename: `${kind.toLowerCase()}.png`,
          contentType: 'image/png',
        });
      expect(photo.status).toBe(201);
    }

    const progress = await request(app)
      .post(`${API}/planned-work/${workId}/tasks/${taskId}/progress`)
      .set('Authorization', `Bearer ${assignedToken}`)
      .send({
        completedQuantity: 10,
        note: 'Бүх самбар хэвийн.',
        score: 88,
        recommendation: 'Дараагийн үзлэгийг 6 сарын дараа хийх.',
      });
    expect(progress.status).toBe(200);

    expect((await transition(workId, 'COMPLETE', assignedToken)).status).toBe(200);
    return workId;
  }

  it('refuses editing and submitting the report from a stranger', async () => {
    const workId = await completedWork();

    const edit = await request(app)
      .patch(`${API}/planned-work/${workId}/report`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .send({ conclusion: 'Хэн нэгний ажлын дүгнэлт', recommendation: 'Юу ч биш' });
    expect(edit.status).toBe(403);

    const submit = await request(app)
      .post(`${API}/planned-work/${workId}/report/submit`)
      .set('Authorization', `Bearer ${strangerToken}`);
    expect(submit.status).toBe(403);
  });

  it('lets the assignee edit and submit the report', async () => {
    const workId = await completedWork();

    const edit = await request(app)
      .patch(`${API}/planned-work/${workId}/report`)
      .set('Authorization', `Bearer ${assignedToken}`)
      .send({ conclusion: 'Үзлэг бүрэн хийгдсэн.', recommendation: '6 сарын дараа дахин.' });
    expect(edit.status).toBe(200);

    const submit = await request(app)
      .post(`${API}/planned-work/${workId}/report/submit`)
      .set('Authorization', `Bearer ${assignedToken}`);
    expect(submit.status).toBe(200);
    expect(submit.body.data.report.status).toBe('SUBMITTED');
  });

  it('refuses the nested inspection-report writes to a stranger but not the read', async () => {
    const workId = await completedWork();

    // The guard is mounted for writes only, so the read still answers on
    // `planned_work.view` alone. Readiness is used because the report itself does not
    // exist yet and would legitimately 404.
    const read = await request(app)
      .get(`${API}/planned-work/${workId}/inspection-report/readiness`)
      .set('Authorization', `Bearer ${strangerToken}`);
    expect(read.status).toBe(200);

    const generate = await request(app)
      .post(`${API}/planned-work/${workId}/inspection-report`)
      .set('Authorization', `Bearer ${strangerToken}`);
    expect(generate.status).toBe(403);
    expect(generate.body.message).toContain('хуваарилагдаагүй');

    const submit = await request(app)
      .post(`${API}/planned-work/${workId}/inspection-report/submit`)
      .set('Authorization', `Bearer ${strangerToken}`);
    expect(submit.status).toBe(403);
  });
});

describe('a task must belong to the work it is reported against', () => {
  it('refuses progress on another job’s task even from an assigned caller', async () => {
    const mine = await createWork({ assignedEmployeeIds: [assignedEmployeeId] });
    await addTask(mine);
    await transition(mine, 'PLAN', supervisorToken);
    await transition(mine, 'START', supervisorToken);

    const theirs = await createWork({ title: 'Өөр ажил' });
    const theirTaskId = await addTask(theirs);

    const response = await request(app)
      // My work id — which passes the scope check — with their task id.
      .post(`${API}/planned-work/${mine}/tasks/${theirTaskId}/progress`)
      .set('Authorization', `Bearer ${assignedToken}`)
      .send({ completedQuantity: 3 });

    expect(response.status).toBe(404);
    expect((await PlannedWorkTask.findById(theirTaskId))!.completedQuantity).toBe(0);
  });
});

describe('broader access is preserved for oversight roles', () => {
  it('lets a dispatcher act on a work they are not assigned to', async () => {
    const workId = await plannedWorkForAssignee();
    // dispatch.assign, on a different team, named on nothing.
    expect((await transition(workId, 'START', dispatcherToken)).status).toBe(200);
  });

  it('lets a supervisor with planned_work.update act on any work', async () => {
    const workId = await plannedWorkForAssignee();
    expect((await transition(workId, 'START', supervisorToken)).status).toBe(200);
  });
});

describe('permission and data scope are independent', () => {
  it('does not lift the scope when a technician gains another doing permission', async () => {
    // Every planned-work key the field tier could plausibly accumulate, plus reschedule's
    // sibling doing keys — none of which is authority over someone else's job.
    const overreach = await createStaff(
      'pwoverreach@test.mn',
      'TECH-9',
      [...TECHNICIAN_KEYS, PERMISSIONS.OBJECT_MASTER_ASSESS],
      otherTeamId,
    );

    const workId = await plannedWorkForAssignee();
    const response = await transition(workId, 'START', overreach.token);

    expect(response.status).toBe(403);
  });

  it('keeps refusing after the permission gate has already passed', async () => {
    const workId = await plannedWorkForAssignee();

    // The stranger genuinely holds planned_work.change_status: prove it by showing the
    // same token succeeds on a work they ARE assigned to, and fails on this one.
    const ownWork = await createWork({ assignedEmployeeIds: [strangerEmployeeId] });
    await transition(ownWork, 'PLAN', supervisorToken);
    expect((await transition(ownWork, 'START', strangerToken)).status).toBe(200);

    expect((await transition(workId, 'START', strangerToken)).status).toBe(403);
  });
});

describe('availableActions never offers a button the write endpoint refuses', () => {
  it('is populated for the assignee', async () => {
    const workId = await plannedWorkForAssignee();

    const assignee = await request(app)
      .get(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${assignedToken}`);
    expect(assignee.status).toBe(200);
    const actions = (assignee.body.data.availableActions as { action: string }[]).map(
      (entry) => entry.action,
    );
    expect(actions).toContain('START');
  });

  /**
   * The stranger half of this used to assert 200 with an empty `availableActions`: the
   * detail read was open to anyone holding `planned_work.view`, and withholding the
   * buttons was the only defence the screen had.
   *
   * It is 404 now, and the empty-action assertion has nowhere left to live, because the
   * record itself is no longer reachable. That is the stronger outcome — a caller who
   * cannot see a job cannot be offered a button on it — and the reason this case is kept
   * rather than deleted: it pins WHICH of the two behaviours is current, so a future
   * change that reopens the read has to come back here and say so.
   *
   * Not-found and not forbidden, matching `assertInCustomerScope`: a 403 would confirm
   * the id is real and turn this endpoint into an oracle for probing identifiers.
   */
  it('answers a stranger not-found rather than a record with the buttons removed', async () => {
    const workId = await plannedWorkForAssignee();

    const stranger = await request(app)
      .get(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${strangerToken}`);

    expect(stranger.status).toBe(404);
    // Indistinguishable from an id that was never real, which is the whole point.
    const invented = await request(app)
      .get(`${API}/planned-work/${'0'.repeat(24)}`)
      .set('Authorization', `Bearer ${strangerToken}`);
    expect(invented.status).toBe(404);
    expect(stranger.body.message).toBe(invented.body.message);

    // The dispatcher still opens it, so this is scope and not a broken fixture.
    const dispatcher = await request(app)
      .get(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${dispatcherToken}`);
    expect(dispatcher.status).toBe(200);
  });
});

describe('an assignment change cannot be used to bypass the check', () => {
  it('refuses a technician who tries to add themselves to the crew', async () => {
    const workId = await plannedWorkForAssignee();

    // Reassignment is `planned_work.update`, an oversight key the field tier lacks.
    const response = await request(app)
      .patch(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .send({ assignedEmployeeIds: [strangerEmployeeId] });

    expect(response.status).toBe(403);
    const work = await PlannedWork.findById(workId);
    expect(work!.assignedEmployees.map(String)).toEqual([assignedEmployeeId]);
  });

  it('decides from persisted assignment, not from the request that changes it', async () => {
    const workId = await plannedWorkForAssignee();

    // A supervisor removing the assignee takes effect immediately for the assignee too.
    const reassign = await request(app)
      .patch(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send({ assignedEmployeeIds: [strangerEmployeeId] });
    expect(reassign.status).toBe(200);

    expect((await transition(workId, 'START', assignedToken)).status).toBe(403);
    expect((await transition(workId, 'START', strangerToken)).status).toBe(200);
  });
});
