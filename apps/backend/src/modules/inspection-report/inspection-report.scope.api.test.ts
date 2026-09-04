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
import { PlannedWork } from '../planned-work/planned-work.models';

/**
 * THE CONSOLIDATED INSPECTION REPORT IS THE FOURTH REPORT-READ FAMILY, AND IT WAS THE ONE
 * NOBODY SCOPED.
 *
 * `/report`, `/report/pdf` and `/report/photo-pdf` were each found reading through the raw
 * `findPlannedWorkOrThrow` and were each routed through `findReadableWorkOrThrow`. The
 * nested `/inspection-report`, `/inspection-report/pdf` and `/inspection-report/readiness`
 * sat one path segment away from them, on the same `planned_work.view` key that every
 * technician holds, loading through this module's own raw `findById` — and
 * `requirePlannedWorkAssignmentScope`, mounted above them, returns `next()` unconditionally
 * for GET, HEAD and OPTIONS on the stated premise that "the loader beneath has already
 * decided". Beneath these three it had not.
 *
 * WHAT THAT EXPOSED. The report DTO carries the customer, the project, the building, the
 * floors, the crew by name, the зөрчил list and the id of every attachment — and those file
 * ids are then redeemable at `GET /files/:fileId`. The PDF is the worse half, because it is
 * a file that leaves the building. Readiness is the smallest of the three and still names
 * the outstanding sub-tasks of a job the caller has no claim to.
 *
 * WHERE THE PREDICATE LIVES NOW: in this module's `findPlannedWorkOrThrow`, which every one
 * of the ten handlers loads through, so a future route added to this router cannot reach a
 * planned work without it. It is `resolveAssignedWorkFilter` — the same predicate
 * `getPlannedWorkById`, both list services and `findReadableWorkOrThrow` apply.
 *
 * 404 AND NOT 403, asserted rather than assumed: a refusal that confirmed the id names a
 * real job would turn the endpoint into an oracle for probing identifiers. The message is
 * the one the loader already raised for a genuinely absent work, so the two cases are not
 * merely the same status but the same response.
 *
 * OVERSIGHT MUST NOT NARROW. `resolveAssignedWorkFilter` returns null for a holder of an
 * oversight OR a read-oversight key, so dispatch, management and finance keep full reach.
 * Both are pinned below, because the tempting wrong fix — reusing
 * `assertPlannedWorkAssignmentScope`, the WRITE form — would silently lock an accountant
 * out of the report they have to bill from.
 */

const API = '/api/v1';

/** The planned-work keys the seeded TECHNICIAN role grants, and nothing more. */
const TECHNICIAN_KEYS = [
  PERMISSIONS.PLANNED_WORK_VIEW,
  PERMISSIONS.PLANNED_WORK_CHANGE_STATUS,
  PERMISSIONS.PLANNED_WORK_RECORD_PROGRESS,
  PERMISSIONS.PLANNED_WORK_SUBMIT_REPORT,
] as const;

/** A planner: the doing keys plus the oversight ones that lift the assignment bound. */
const SUPERVISOR_KEYS = [
  ...TECHNICIAN_KEYS,
  PERMISSIONS.PLANNED_WORK_CREATE,
  PERMISSIONS.PLANNED_WORK_UPDATE,
  PERMISSIONS.PLANNED_WORK_APPROVE,
] as const;

/** A dispatcher as seeded: `dispatch.assign` is a write-side oversight key. */
const DISPATCHER_KEYS = [...TECHNICIAN_KEYS, PERMISSIONS.DISPATCH_ASSIGN] as const;

/**
 * An accountant: `planned_work.view` plus `invoice.view` and no supervisory key at all.
 *
 * Deliberately given no employee card, which is the shape a real office account has — and
 * the shape that makes the read-oversight union load bearing, because with no card there
 * is no assignment that could ever name them.
 */
const FINANCE_KEYS = [PERMISSIONS.PLANNED_WORK_VIEW, PERMISSIONS.INVOICE_VIEW] as const;

let app: Express;
let org: OrgFixture;
let objects: ObjectFixture;

let supervisorToken: string;
let assignedToken: string;
let strangerToken: string;
let teamMateToken: string;
let dispatcherToken: string;
let financeToken: string;
let assignedEmployeeId: string;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  expect(response.status).toBe(200);
  return response.body.data.tokens.accessToken as string;
}

/**
 * An account plus the employee card it is linked to. The link is what `employeeId` resolves
 * from, so it is the only way to make a caller "an employee" as far as the scope is
 * concerned — an account without one matches no assignment at all.
 */
async function createStaff(
  email: string,
  code: string,
  permissions: readonly PermissionKey[],
  team: string | null = null,
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

  return { token: await login(user.email, user.password), employeeId: String(employee._id) };
}

const reportUrl = (workId: string, suffix = ''): string =>
  `${API}/planned-work/${workId}/inspection-report${suffix}`;

/** The three GETs under test, in one place so no case can quietly cover only two of them. */
const readPaths = (workId: string): string[] => [
  reportUrl(workId),
  reportUrl(workId, '/pdf'),
  reportUrl(workId, '/readiness'),
];

/**
 * A work whose single sub-task is finished and scored, with a generated report sitting in
 * DRAFT — so the assignee's read is a real 200 rather than "past the gate, 404 for a report
 * that was never made". Without the report the two refusals would be indistinguishable and
 * this file would be asserting nothing.
 *
 * Driven by the supervisor as far as approval (the create and approve keys) and by the
 * assignee from START onward, which is also what makes the assignee genuinely assigned
 * rather than merely permitted.
 */
async function reportedWork(): Promise<string> {
  const created = await request(app)
    .post(`${API}/planned-work`)
    .set('Authorization', `Bearer ${supervisorToken}`)
    .send({
      projectId: objects.projectId,
      buildingId: objects.buildingId,
      title: 'Хагас жилийн урьдчилан сэргийлэх үзлэг',
      plannedStartDate: '2026-07-01T00:00:00.000Z',
      plannedEndDate: '2099-07-31T00:00:00.000Z',
      assignedEmployeeIds: [],
    });
  expect(created.status).toBe(201);
  const workId = created.body.data.id as string;

  const task = await request(app)
    .post(`${API}/planned-work/${workId}/tasks`)
    .set('Authorization', `Bearer ${supervisorToken}`)
    .send({
      floorId: objects.floorId,
      title: 'Самбарын үзлэг',
      unit: 'PIECE',
      totalQuantity: 10,
      plannedStartDate: '2026-07-05T00:00:00.000Z',
      plannedEndDate: '2099-07-20T00:00:00.000Z',
    });
  expect(task.status).toBe(201);
  const taskId = (task.body.data.tasks as { id: string }[])[0]!.id;

  for (const action of ['PLAN', 'APPROVE']) {
    const response = await request(app)
      .post(`${API}/planned-work/${workId}/transition`)
      .set('Authorization', `Bearer ${supervisorToken}`)
      .send(
        action === 'APPROVE'
          ? { action, assignedEmployeeIds: [assignedEmployeeId] }
          : { action },
      );
    expect(response.status).toBe(200);
  }

  const start = await request(app)
    .post(`${API}/planned-work/${workId}/transition`)
    .set('Authorization', `Bearer ${assignedToken}`)
    .send({ action: 'START' });
  expect(start.status).toBe(200);

  for (const kind of ['BEFORE', 'AFTER']) {
    const uploaded = await request(app)
      .post(`${API}/planned-work/${workId}/tasks/${taskId}/photos`)
      .set('Authorization', `Bearer ${assignedToken}`)
      .field('kind', kind)
      .attach('file', Buffer.from('image-bytes'), {
        filename: `${kind.toLowerCase()}.png`,
        contentType: 'image/png',
      });
    expect(uploaded.status).toBe(201);
  }

  const progress = await request(app)
    .post(`${API}/planned-work/${workId}/tasks/${taskId}/progress`)
    .set('Authorization', `Bearer ${assignedToken}`)
    .send({
      completedQuantity: 10,
      note: 'Холболт хэвийн.',
      recommendation: 'Хагас жил тутам үзэх.',
      score: 88,
    });
  expect(progress.status).toBe(200);

  const generated = await request(app)
    .post(reportUrl(workId))
    .set('Authorization', `Bearer ${assignedToken}`);
  expect(generated.status).toBe(201);

  return workId;
}

/** Puts the work on the shared team, so the team branch of the predicate has something to match. */
async function putOnSharedTeam(workId: string): Promise<void> {
  await PlannedWork.updateOne({ _id: workId }, { $set: { assignedTeam: org.teamId } });
}

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

  const supervisor = await createStaff('ir-scope-sup@test.mn', 'SUP-IR1', SUPERVISOR_KEYS);
  supervisorToken = supervisor.token;

  const assigned = await createStaff('ir-scope-asg@test.mn', 'ASG-IR1', TECHNICIAN_KEYS);
  assignedToken = assigned.token;
  assignedEmployeeId = assigned.employeeId;

  // The stranger is on no crew and no team: the same tier, the same keys, a different job.
  const stranger = await createStaff('ir-scope-str@test.mn', 'STR-IR1', TECHNICIAN_KEYS);
  strangerToken = stranger.token;

  const teamMate = await createStaff('ir-scope-mate@test.mn', 'MATE-IR1', TECHNICIAN_KEYS, org.teamId);
  teamMateToken = teamMate.token;

  const dispatcher = await createStaff('ir-scope-dis@test.mn', 'DIS-IR1', DISPATCHER_KEYS);
  dispatcherToken = dispatcher.token;

  const finance = await createUserWithPermissions('ir-scope-fin@test.mn', [...FINANCE_KEYS]);
  financeToken = await login(finance.email, finance.password);
});

describe('the nested inspection-report reads obey the assignment scope', () => {
  it('refuses a technician who is not on the job, on all three reads alike', async () => {
    const workId = await reportedWork();

    // Gathered rather than asserted inside the loop, so a run that leaves one of the three
    // open names that route instead of stopping at the first.
    const answers: Record<string, { status: number; message: unknown }> = {};
    for (const path of readPaths(workId)) {
      const refused = await request(app)
        .get(path)
        .set('Authorization', `Bearer ${strangerToken}`);
      answers[path] = { status: refused.status, message: refused.body.message };
    }

    expect(answers).toEqual(
      Object.fromEntries(
        readPaths(workId).map((path) => [
          path,
          { status: 404, message: 'Төлөвлөгөөт ажил олдсонгүй.' },
        ]),
      ),
    );
  });

  it('is indistinguishable from an id that was never real', async () => {
    const workId = await reportedWork();
    const invented = '0'.repeat(24);

    for (const suffix of ['', '/pdf', '/readiness']) {
      const outOfScope = await request(app)
        .get(reportUrl(workId, suffix))
        .set('Authorization', `Bearer ${strangerToken}`);
      const nonExistent = await request(app)
        .get(reportUrl(invented, suffix))
        .set('Authorization', `Bearer ${strangerToken}`);

      expect(outOfScope.status, `${suffix} status`).toBe(nonExistent.status);
      expect(outOfScope.body.message, `${suffix} message`).toBe(nonExistent.body.message);
    }
  });

  it('serves the assignee all three reads', async () => {
    const workId = await reportedWork();

    const json = await request(app)
      .get(reportUrl(workId))
      .set('Authorization', `Bearer ${assignedToken}`);
    expect(json.status).toBe(200);
    expect(json.body.data.workNumber).toBeDefined();

    const readiness = await request(app)
      .get(reportUrl(workId, '/readiness'))
      .set('Authorization', `Bearer ${assignedToken}`);
    expect(readiness.status).toBe(200);
    expect(readiness.body.data.canGenerate).toBe(true);

    const pdf = await request(app)
      .get(reportUrl(workId, '/pdf'))
      .set('Authorization', `Bearer ${assignedToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(pdf.status).toBe(200);
    expect((pdf.body as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('serves a team mate on the same team as the work', async () => {
    const workId = await reportedWork();
    await putOnSharedTeam(workId);

    for (const path of readPaths(workId)) {
      const admitted = await request(app)
        .get(path)
        .set('Authorization', `Bearer ${teamMateToken}`);
      expect(admitted.status, `${path} must admit a team mate`).toBe(200);
    }
  });

  it('leaves a write-oversight holder unbounded', async () => {
    const workId = await reportedWork();

    for (const path of readPaths(workId)) {
      const admitted = await request(app)
        .get(path)
        .set('Authorization', `Bearer ${dispatcherToken}`);
      // On no crew and no team; `dispatch.assign` is what lifts the bound. This is what
      // makes the refusal above scope rather than a blanket lock-out.
      expect(admitted.status, `${path} must admit a dispatcher`).toBe(200);
    }
  });

  it('leaves a read-oversight holder unbounded', async () => {
    const workId = await reportedWork();

    for (const path of readPaths(workId)) {
      const admitted = await request(app)
        .get(path)
        .set('Authorization', `Bearer ${financeToken}`);
      // No employee card at all, so every assignment branch is empty for this caller.
      // `invoice.view` is the only reason they are admitted, and an accountant who cannot
      // read the report cannot bill the job it belongs to.
      expect(admitted.status, `${path} must admit finance`).toBe(200);
    }
  });
});
