import { PERMISSIONS } from '@monhorus/shared';
import type { Express } from 'express';
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { AuthContext } from '../../common/types/express';
import {
  createObjectFixture,
  createOrgFixture,
  createSuperUser,
  createUserWithPermissions,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
  type ObjectFixture,
  type OrgFixture,
  type TestUser,
} from '../../test/helpers';
import { AuditLog } from '../audit/audit-log.model';
import { Employee } from '../employee/employee.model';
import {
  ObjectAssessment,
  ObjectRecord,
  ObjectType,
} from '../object-master/object-master.models';
import { Customer, ObjectNode } from '../objects/object.models';
import { Report, ReportItem } from '../report-record/report-record.model';
import { applyReportToEquipment } from '../report-record/report-record.service';
import { PlannedWork, PlannedWorkReport, PlannedWorkTask } from './planned-work.models';
import { writeCanonicalPlannedWorkReport } from './planned-work.transition.service';

const API = '/api/v1';

/** The employee-side role: can run the work and author the report, cannot approve. */
const AUTHOR_PERMISSIONS = [
  PERMISSIONS.PLANNED_WORK_VIEW,
  PERMISSIONS.PLANNED_WORK_CREATE,
  PERMISSIONS.PLANNED_WORK_UPDATE,
  PERMISSIONS.PLANNED_WORK_CHANGE_STATUS,
  PERMISSIONS.PLANNED_WORK_RECORD_PROGRESS,
  PERMISSIONS.PLANNED_WORK_SUBMIT_REPORT,
] as const;

/** The reviewer-side role: may approve and return, and may also read. */
const APPROVER_PERMISSIONS = [
  PERMISSIONS.PLANNED_WORK_VIEW,
  PERMISSIONS.PLANNED_WORK_APPROVE_REPORT,
] as const;

let app: Express;
let org: OrgFixture;
let objects: ObjectFixture;
let author: TestUser;
let authorToken: string;
let approverToken: string;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  return response.body.data.tokens.accessToken as string;
}

async function createWork(overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await request(app)
    .post(`${API}/planned-work`)
    .set('Authorization', `Bearer ${authorToken}`)
    .send({
      projectId: objects.projectId,
      buildingId: objects.buildingId,
      title: 'Улирлын үзлэг',
      plannedStartDate: '2026-07-01T00:00:00.000Z',
      plannedEndDate: '2099-07-31T00:00:00.000Z',
      assignedEmployeeIds: [],
      ...overrides,
    });
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

async function addTask(
  workId: string,
  totalQuantity = 10,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const response = await request(app)
    .post(`${API}/planned-work/${workId}/tasks`)
    .set('Authorization', `Bearer ${authorToken}`)
    .send({
      floorId: objects.floorId,
      title: 'Самбарын үзлэг',
      unit: 'PIECE',
      totalQuantity,
      plannedStartDate: '2026-07-05T00:00:00.000Z',
      plannedEndDate: '2099-07-20T00:00:00.000Z',
      ...overrides,
    });
  expect(response.status).toBe(201);
  // Found by title rather than by position: the payload is sorted by planned date then
  // title, so on a work with several sub-tasks the last element is not the new one.
  const title = (overrides.title as string | undefined) ?? 'Самбарын үзлэг';
  const tasks = response.body.data.tasks as { id: string; title: string }[];
  return tasks.find((task) => task.title === title)!.id;
}

async function transition(workId: string, action: string, reason?: string): Promise<void> {
  const response = await request(app)
    .post(`${API}/planned-work/${workId}/transition`)
    .set('Authorization', `Bearer ${authorToken}`)
    .send({ action, ...(reason ? { reason } : {}) });
  expect(response.status).toBe(200);
}

async function completeTask(workId: string, taskId: string, quantity = 10): Promise<void> {
  for (const kind of ['BEFORE', 'AFTER']) {
    const response = await request(app)
      .post(`${API}/planned-work/${workId}/tasks/${taskId}/photos`)
      .set('Authorization', `Bearer ${authorToken}`)
      .field('kind', kind)
      .attach('file', Buffer.from('image-bytes'), {
        filename: `${kind.toLowerCase()}.png`,
        contentType: 'image/png',
      });
    expect(response.status).toBe(201);
  }

  const progress = await request(app)
    .post(`${API}/planned-work/${workId}/tasks/${taskId}/progress`)
    .set('Authorization', `Bearer ${authorToken}`)
    .send({
      completedQuantity: quantity,
      note: 'Самбар хэвийн ажиллаж байна.',
      conclusion: 'Самбар цаашид ашиглахад тохиромжтой.',
      score: 88,
      recommendation: 'Дараагийн үзлэгийг хагас жилийн дараа хийх.',
    });
  expect(progress.status).toBe(200);
}

/** A work at COMPLETED with its report in DRAFT, authored by the author user. */
async function completedWork(overrides: Record<string, unknown> = {}): Promise<string> {
  const workId = await createWork(overrides);
  const taskId = await addTask(workId);
  await transition(workId, 'PLAN');
  await transition(workId, 'START');
  await completeTask(workId, taskId);
  await transition(workId, 'COMPLETE');
  return workId;
}

async function fillReport(workId: string): Promise<void> {
  const response = await request(app)
    .patch(`${API}/planned-work/${workId}/report`)
    .set('Authorization', `Bearer ${authorToken}`)
    .send({
      conclusion: 'Ажил төлөвлөгөөний дагуу бүрэн хийгдсэн.',
      recommendation: 'Тоног төхөөрөмжийг хагас жил тутам үзэх.',
    });
  expect(response.status).toBe(200);
}

async function submitReport(workId: string): Promise<request.Response> {
  return request(app)
    .post(`${API}/planned-work/${workId}/report/submit`)
    .set('Authorization', `Bearer ${authorToken}`);
}

/** A work whose report is filled in and submitted, awaiting review. */
async function submittedWork(): Promise<string> {
  const workId = await completedWork();
  await fillReport(workId);
  const submitted = await submitReport(workId);
  expect(submitted.status).toBe(200);
  return workId;
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

  author = await createUserWithPermissions('pwauthor@test.mn', AUTHOR_PERMISSIONS);
  authorToken = await login(author.email, author.password);

  const approver = await createUserWithPermissions('pwapprover@test.mn', APPROVER_PERMISSIONS);
  approverToken = await login(approver.email, approver.password);
});

describe('report creation', () => {
  it('creates the report in DRAFT when the work completes, and audits it', async () => {
    const workId = await completedWork();

    const report = await PlannedWorkReport.findOne({ plannedWork: workId });
    expect(report?.status).toBe('DRAFT');
    expect(report?.createdByName).not.toBeNull();

    const events = await AuditLog.find({ action: 'REPORT_CREATED' });
    expect(events).toHaveLength(1);
  });

  it('exposes no report before the work is completed', async () => {
    const workId = await createWork();

    const response = await request(app)
      .get(`${API}/planned-work/${workId}/report`)
      .set('Authorization', `Bearer ${authorToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.report).toBeNull();
  });

  it('assembles a preview containing the tasks, floors and totals', async () => {
    const workId = await completedWork();

    const response = await request(app)
      .get(`${API}/planned-work/${workId}/report`)
      .set('Authorization', `Bearer ${authorToken}`);

    expect(response.status).toBe(200);
    const preview = response.body.data.preview;
    expect(preview.workNumber).toMatch(/^PW-/);
    expect(preview.customerName).toBe('Central Tower ХХК');
    expect(preview.projectName).toBe('Урьдчилан сэргийлэх үйлчилгээ');
    expect(preview.buildingName).toBe('Төв барилга');
    expect(preview.progressPercent).toBe(100);
    expect(preview.tasks).toHaveLength(1);
    expect(preview.tasks[0].beforePhotoCount).toBe(1);
    expect(preview.tasks[0].afterPhotoCount).toBe(1);
    expect(preview.floorProgress).toHaveLength(1);
  });

  /**
   * The preview null-return doubles as a submission blocker, so a project-less work
   * whose preview refused to build could never send its report at all.
   */
  it('assembles the preview and accepts submission for a work with no project', async () => {
    const workId = await completedWork({ projectId: null, title: 'Дотоод засвар' });
    await fillReport(workId);

    const response = await request(app)
      .get(`${API}/planned-work/${workId}/report`)
      .set('Authorization', `Bearer ${authorToken}`);

    expect(response.status).toBe(200);
    const preview = response.body.data.preview;
    expect(preview).not.toBeNull();
    expect(preview.projectName).toBeNull();
    expect(preview.customerName).toBe('Central Tower ХХК');
    expect(preview.buildingName).toBe('Төв барилга');
    expect(response.body.data.report.submissionBlockers).toEqual([]);

    const submitted = await submitReport(workId);
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.report.status).toBe('SUBMITTED');
  });

  it('writes an audit record when the report body is edited', async () => {
    const workId = await completedWork();
    await fillReport(workId);

    const events = await AuditLog.find({ action: 'REPORT_UPDATED' });
    expect(events).toHaveLength(1);
  });
});

/**
 * Authoring the write-up DURING the job.
 *
 * The report used to exist only after COMPLETE, which meant the technician had nowhere to
 * write the Дүгнэлт and Зөвлөмж for the whole time they were doing the work: the PATCH
 * answered 404 with "Ажлыг дуусгасны дараа тайлан үүснэ". These cases pin the lazy open and
 * the convergence of the two creation paths onto one row.
 */
describe('report authored before completion', () => {
  it('opens the report in DRAFT on the first PATCH of a work in flight', async () => {
    const workId = await createWork();
    await addTask(workId);
    await transition(workId, 'PLAN');
    await transition(workId, 'START');

    const response = await request(app)
      .patch(`${API}/planned-work/${workId}/report`)
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ conclusion: 'Хагас хийгдсэн байдлаар тэмдэглэв.' });

    expect(response.status).toBe(200);
    // The work itself has not moved: writing the report is not a lifecycle action.
    expect(response.body.data.lifecycleStatus).toBe('STARTED');
    expect(response.body.data.report.status).toBe('DRAFT');
    expect(response.body.data.report.conclusion).toBe('Хагас хийгдсэн байдлаар тэмдэглэв.');

    const report = await PlannedWorkReport.findOne({ plannedWork: workId });
    expect(report?.status).toBe('DRAFT');
    // Same stamps the COMPLETE path writes, so the two paths are indistinguishable.
    expect(report?.createdByName).not.toBeNull();
    expect(report?.submittedAt).toBeNull();

    const created = await AuditLog.find({ action: 'REPORT_CREATED' });
    expect(created).toHaveLength(1);
  });

  it('updates the one row rather than opening a second on a repeat PATCH', async () => {
    const workId = await createWork();
    await transition(workId, 'PLAN');

    const first = await request(app)
      .patch(`${API}/planned-work/${workId}/report`)
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ conclusion: 'Анхны хувилбар.' });
    expect(first.status).toBe(200);

    const second = await request(app)
      .patch(`${API}/planned-work/${workId}/report`)
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ conclusion: 'Засварласан хувилбар.', recommendation: 'Хагас жил тутам үзэх.' });
    expect(second.status).toBe(200);

    expect(await PlannedWorkReport.countDocuments({ plannedWork: workId })).toBe(1);
    const report = await PlannedWorkReport.findOne({ plannedWork: workId });
    expect(report?.conclusion).toBe('Засварласан хувилбар.');
    expect(report?.recommendation).toBe('Хагас жил тутам үзэх.');
  });

  it('completes a work whose draft already exists without duplicating the report', async () => {
    const workId = await createWork();
    const taskId = await addTask(workId);
    await transition(workId, 'PLAN');
    await transition(workId, 'START');

    // The draft is opened by the technician mid-job, before COMPLETE ever runs.
    await fillReport(workId);
    const before = await PlannedWorkReport.findOne({ plannedWork: workId });

    await completeTask(workId, taskId);
    await transition(workId, 'COMPLETE');

    expect(await PlannedWorkReport.countDocuments({ plannedWork: workId })).toBe(1);
    const after = await PlannedWorkReport.findOne({ plannedWork: workId });
    expect(String(after?._id)).toBe(String(before?._id));
    // The text the technician wrote survives completion untouched.
    expect(after?.conclusion).toBe('Ажил төлөвлөгөөний дагуу бүрэн хийгдсэн.');
    // And completion does not claim authorship of a report it did not open.
    expect(await AuditLog.countDocuments({ action: 'REPORT_CREATED' })).toBe(1);

    // The report is submittable straight away: the gates are unchanged, they simply pass.
    const submitted = await submitReport(workId);
    expect(submitted.status).toBe(200);
    expect(submitted.body.data.report.status).toBe('SUBMITTED');
  });

  it('still refuses the first PATCH from a technician the work is not assigned to', async () => {
    const workId = await createWork();
    await transition(workId, 'PLAN');

    // A field-tier account: `planned_work.submit_report` and nothing that lifts the
    // assignment scope, with the employee card the policy resolves the caller from.
    const stranger = await createUserWithPermissions('pwstranger@test.mn', [
      PERMISSIONS.PLANNED_WORK_VIEW,
      PERMISSIONS.PLANNED_WORK_SUBMIT_REPORT,
    ]);
    await Employee.create({
      employeeCode: 'RPT-TECH-1',
      firstName: 'Дорж',
      lastName: 'Бат',
      company: org.companyId,
      department: org.departmentId,
      position: org.positionId,
      team: org.teamId,
      employeeType: 'FULL_TIME',
      employmentStartDate: new Date('2024-01-01'),
      status: 'ACTIVE',
      systemUser: stranger.userId,
    });
    const strangerToken = await login(stranger.email, stranger.password);

    const response = await request(app)
      .patch(`${API}/planned-work/${workId}/report`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .send({ conclusion: 'Хэн нэгний ажлын дүгнэлт' });

    expect(response.status).toBe(403);
    expect(response.body.message).toContain('хуваарилагдаагүй');
    // Refused before anything was written: probing the endpoint creates no row.
    expect(await PlannedWorkReport.countDocuments({ plannedWork: workId })).toBe(0);
  });
});

describe('report submission requirements', () => {
  it('blocks submission while the consolidated conclusion is missing', async () => {
    const workId = await completedWork();

    const response = await submitReport(workId);

    expect(response.status).toBe(400);
    const messages = JSON.stringify(response.body.issues);
    expect(messages).toContain('Нэгдсэн дүгнэлт бөглөгдөөгүй');
    expect(messages).toContain('Нэгдсэн зөвлөмж бөглөгдөөгүй');
  });

  it('lists the blockers on the report DTO so the UI can explain a disabled button', async () => {
    const workId = await completedWork();

    const detail = await request(app)
      .get(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${authorToken}`);

    expect(detail.body.data.report.submissionBlockers).toContain('Нэгдсэн дүгнэлт бөглөгдөөгүй.');
  });

  it('does not block submission on the material list', async () => {
    // Requirements 19.2 keeps materials at "нэр/тоо". With no ledger there is no actual to
    // reconcile a planned figure against, so a listed material is never a submission
    // blocker — it is a note about what the job needs.
    const workId = await completedWork();
    await fillReport(workId);

    await request(app)
      .put(`${API}/planned-work/${workId}/materials`)
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ materials: [{ name: 'Кабель 3x2.5', quantity: 50, unit: 'METRE' }] });

    const response = await submitReport(workId);
    expect(response.status).toBe(200);
  });

  it('submits successfully and records the submitter', async () => {
    const workId = await completedWork();
    await fillReport(workId);

    const response = await submitReport(workId);

    expect(response.status).toBe(200);
    expect(response.body.data.report.status).toBe('SUBMITTED');
    expect(response.body.data.report.submittedBy.name).not.toBeNull();
    expect(response.body.data.report.submittedBy.at).not.toBeNull();
    // Operational status is unchanged by the report workflow.
    expect(response.body.data.lifecycleStatus).toBe('COMPLETED');

    const events = await AuditLog.find({ action: 'REPORT_SUBMITTED' });
    expect(events).toHaveLength(1);
  });

  it('refuses to edit a submitted report', async () => {
    const workId = await submittedWork();

    const response = await request(app)
      .patch(`${API}/planned-work/${workId}/report`)
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ conclusion: 'Дараа нь өөрчилсөн' });

    expect(response.status).toBe(400);
  });

  it('refuses submission from a caller without planned_work.submit_report', async () => {
    const workId = await completedWork();
    await fillReport(workId);

    const response = await request(app)
      .post(`${API}/planned-work/${workId}/report/submit`)
      .set('Authorization', `Bearer ${approverToken}`);

    expect(response.status).toBe(403);
  });
});

describe('report approval authority', () => {
  it('refuses approval by the report author', async () => {
    const workId = await submittedWork();

    // Grant the author approval permission as well: the per-record rule must still bite.
    const selfApprover = await createUserWithPermissions('pwself@test.mn', [
      ...AUTHOR_PERMISSIONS,
      PERMISSIONS.PLANNED_WORK_APPROVE_REPORT,
    ]);
    const selfToken = await login(selfApprover.email, selfApprover.password);

    // Reassign authorship to this user so the author rule is the one under test.
    const report = await PlannedWorkReport.findOne({ plannedWork: workId });
    await PlannedWorkReport.updateOne(
      { _id: report?._id },
      { $set: { createdBy: selfApprover.userId, submittedBy: null } },
    );

    const response = await request(app)
      .post(`${API}/planned-work/${workId}/report/approve`)
      .set('Authorization', `Bearer ${selfToken}`);

    expect(response.status).toBe(403);
    expect(response.body.message).toContain('зохиогч өөрөө батлах боломжгүй');
  });

  it('refuses approval by the submitter', async () => {
    const workId = await submittedWork();

    const selfApprover = await createUserWithPermissions('pwsubmitter@test.mn', [
      ...AUTHOR_PERMISSIONS,
      PERMISSIONS.PLANNED_WORK_APPROVE_REPORT,
    ]);
    const selfToken = await login(selfApprover.email, selfApprover.password);

    const report = await PlannedWorkReport.findOne({ plannedWork: workId });
    await PlannedWorkReport.updateOne(
      { _id: report?._id },
      { $set: { createdBy: null, submittedBy: selfApprover.userId } },
    );

    const response = await request(app)
      .post(`${API}/planned-work/${workId}/report/approve`)
      .set('Authorization', `Bearer ${selfToken}`);

    expect(response.status).toBe(403);
    expect(response.body.message).toContain('илгээсэн хүн өөрөө батлах боломжгүй');
  });

  it('refuses approval without planned_work.approve_report', async () => {
    const workId = await submittedWork();

    const response = await request(app)
      .post(`${API}/planned-work/${workId}/report/approve`)
      .set('Authorization', `Bearer ${authorToken}`);

    expect(response.status).toBe(403);
  });

  it('reports canApprove false for the author and true for an independent approver', async () => {
    const workId = await submittedWork();

    const asAuthor = await request(app)
      .get(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${authorToken}`);
    expect(asAuthor.body.data.report.canApprove).toBe(false);
    expect(asAuthor.body.data.report.approvalBlockers.length).toBeGreaterThan(0);

    const asApprover = await request(app)
      .get(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${approverToken}`);
    expect(asApprover.body.data.report.canApprove).toBe(true);
    expect(asApprover.body.data.report.approvalBlockers).toEqual([]);
  });

  it('approves through an independent reviewer and archives the work', async () => {
    const workId = await submittedWork();

    const response = await request(app)
      .post(`${API}/planned-work/${workId}/report/approve`)
      .set('Authorization', `Bearer ${approverToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.report.status).toBe('APPROVED');
    expect(response.body.data.report.approvedBy.name).not.toBeNull();
    expect(response.body.data.report.visibleToCustomer).toBe(true);
    expect(response.body.data.lifecycleStatus).toBe('ARCHIVED');
    expect(response.body.data.archivedBy.at).not.toBeNull();

    const approved = await AuditLog.find({ action: 'REPORT_APPROVED' });
    const archived = await AuditLog.find({ action: 'PLANNED_WORK_ARCHIVED' });
    expect(approved).toHaveLength(1);
    expect(archived).toHaveLength(1);
  });

  it('never archives a work whose report is still unapproved', async () => {
    const workId = await submittedWork();

    const work = await PlannedWork.findById(workId);
    expect(work?.status).toBe('COMPLETED');
    expect(work?.archivedAt).toBeNull();
  });

  it('refuses approval of a report that is not submitted', async () => {
    const workId = await completedWork();
    await fillReport(workId);

    const response = await request(app)
      .post(`${API}/planned-work/${workId}/report/approve`)
      .set('Authorization', `Bearer ${approverToken}`);

    expect(response.status).toBe(403);
    expect(response.body.message).toContain('илгээгдээгүй');
  });

  it('lets a head_admin override the self-approval rule and flags the override', async () => {
    const workId = await completedWork();
    await fillReport(workId);

    const superUser = await createSuperUser('pwsuper@test.mn');
    const superToken = await login(superUser.email, superUser.password);

    const submitted = await request(app)
      .post(`${API}/planned-work/${workId}/report/submit`)
      .set('Authorization', `Bearer ${superToken}`);
    expect(submitted.status).toBe(200);

    const approved = await request(app)
      .post(`${API}/planned-work/${workId}/report/approve`)
      .set('Authorization', `Bearer ${superToken}`);

    expect(approved.status).toBe(200);
    const report = await PlannedWorkReport.findOne({ plannedWork: workId });
    expect(report?.approvalWasOverride).toBe(true);

    const events = await AuditLog.find({ action: 'REPORT_APPROVED' });
    expect(events[0]?.reason).toBe('head_admin emergency override');
  });
});

describe('report return', () => {
  it('requires a reason', async () => {
    const workId = await submittedWork();

    const response = await request(app)
      .post(`${API}/planned-work/${workId}/report/return`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({});

    expect(response.status).toBe(400);
  });

  it('returns the report, stores the reviewer, and leaves the work COMPLETED', async () => {
    const workId = await submittedWork();

    const response = await request(app)
      .post(`${API}/planned-work/${workId}/report/return`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ reason: 'Дүгнэлт хэт ерөнхий, дэлгэрүүлж бичнэ үү' });

    expect(response.status).toBe(200);
    expect(response.body.data.report.status).toBe('RETURNED');
    expect(response.body.data.report.returnReason).toBe(
      'Дүгнэлт хэт ерөнхий, дэлгэрүүлж бичнэ үү',
    );
    expect(response.body.data.report.returnedBy.name).not.toBeNull();
    expect(response.body.data.report.returnedBy.at).not.toBeNull();
    // A returned report must not reopen operational work.
    expect(response.body.data.lifecycleStatus).toBe('COMPLETED');

    const events = await AuditLog.find({ action: 'REPORT_RETURNED' });
    expect(events).toHaveLength(1);
    expect(events[0]?.reason).toBe('Дүгнэлт хэт ерөнхий, дэлгэрүүлж бичнэ үү');
  });

  it('allows a returned report to be corrected and resubmitted', async () => {
    const workId = await submittedWork();
    await request(app)
      .post(`${API}/planned-work/${workId}/report/return`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ reason: 'Дэлгэрүүлж бичнэ үү' });

    const edited = await request(app)
      .patch(`${API}/planned-work/${workId}/report`)
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ conclusion: 'Дэлгэрэнгүй дүгнэлт: бүх самбар шалгагдсан.' });
    expect(edited.status).toBe(200);

    const resubmitted = await submitReport(workId);
    expect(resubmitted.status).toBe(200);
    expect(resubmitted.body.data.report.status).toBe('SUBMITTED');
    // The previous return reason is cleared so the record reads as pending review.
    expect(resubmitted.body.data.report.returnReason).toBeNull();
  });

  it('refuses to return a report that is not submitted', async () => {
    const workId = await completedWork();

    const response = await request(app)
      .post(`${API}/planned-work/${workId}/report/return`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ reason: 'Хангалтгүй тайлан' });

    expect(response.status).toBe(400);
  });

  it('refuses to return without planned_work.approve_report', async () => {
    const workId = await submittedWork();

    const response = await request(app)
      .post(`${API}/planned-work/${workId}/report/return`)
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ reason: 'Өөрийн тайлангаа буцаах' });

    expect(response.status).toBe(403);
  });
});

/**
 * The canonical report in the central store.
 *
 * COMPLETE opens ONE Report in DRAFT — one item per sub-task related object — keyed on
 * (customer, PLANNED_WORK, work id) so a retried completion corrects it rather than
 * writing a second. Nothing reaches the equipment or the floor/building/project figures
 * until a reviewer approves; approval settles the row and applies it.
 */
describe('canonical report write-through', () => {
  let equipmentSequence = 0;

  /** Master-data equipment on the fixture floor (or floorless, for a foreign tenant). */
  async function seedEquipment(customerId: string = objects.customerId): Promise<string> {
    equipmentSequence += 1;
    const type =
      (await ObjectType.findOne({ code: 'PWEQ' })) ??
      (await ObjectType.create({ code: 'PWEQ', name: 'Самбар', category: 'EQUIPMENT' }));
    const record = await ObjectRecord.create({
      code: `PW-OBJ-${equipmentSequence}`,
      name: `Тоноглол ${equipmentSequence}`,
      category: 'EQUIPMENT',
      objectType: type._id,
      customer: customerId,
      floor: customerId === objects.customerId ? objects.floorId : null,
    });
    return String(record._id);
  }

  /** COMPLETE runs the write-through with the request's own actor; a replay needs one too. */
  function replayActor(): AuthContext {
    return {
      userId: author.userId,
      email: author.email,
      fullName: `Test ${author.email}`,
      role: 'admin',
      customerId: null,
      employeeId: null,
      roleIds: [],
      permissions: new Set<never>(),
    };
  }

  it('creates one DRAFT report with an item per sub-task object on COMPLETE', async () => {
    const objectA = await seedEquipment();
    const objectB = await seedEquipment();

    const workId = await createWork();
    const taskId = await addTask(workId, 10, { relatedObjectIds: [objectA, objectB] });
    // A second sub-task naming no equipment must contribute no item.
    const bareTaskId = await addTask(workId, 5, { title: 'Бичиг баримт цэгцлэх' });
    await transition(workId, 'PLAN');
    await transition(workId, 'START');
    await completeTask(workId, taskId, 10);
    await completeTask(workId, bareTaskId, 5);
    await transition(workId, 'COMPLETE');

    const work = await PlannedWork.findById(workId);
    const canonical = await Report.findOne({ sourceType: 'PLANNED_WORK', sourceId: workId });
    expect(canonical).not.toBeNull();
    expect(canonical?.type).toBe('PLANNED_WORK');
    expect(canonical?.status).toBe('DRAFT');
    expect(canonical?.sourceReference).toBe(work?.workNumber);
    expect(String(canonical?.customer)).toBe(objects.customerId);
    // The headline is the worst item's score — here every item carries the task's 88.
    expect(canonical?.overallScore).toBe(88);

    const items = await ReportItem.find({ report: canonical?._id });
    // Exactly two: the sub-task naming no equipment contributed nothing.
    expect(items).toHaveLength(2);
    expect(items.map((item) => String(item.object)).sort()).toEqual([objectA, objectB].sort());
    for (const item of items) {
      expect(item.score).toBe(88);
      // The sub-task's Тайлбар is the per-object observation and its Дүгнэлт the verdict;
      // one score and one write-up fanned to every object the sub-task covers.
      expect(item.observation).toBe('Самбар хэвийн ажиллаж байна.');
      expect(item.conclusion).toBe('Самбар цаашид ашиглахад тохиромжтой.');
      expect(item.recommendation).toBe('Дараагийн үзлэгийг хагас жилийн дараа хийх.');
      // Before + after photos travel as the item's evidence.
      expect(item.evidenceAttachments).toHaveLength(2);
    }

    // A DRAFT is a claim: the equipment and the hierarchy figures have not moved.
    expect((await ObjectRecord.findById(objectA))?.latestAssessment).toBeNull();
    expect((await ObjectNode.findById(objects.floorId))?.rollup ?? null).toBeNull();
  });

  it('corrects its one report on a retried completion instead of writing a second', async () => {
    const objectA = await seedEquipment();

    const workId = await createWork();
    const taskId = await addTask(workId, 10, { relatedObjectIds: [objectA] });
    await transition(workId, 'PLAN');
    await transition(workId, 'START');
    await completeTask(workId, taskId);
    await transition(workId, 'COMPLETE');

    const work = await PlannedWork.findById(workId);
    expect(work).not.toBeNull();

    // Replay the completion write-through twice, as a crashed-and-retried COMPLETE would.
    // The (customer, sourceType, sourceId) unique index is what folds these into one row.
    await writeCanonicalPlannedWorkReport(work!, 'DRAFT', replayActor());
    await writeCanonicalPlannedWorkReport(work!, 'DRAFT', replayActor());

    expect(
      await Report.countDocuments({ sourceType: 'PLANNED_WORK', sourceId: workId }),
    ).toBe(1);
    const canonical = await Report.findOne({ sourceType: 'PLANNED_WORK', sourceId: workId });
    expect(await ReportItem.countDocuments({ report: canonical?._id })).toBe(1);
  });

  it('applies scores to the equipment and the rollup chain only on approval', async () => {
    const objectA = await seedEquipment();

    const workId = await createWork();
    const taskId = await addTask(workId, 10, { relatedObjectIds: [objectA] });
    await transition(workId, 'PLAN');
    await transition(workId, 'START');
    await completeTask(workId, taskId);
    await transition(workId, 'COMPLETE');
    await fillReport(workId);
    const submitted = await submitReport(workId);
    expect(submitted.status).toBe(200);

    // Submission is still a claim: nothing has reached the equipment yet.
    expect((await ObjectRecord.findById(objectA))?.latestAssessment).toBeNull();

    const approved = await request(app)
      .post(`${API}/planned-work/${workId}/report/approve`)
      .set('Authorization', `Bearer ${approverToken}`);
    expect(approved.status).toBe(200);

    const canonical = await Report.findOne({ sourceType: 'PLANNED_WORK', sourceId: workId });
    expect(canonical?.status).toBe('APPROVED');
    expect(canonical?.approvedByName).not.toBeNull();
    expect(canonical?.approvedAt).not.toBeNull();
    // The consolidated write-up travels onto the canonical row at approval.
    expect(canonical?.conclusion).toBe('Ажил төлөвлөгөөний дагуу бүрэн хийгдсэн.');

    expect((await ObjectRecord.findById(objectA))?.latestAssessment?.score).toBe(88);

    // The worst-case figure walked the whole chain: floor, building and project.
    for (const nodeId of [objects.floorId, objects.buildingId, objects.projectId]) {
      expect((await ObjectNode.findById(nodeId))?.rollup?.score).toBe(88);
    }
  });

  /**
   * The equipment's HISTORY, not just its head.
   *
   * The device detail screen's Үнэлгээний түүх table reads `ObjectAssessment`. A conclusion
   * approved through Үзлэг ба дүгнэлт used to move `latestAssessment` and write no row at
   * all, so the evaluation moved the score and then vanished from the record.
   */
  it('writes exactly one history row for the object on approval', async () => {
    const objectA = await seedEquipment();

    const workId = await createWork();
    const taskId = await addTask(workId, 10, { relatedObjectIds: [objectA] });
    await transition(workId, 'PLAN');
    await transition(workId, 'START');
    await completeTask(workId, taskId);
    await transition(workId, 'COMPLETE');
    await fillReport(workId);
    await submitReport(workId);

    // The DRAFT canonical row exists by now and is still only a claim: no history yet.
    expect(await ObjectAssessment.countDocuments({ object: objectA })).toBe(0);

    const approved = await request(app)
      .post(`${API}/planned-work/${workId}/report/approve`)
      .set('Authorization', `Bearer ${approverToken}`);
    expect(approved.status).toBe(200);

    const rows = await ObjectAssessment.find({ object: objectA });
    expect(rows).toHaveLength(1);
    const row = rows[0]!;

    const canonical = await Report.findOne({ sourceType: 'PLANNED_WORK', sourceId: workId });
    const item = await ReportItem.findOne({ report: canonical?._id, object: objectA });

    expect(row.newScore).toBe(88);
    // The band is derived from the score, never carried from the caller.
    expect(row.riskLevel).toBe('NORMAL');
    // First finding about this equipment, so there is no previous figure to report.
    expect(row.previousScore).toBeNull();
    // WHO SIGNED IT OFF: the reviewer who approved, not a default.
    expect(row.assessedByName).toBe(canonical?.approvedByName);
    expect(String(row.assessedBy)).toBe(String(canonical?.approvedBy));
    /*
     * WHO JUDGED IT: the technician whose Дүгнэлт this row carries.
     *
     * The two are different people here — the author holds no approval permission — and
     * the row used to name only the approver, so the device history credited the verdict
     * to someone who never looked at the panel. `judgedBy` comes from the sub-task's
     * `conclusionBy`, one item at a time, and does not displace the sign-off above it.
     */
    const task = await PlannedWorkTask.findById(taskId);
    expect(task?.conclusionBy).not.toBeNull();
    expect(String(row.judgedBy)).toBe(String(task?.conclusionBy));
    expect(row.judgedByName).toBe(task?.conclusionByName);
    expect(String(row.judgedBy)).toBe(author.userId);
    expect(String(row.judgedBy)).not.toBe(String(row.assessedBy));
    // And it travelled through the report item, which is where the fan-out put it.
    expect(String(item?.judgedBy)).toBe(String(task?.conclusionBy));
    expect(item?.judgedByName).toBe(task?.conclusionByName);
    // WHEN: the report's own event time, the same instant the head carries.
    expect(row.assessedAt.toISOString()).toBe(canonical?.occurredAt.toISOString());
    // Traceable back to the finding it came from, which is also the idempotency key.
    expect(String(row.sourceReportItem)).toBe(String(item?._id));
    expect(String(row.sourceReport)).toBe(String(canonical?._id));
    expect(row.sourceLabel).toBe(canonical?.sourceReference);
    // The sub-task's write-up travelled with it.
    expect(row.conclusion).toBe('Самбар цаашид ашиглахад тохиромжтой.');
    expect(row.recommendation).toBe('Дараагийн үзлэгийг хагас жилийн дараа хийх.');
    expect(row.actionTaken).toBe('Самбар хэвийн ажиллаж байна.');

    // The head now points at a row that EXISTS. It used to be a fabricated ObjectId
    // referencing nothing.
    const object = await ObjectRecord.findById(objectA);
    expect(String(object?.latestAssessment?.assessment)).toBe(String(row._id));
  });

  /**
   * A scored sub-task with no Дүгнэлт has no author to stamp — `applyConclusion` clears
   * the triple when the text is blank — so the finding reaches equipment with a sign-off
   * and nothing else. The history row must say exactly that: the approver in `assessedBy`,
   * and NULL in `judgedBy` rather than the approver's name copied across, which would make
   * the field claim they wrote a verdict they only approved.
   */
  it('records the approver and leaves the judge null when the sub-task carries no verdict', async () => {
    const objectA = await seedEquipment();

    const workId = await createWork();
    const taskId = await addTask(workId, 10, { relatedObjectIds: [objectA] });
    await transition(workId, 'PLAN');
    await transition(workId, 'START');

    for (const kind of ['BEFORE', 'AFTER']) {
      await request(app)
        .post(`${API}/planned-work/${workId}/tasks/${taskId}/photos`)
        .set('Authorization', `Bearer ${authorToken}`)
        .field('kind', kind)
        .attach('file', Buffer.from('image-bytes'), {
          filename: `${kind.toLowerCase()}.png`,
          contentType: 'image/png',
        });
    }

    // Scored, noted, recommended — everything the completion gate asks for — and left
    // without a Дүгнэлт, which the gate does not ask for.
    const progress = await request(app)
      .post(`${API}/planned-work/${workId}/tasks/${taskId}/progress`)
      .set('Authorization', `Bearer ${authorToken}`)
      .send({
        completedQuantity: 10,
        note: 'Ажиглалт бичсэн.',
        score: 74,
        recommendation: 'Дараагийн үзлэгээр дахин харах.',
      });
    expect(progress.status).toBe(200);

    await transition(workId, 'COMPLETE');
    await fillReport(workId);
    await submitReport(workId);
    const approved = await request(app)
      .post(`${API}/planned-work/${workId}/report/approve`)
      .set('Authorization', `Bearer ${approverToken}`);
    expect(approved.status).toBe(200);

    const canonical = await Report.findOne({ sourceType: 'PLANNED_WORK', sourceId: workId });
    const item = await ReportItem.findOne({ report: canonical?._id, object: objectA });
    expect(item?.judgedBy).toBeNull();
    expect(item?.judgedByName).toBeNull();

    const row = await ObjectAssessment.findOne({ object: objectA });
    expect(row?.newScore).toBe(74);
    expect(String(row?.assessedBy)).toBe(String(canonical?.approvedBy));
    expect(row?.assessedByName).toBe(canonical?.approvedByName);
    expect(row?.judgedBy).toBeNull();
    expect(row?.judgedByName).toBeNull();
  });

  /**
   * Re-publishing is routine: `applyReportSafely` re-runs over the same upserted items
   * whenever the report is settled again. History must not grow a row per attempt.
   */
  it('does not duplicate the history row when the report is applied again', async () => {
    const objectA = await seedEquipment();

    const workId = await createWork();
    const taskId = await addTask(workId, 10, { relatedObjectIds: [objectA] });
    await transition(workId, 'PLAN');
    await transition(workId, 'START');
    await completeTask(workId, taskId);
    await transition(workId, 'COMPLETE');
    await fillReport(workId);
    await submitReport(workId);
    await request(app)
      .post(`${API}/planned-work/${workId}/report/approve`)
      .set('Authorization', `Bearer ${approverToken}`);

    expect(await ObjectAssessment.countDocuments({ object: objectA })).toBe(1);
    const first = await ObjectAssessment.findOne({ object: objectA });

    const canonical = await Report.findOne({ sourceType: 'PLANNED_WORK', sourceId: workId });

    // Re-run the whole publish twice over, as a repeated approval or a replayed apply does.
    const work = await PlannedWork.findById(workId);
    await writeCanonicalPlannedWorkReport(work!, 'APPROVED', replayActor());
    await applyReportToEquipment(canonical!._id);
    await applyReportToEquipment(canonical!._id);

    const rows = await ObjectAssessment.find({ object: objectA });
    expect(rows).toHaveLength(1);
    // The same row, not a rewritten one: the collection is append-only.
    expect(String(rows[0]?._id)).toBe(String(first?._id));
    // The author survives the replay untouched. `judgedBy` is not part of the idempotency
    // key — that stays `(sourceReportItem, newScore)` — so a republish carrying the same
    // verdict matches the existing row instead of appending a second one for the name.
    expect(String(rows[0]?.judgedBy)).toBe(author.userId);
    expect((await ObjectRecord.findById(objectA))?.latestAssessment?.score).toBe(88);
  });

  /**
   * RETRACTION: `syncItems` deletes the item for equipment the report no longer names.
   * The history row it produced is deliberately KEPT.
   *
   * `ObjectAssessment` blocks every update and delete hook at the model layer (rule 17.15
   * forbids deleting log or status history), so removing it is not merely questionable, it
   * is refused by the schema. The row also records something that genuinely happened: a
   * reviewer approved that figure and it moved the equipment's standing at the time.
   * Withdrawing the finding is a later event, not a reason to erase the earlier one — and
   * the row stays traceable through `sourceReport`/`sourceLabel`, so a reader can always
   * see which report it came from and that the report no longer carries it.
   */
  it('keeps the history row when the report stops naming the object', async () => {
    const objectA = await seedEquipment();
    const objectB = await seedEquipment();

    const workId = await createWork();
    const taskId = await addTask(workId, 10, { relatedObjectIds: [objectA, objectB] });
    await transition(workId, 'PLAN');
    await transition(workId, 'START');
    await completeTask(workId, taskId);
    await transition(workId, 'COMPLETE');
    await fillReport(workId);
    await submitReport(workId);
    await request(app)
      .post(`${API}/planned-work/${workId}/report/approve`)
      .set('Authorization', `Bearer ${approverToken}`);

    expect(await ObjectAssessment.countDocuments({ object: objectB })).toBe(1);
    const retained = await ObjectAssessment.findOne({ object: objectB });

    // The sub-task stops naming objectB, and the report is rewritten from it. Written to
    // the sub-task directly because the work is archived by approval and its editing
    // endpoints are closed by then — the retraction under test is `syncItems`, not the
    // route that reaches it.
    await PlannedWorkTask.updateOne(
      { _id: taskId },
      { $set: { relatedObjects: [new Types.ObjectId(objectA)] } },
    );

    const work = await PlannedWork.findById(workId);
    await writeCanonicalPlannedWorkReport(work!, 'APPROVED', replayActor());

    const canonical = await Report.findOne({ sourceType: 'PLANNED_WORK', sourceId: workId });
    // The finding is gone from the report, which is what retraction means there.
    expect(await ReportItem.countDocuments({ report: canonical?._id, object: objectB })).toBe(0);

    // The history row survives it, unchanged and still pointing at the report.
    const after = await ObjectAssessment.find({ object: objectB });
    expect(after).toHaveLength(1);
    expect(String(after[0]?._id)).toBe(String(retained?._id));
    expect(after[0]?.newScore).toBe(88);
    expect(String(after[0]?.sourceReport)).toBe(String(canonical?._id));
  });

  it('refuses a sub-task naming another customer’s equipment', async () => {
    const other = await Customer.create({ code: 'OT', name: 'Өөр ХХК' });
    const foreignObject = await seedEquipment(String(other._id));

    const workId = await createWork();
    const response = await request(app)
      .post(`${API}/planned-work/${workId}/tasks`)
      .set('Authorization', `Bearer ${authorToken}`)
      .send({
        floorId: objects.floorId,
        title: 'Гадны тоноглол дээр ажиллах',
        unit: 'PIECE',
        totalQuantity: 1,
        plannedStartDate: '2026-07-05T00:00:00.000Z',
        plannedEndDate: '2099-07-20T00:00:00.000Z',
        relatedObjectIds: [foreignObject],
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('өөр харилцагчид');
  });

  /**
   * The other half of the guard, and the one the web picker has to respect: the equipment
   * here belongs to the RIGHT customer, so tenancy passes and only the location rule can
   * refuse it. A picker offering the whole customer's equipment would produce exactly this.
   */
  it('refuses equipment that sits outside the sub-task’s floor', async () => {
    const type =
      (await ObjectType.findOne({ code: 'PWEQ' })) ??
      (await ObjectType.create({ code: 'PWEQ', name: 'Самбар', category: 'EQUIPMENT' }));
    const elsewhere = await ObjectRecord.create({
      code: 'PW-OBJ-ELSEWHERE',
      name: 'Өөр давхрын самбар',
      category: 'EQUIPMENT',
      objectType: type._id,
      customer: objects.customerId,
      floor: objects.foreignFloorId,
    });

    const workId = await createWork();
    const onFloor = await request(app)
      .post(`${API}/planned-work/${workId}/tasks`)
      .set('Authorization', `Bearer ${authorToken}`)
      .send({
        floorId: objects.floorId,
        title: 'Өөр давхрын тоноглол дээр ажиллах',
        unit: 'PIECE',
        totalQuantity: 1,
        plannedStartDate: '2026-07-05T00:00:00.000Z',
        plannedEndDate: '2099-07-20T00:00:00.000Z',
        relatedObjectIds: [String(elsewhere._id)],
      });

    expect(onFloor.status).toBe(400);
    expect(onFloor.body.message).toContain('байршилд хамаарахгүй');

    // Naming no floor widens the rule to the whole building — but this object is in a
    // different building, so it is still refused. Nothing lets it through.
    const floorless = await request(app)
      .post(`${API}/planned-work/${workId}/tasks`)
      .set('Authorization', `Bearer ${authorToken}`)
      .send({
        title: 'Давхаргүй дэд ажил',
        unit: 'PIECE',
        totalQuantity: 1,
        plannedStartDate: '2026-07-05T00:00:00.000Z',
        plannedEndDate: '2099-07-20T00:00:00.000Z',
        relatedObjectIds: [String(elsewhere._id)],
      });

    expect(floorless.status).toBe(400);
    expect(floorless.body.message).toContain('байршилд хамаарахгүй');
  });

  /**
   * The conclusion is a per-item field, so a sub-task covering several objects writes the
   * same verdict onto each. This is what fills the Дүгнэлт column of Үзлэг ба дүгнэлт for
   * a planned-work row, which stayed blank while a sub-task was barred from carrying one.
   */
  it('carries an edited sub-task Дүгнэлт onto every one of its objects', async () => {
    const objectA = await seedEquipment();
    const objectB = await seedEquipment();

    const workId = await createWork();
    const taskId = await addTask(workId, 10, { relatedObjectIds: [objectA, objectB] });
    await transition(workId, 'PLAN');
    await transition(workId, 'START');
    await completeTask(workId, taskId, 10);

    // Correcting the write-up after the fact must reach the items, not just the task.
    const corrected = await request(app)
      .post(`${API}/planned-work/${workId}/tasks/${taskId}/progress`)
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ completedQuantity: 10, conclusion: 'Дахин шалгалт шаардлагагүй.' });
    expect(corrected.status).toBe(200);
    expect(corrected.body.data.tasks[0].conclusion).toBe('Дахин шалгалт шаардлагагүй.');

    await transition(workId, 'COMPLETE');

    const canonical = await Report.findOne({ sourceType: 'PLANNED_WORK', sourceId: workId });
    const items = await ReportItem.find({ report: canonical?._id });
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item.conclusion).toBe('Дахин шалгалт шаардлагагүй.');
    }
  });
});

describe('archived work', () => {
  it('is read-only after approval', async () => {
    const workId = await submittedWork();
    await request(app)
      .post(`${API}/planned-work/${workId}/report/approve`)
      .set('Authorization', `Bearer ${approverToken}`);

    const edit = await request(app)
      .patch(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${authorToken}`)
      .send({ title: 'Архивласны дараа нэр солих' });

    expect(edit.status).toBe(400);
    expect(edit.body.message).toContain('Архивласан');
  });

  it('offers no further lifecycle action', async () => {
    const workId = await submittedWork();
    await request(app)
      .post(`${API}/planned-work/${workId}/report/approve`)
      .set('Authorization', `Bearer ${approverToken}`);

    const detail = await request(app)
      .get(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${authorToken}`);

    expect(detail.body.data.availableActions).toEqual([]);
  });
});

/**
 * The PDF export, exercised through the real route rather than through the renderer.
 *
 * The unit tests around `report-pdf` prove a document definition turns into bytes; this
 * proves the whole path — permission gate, the same `buildReportPreview` the screen uses,
 * the renderer, and the download headers — answers with a file a browser will save.
 */
describe('report PDF export', () => {
  it('serves the consolidated report as a downloadable PDF', async () => {
    const workId = await completedWork();
    await fillReport(workId);

    const response = await request(app)
      .get(`${API}/planned-work/${workId}/report/pdf`)
      .set('Authorization', `Bearer ${authorToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    // An attachment, so the browser saves rather than renders it in a tab.
    expect(response.headers['content-disposition']).toMatch(/^attachment; filename=".*\.pdf"$/);
    // Actual PDF bytes, not a JSON envelope with a 200 on it.
    const body = response.body as Buffer;
    expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(body.byteLength).toBeGreaterThan(5_000);
  });

  it('serves the inspection report as a downloadable PDF', async () => {
    const workId = await completedWork();

    const generated = await request(app)
      .post(`${API}/planned-work/${workId}/inspection-report`)
      .set('Authorization', `Bearer ${authorToken}`);
    expect([200, 201]).toContain(generated.status);

    const response = await request(app)
      .get(`${API}/planned-work/${workId}/inspection-report/pdf`)
      .set('Authorization', `Bearer ${authorToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/pdf');
    expect((response.body as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  /** A read key, because the file is a copy of a page the caller may already read. */
  it('refuses a caller without planned_work.view', async () => {
    const workId = await completedWork();
    const outsider = await createUserWithPermissions('pdf-outsider@test.mn', []);
    const token = await login(outsider.email, outsider.password);

    const response = await request(app)
      .get(`${API}/planned-work/${workId}/report/pdf`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
  });
});
