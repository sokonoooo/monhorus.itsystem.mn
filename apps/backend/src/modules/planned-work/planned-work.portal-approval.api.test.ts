import { PERMISSIONS, type PermissionKey } from '@monhorus/shared';
import type { Express } from 'express';
import { Types } from 'mongoose';
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
  type TestUser,
} from '../../test/helpers';
import { Employee } from '../employee/employee.model';
import { Customer, ObjectNode } from '../objects/object.models';
import { User } from '../user/user.model';
import { PlannedWork } from './planned-work.models';

/**
 * THE CUSTOMER-RAISED PLANNED WORK FLOW.
 *
 * The property every case here circles is one sentence:
 *
 *   A CUSTOMER MAY ASK FOR WORK, AND NOBODY IS ON IT UNTIL AN AUTHORISED APPROVER SAYS SO.
 *
 * `assignedEmployees` is the field every scope check and every technician-facing query
 * reads, so the assertions are mostly about that field being empty when it should be and
 * populated exactly when approval says — not about the status label, which is the visible
 * symptom rather than the mechanism.
 */

const API = '/api/v1';

/** Raises work and follows it. Holds no staff planned-work key at all. */
const PORTAL_PERMISSIONS: readonly PermissionKey[] = [
  PERMISSIONS.PORTAL_PLANNED_WORK_VIEW,
  PERMISSIONS.PORTAL_PLANNED_WORK_CREATE,
];

/** The authorised admin. Approves and assigns; does not raise customer work. */
const APPROVER_PERMISSIONS: readonly PermissionKey[] = [
  PERMISSIONS.PLANNED_WORK_VIEW,
  PERMISSIONS.PLANNED_WORK_UPDATE,
  PERMISSIONS.PLANNED_WORK_APPROVE,
];

/** A planner with no approval authority, to prove the key is what decides. */
const PLANNER_PERMISSIONS: readonly PermissionKey[] = [
  PERMISSIONS.PLANNED_WORK_VIEW,
  PERMISSIONS.PLANNED_WORK_CREATE,
  PERMISSIONS.PLANNED_WORK_UPDATE,
  PERMISSIONS.PLANNED_WORK_CHANGE_STATUS,
];

let app: Express;
let org: OrgFixture;
let objects: ObjectFixture;

let portalToken: string;
let approverToken: string;
let plannerToken: string;
let employeeId: string;
let foreignBuildingId: string;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  return response.body.data.tokens.accessToken as string;
}

async function createCustomerUser(email: string, customerId: string): Promise<TestUser> {
  const user = await createUserWithPermissions(email, PORTAL_PERMISSIONS);
  await User.updateOne(
    { _id: new Types.ObjectId(user.userId) },
    { $set: { role: 'customer', customer: new Types.ObjectId(customerId) } },
  );
  return user;
}

function workBody(buildingId: string, overrides: Record<string, unknown> = {}) {
  return {
    buildingId,
    title: 'Улирлын урьдчилан сэргийлэх үзлэг',
    plannedStartDate: '2026-09-01T00:00:00.000Z',
    plannedEndDate: '2099-09-03T00:00:00.000Z',
    assignedEmployeeIds: [],
    ...overrides,
  };
}

/** Raises one as the customer and returns its id. */
async function raiseAsCustomer(overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await request(app)
    .post(`${API}/planned-work`)
    .set('Authorization', `Bearer ${portalToken}`)
    .send(workBody(objects.buildingId, overrides));
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

function transition(workId: string, body: Record<string, unknown>, bearer: string) {
  return request(app)
    .post(`${API}/planned-work/${workId}/transition`)
    .set('Authorization', `Bearer ${bearer}`)
    .send(body);
}

/** Submits a draft for approval — the creator's own action, staff or customer. */
function submit(workId: string, bearer: string) {
  return transition(workId, { action: 'PLAN' }, bearer);
}

/** Approves and staffs in one call, which is the only way to reach PLANNED. */
function approve(workId: string, bearer: string, employeeIds: string[] = [employeeId]) {
  return transition(workId, { action: 'APPROVE', assignedEmployeeIds: employeeIds }, bearer);
}

/** A customer request all the way to PLANNED, the way the workflow intends. */
async function raiseSubmitAndApprove(): Promise<string> {
  const workId = await raiseAsCustomer();
  expect((await submit(workId, portalToken)).status).toBe(200);
  expect((await approve(workId, approverToken)).status).toBe(200);
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

  const portal = await createCustomerUser('pwportal@test.mn', objects.customerId);
  portalToken = await login(portal.email, portal.password);

  const approver = await createUserWithPermissions('pwapprover@test.mn', APPROVER_PERMISSIONS);
  approverToken = await login(approver.email, approver.password);

  const planner = await createUserWithPermissions('pwplanner@test.mn', PLANNER_PERMISSIONS);
  plannerToken = await login(planner.email, planner.password);

  const employee = await Employee.create({
    employeeCode: 'E-PORTAL-1',
    firstName: 'Дорж',
    lastName: 'Бат',
    company: org.companyId,
    department: org.departmentId,
    position: org.positionId,
    employeeType: 'FULL_TIME',
    employmentStartDate: new Date('2024-01-01'),
    status: 'ACTIVE',
  });
  employeeId = String(employee._id);

  const foreign = await Customer.create({ code: 'OT', name: 'Бусад ХХК' });
  const foreignBuilding = await ObjectNode.create({
    customer: foreign._id,
    kind: 'BUILDING',
    code: 'B-OT',
    name: 'Өөр барилга',
    parent: null,
    ancestors: [],
  });
  foreignBuildingId = String(foreignBuilding._id);
});

describe('a customer raising planned work', () => {
  it('creates a real planned work in DRAFT with nobody on it', async () => {
    const workId = await raiseAsCustomer();

    const work = await PlannedWork.findById(workId);
    // DRAFT, not submitted: the customer composes it first and submits when ready.
    expect(work?.status).toBe('DRAFT');
    expect(work?.assignedEmployees).toHaveLength(0);
    expect(work?.assignedTeam).toBeNull();
    // A real PlannedWork record, with its own work number — not a service request.
    expect(work?.workNumber).toMatch(/^PW-/);
    expect(String(work?.customer)).toBe(objects.customerId);
  });

  /**
   * The crew is forced empty server-side, so naming one in the payload changes nothing.
   * That is what makes "cannot be assigned before approval" a property of the data.
   */
  it('ignores a crew the customer tries to name', async () => {
    const workId = await raiseAsCustomer({ assignedEmployeeIds: [employeeId] });

    expect((await PlannedWork.findById(workId))?.assignedEmployees).toHaveLength(0);
  });

  it('refuses to raise work on another organisation building', async () => {
    const response = await request(app)
      .post(`${API}/planned-work`)
      .set('Authorization', `Bearer ${portalToken}`)
      .send(workBody(foreignBuildingId));

    expect(response.status).toBe(400);
    expect(await PlannedWork.countDocuments({ building: foreignBuildingId })).toBe(0);
  });

  it('lists and reads its own work, and 404s another organisation', async () => {
    const workId = await raiseAsCustomer();

    const list = await request(app)
      .get(`${API}/planned-work`)
      .set('Authorization', `Bearer ${portalToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data.items.map((item: { id: string }) => item.id)).toEqual([workId]);

    // Raised by staff for another tenant, so it exists but is not theirs.
    const foreign = await PlannedWork.create({
      workNumber: 'PW-FOREIGN-1',
      building: foreignBuildingId,
      customer: (await Customer.findOne({ code: 'OT' }))!._id,
      title: 'Өөр ажил',
      plannedStartDate: new Date('2026-09-01'),
      plannedEndDate: new Date('2099-09-03'),
      originalPlannedEndDate: new Date('2099-09-03'),
      status: 'PLANNED',
    });

    const detail = await request(app)
      .get(`${API}/planned-work/${String(foreign._id)}`)
      .set('Authorization', `Bearer ${portalToken}`);
    expect(detail.status).toBe(404);
  });

  /**
   * Submitting is the customer's own act, and the only lifecycle action they hold. Approving
   * their own request, or starting the work, remain somebody else's decision entirely.
   */
  it('submits its own request but drives no further', async () => {
    const workId = await raiseAsCustomer();

    expect((await submit(workId, portalToken)).status).toBe(200);
    expect((await PlannedWork.findById(workId))?.status).toBe('PENDING_APPROVAL');

    for (const action of ['APPROVE', 'START', 'REJECT']) {
      const response = await transition(workId, { action, reason: 'Болохгүй.' }, portalToken);
      expect(response.status).toBe(403);
    }
    expect((await PlannedWork.findById(workId))?.status).toBe('PENDING_APPROVAL');
  });

  /** The portal key admits the action; it does not admit somebody else's record. */
  it("cannot submit another organisation's draft", async () => {
    const foreign = await request(app)
      .post(`${API}/planned-work`)
      .set('Authorization', `Bearer ${plannerToken}`)
      .send(workBody(foreignBuildingId));
    expect(foreign.status).toBe(201);

    const response = await submit(foreign.body.data.id as string, portalToken);

    expect(response.status).toBe(404);
  });
});

describe('approval is what makes it assignable', () => {
  it('refuses assignment while the work is pending', async () => {
    const workId = await raiseAsCustomer();
    expect((await submit(workId, portalToken)).status).toBe(200);

    const response = await request(app)
      .patch(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ assignedEmployeeIds: [employeeId] });

    expect(response.status).toBe(400);
    expect((await PlannedWork.findById(workId))?.assignedEmployees).toHaveLength(0);
  });

  /**
   * The same rule one level down. A sub-task carries its own assignee, and that path only
   * ever checked `assertMutable` — which permits PENDING_APPROVAL — so the sub-tasks of an
   * unapproved customer request could be staffed even though the work-level crew could not.
   */
  it('refuses naming an employee on a sub-task while the work is pending', async () => {
    const workId = await raiseAsCustomer();

    const response = await request(app)
      .post(`${API}/planned-work/${workId}/tasks`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({
        title: 'Шатны үзлэг',
        totalQuantity: 4,
        plannedStartDate: '2026-09-01T00:00:00.000Z',
        plannedEndDate: '2026-09-02T00:00:00.000Z',
        assignedEmployeeId: employeeId,
      });

    expect(response.status).toBe(400);
  });

  /** Scoping the job before approving it is fine — only the promise to a person is refused. */
  it('allows an unassigned sub-task while the work is pending', async () => {
    const workId = await raiseAsCustomer();

    const response = await request(app)
      .post(`${API}/planned-work/${workId}/tasks`)
      .set('Authorization', `Bearer ${approverToken}`)
      .send({
        title: 'Шатны үзлэг',
        totalQuantity: 4,
        plannedStartDate: '2026-09-01T00:00:00.000Z',
        plannedEndDate: '2026-09-02T00:00:00.000Z',
      });

    expect(response.status).toBe(201);
  });

  /** Approval and staffing are one event: the work reaches PLANNED already crewed. */
  it('approves to PLANNED and assigns the chosen crew in the same act', async () => {
    const workId = await raiseSubmitAndApprove();

    const work = await PlannedWork.findById(workId);
    expect(work?.status).toBe('PLANNED');
    expect(work?.assignedEmployees.map(String)).toEqual([employeeId]);
  });

  /**
   * There is no approving-without-staffing. Allowing it would reintroduce the state this
   * whole workflow exists to remove: work agreed to, and sitting in nobody's list.
   */
  it('refuses to approve without naming anyone', async () => {
    const workId = await raiseAsCustomer();
    expect((await submit(workId, portalToken)).status).toBe(200);

    const response = await transition(workId, { action: 'APPROVE' }, approverToken);

    expect(response.status).toBe(400);
    expect((await PlannedWork.findById(workId))?.status).toBe('PENDING_APPROVAL');
  });

  it('refuses to approve with an employee that does not exist', async () => {
    const workId = await raiseAsCustomer();
    expect((await submit(workId, portalToken)).status).toBe(200);

    const response = await approve(workId, approverToken, [new Types.ObjectId().toString()]);

    expect(response.status).toBe(400);
    expect((await PlannedWork.findById(workId))?.status).toBe('PENDING_APPROVAL');
  });

  /** The approve key is what decides, not merely holding some planned-work permission. */
  it('refuses approval to a planner without the approve key', async () => {
    const workId = await raiseAsCustomer();
    expect((await submit(workId, portalToken)).status).toBe(200);

    const response = await approve(workId, plannerToken);

    expect(response.status).toBe(403);
    expect((await PlannedWork.findById(workId))?.status).toBe('PENDING_APPROVAL');
  });

  it('returns a rejected request to its creator with a readable reason', async () => {
    const workId = await raiseAsCustomer();
    expect((await submit(workId, portalToken)).status).toBe(200);

    const rejected = await transition(
      workId,
      { action: 'REJECT', reason: 'Тухайн хугацаанд боломжгүй.' },
      approverToken,
    );
    expect(rejected.status).toBe(200);

    const work = await PlannedWork.findById(workId);
    // Handed back, not ended — the customer can still act on it.
    expect(work?.status).toBe('REJECTED');
    expect(work?.cancelReason).toBe('Тухайн хугацаанд боломжгүй.');
    expect(work?.assignedEmployees).toHaveLength(0);

    // And the customer sees it on their own read.
    const detail = await request(app)
      .get(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${portalToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.cancelReason).toBe('Тухайн хугацаанд боломжгүй.');
  });

  it('requires a reason to reject', async () => {
    const workId = await raiseAsCustomer();
    expect((await submit(workId, portalToken)).status).toBe(200);

    const response = await transition(workId, { action: 'REJECT' }, approverToken);

    expect(response.status).toBe(400);
    expect((await PlannedWork.findById(workId))?.status).toBe('PENDING_APPROVAL');
  });

  /**
   * The round trip, which is the point of returning rather than cancelling: the customer
   * reads why, fixes it, and sends the SAME record back. A cancelled work would have forced
   * them to start again and lost the thread between the objection and the correction.
   */
  it('lets the creator correct a rejected request and submit it again', async () => {
    const workId = await raiseAsCustomer();
    expect((await submit(workId, portalToken)).status).toBe(200);
    expect(
      (await transition(workId, { action: 'REJECT', reason: 'Огноо тохирохгүй.' }, approverToken))
        .status,
    ).toBe(200);

    // Editable again, because a returned work is the creator's to correct.
    const edited = await request(app)
      .patch(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${portalToken}`)
      .send({ title: 'Улирлын үзлэг (засварласан)' });
    expect(edited.status).toBe(200);

    const resubmitted = await submit(workId, portalToken);
    expect(resubmitted.status).toBe(200);

    const work = await PlannedWork.findById(workId);
    expect(work?.status).toBe('PENDING_APPROVAL');
    expect(work?.title).toBe('Улирлын үзлэг (засварласан)');
    // The stale refusal is cleared: it is waiting to be looked at, not refused.
    expect(work?.cancelReason).toBeNull();
  });

  /** An approved request is settled, so its requester can no longer rewrite it. */
  it('refuses a customer edit once the request is approved', async () => {
    const workId = await raiseSubmitAndApprove();

    const response = await request(app)
      .patch(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${portalToken}`)
      .send({ title: 'Дараа нь өөрчилсөн' });

    expect(response.status).toBe(400);
  });

  /**
   * The end of the flow: once approved and assigned, the work reaches the employee through
   * the EXISTING assignment-scope filter.
   */
  it('shows the approved work to the employee it was assigned to', async () => {
    const workId = await raiseSubmitAndApprove();

    const technician = await createUserWithPermissions('pwtech@test.mn', [
      PERMISSIONS.PLANNED_WORK_VIEW,
      PERMISSIONS.PLANNED_WORK_CHANGE_STATUS,
    ]);
    await Employee.updateOne(
      { _id: new Types.ObjectId(employeeId) },
      { $set: { systemUser: new Types.ObjectId(technician.userId) } },
    );
    const technicianToken = await login(technician.email, technician.password);

    const list = await request(app)
      .get(`${API}/planned-work`)
      .set('Authorization', `Bearer ${technicianToken}`);

    expect(list.status).toBe(200);
    expect(list.body.data.items.map((item: { id: string }) => item.id)).toContain(workId);
  });

  /**
   * Before approval no employee sees it, at any pre-approval status.
   *
   * Asserted with a crew FORCED ON to the record behind the API's back. Nothing legitimate
   * can produce that — the crew rules refuse it — and that is the point: if the exclusion
   * ever regressed to relying on "pre-approval work happens to have no crew", this would
   * catch it, where a test on a naturally crewless draft would pass either way.
   */
  it.each(['DRAFT', 'PENDING_APPROVAL', 'REJECTED'] as const)(
    'keeps %s work out of every employee work list even if it carries a crew',
    async (status) => {
      const workId = await raiseAsCustomer();
      await PlannedWork.updateOne(
        { _id: new Types.ObjectId(workId) },
        { $set: { status, assignedEmployees: [new Types.ObjectId(employeeId)] } },
      );

      const technician = await createUserWithPermissions(`pwtech-${status}@test.mn`, [
        PERMISSIONS.PLANNED_WORK_VIEW,
        PERMISSIONS.PLANNED_WORK_CHANGE_STATUS,
      ]);
      await Employee.updateOne(
        { _id: new Types.ObjectId(employeeId) },
        { $set: { systemUser: new Types.ObjectId(technician.userId) } },
      );
      const technicianToken = await login(technician.email, technician.password);

      const list = await request(app)
        .get(`${API}/planned-work`)
        .set('Authorization', `Bearer ${technicianToken}`);

      expect(list.status).toBe(200);
      expect(list.body.data.items).toHaveLength(0);
    },
  );

  it('keeps a pending work out of every employee work list', async () => {
    await raiseAsCustomer();

    const technician = await createUserWithPermissions('pwtech2@test.mn', [
      PERMISSIONS.PLANNED_WORK_VIEW,
      PERMISSIONS.PLANNED_WORK_CHANGE_STATUS,
    ]);
    await Employee.updateOne(
      { _id: new Types.ObjectId(employeeId) },
      { $set: { systemUser: new Types.ObjectId(technician.userId) } },
    );
    const technicianToken = await login(technician.email, technician.password);

    const list = await request(app)
      .get(`${API}/planned-work`)
      .set('Authorization', `Bearer ${technicianToken}`);

    expect(list.body.data.items).toHaveLength(0);
  });
});

describe('the staff path is unchanged', () => {
  it('still creates staff work in DRAFT with the crew the planner named', async () => {
    const created = await request(app)
      .post(`${API}/planned-work`)
      .set('Authorization', `Bearer ${plannerToken}`)
      .send(workBody(objects.buildingId, { assignedEmployeeIds: [employeeId] }));

    expect(created.status).toBe(201);
    const work = await PlannedWork.findById(created.body.data.id as string);
    expect(work?.status).toBe('DRAFT');
    expect(work?.assignedEmployees.map(String)).toEqual([employeeId]);
  });

  /**
   * THIS TEST USED TO ASSERT THE OPPOSITE — that PLAN took a staff draft straight to
   * PLANNED. It no longer does, and that is the change: staff and customers follow one
   * workflow, so a planner's own work is reviewed on the same terms as a customer's. The
   * test is kept, inverted, rather than deleted, because "staff can still skip approval"
   * silently returning is exactly the regression worth catching.
   */
  it('sends a staff draft to approval rather than straight to PLANNED', async () => {
    const created = await request(app)
      .post(`${API}/planned-work`)
      .set('Authorization', `Bearer ${plannerToken}`)
      .send(workBody(objects.buildingId));
    const workId = created.body.data.id as string;

    const planned = await transition(workId, { action: 'PLAN' }, plannerToken);

    expect(planned.status).toBe(200);
    expect((await PlannedWork.findById(workId))?.status).toBe('PENDING_APPROVAL');

    // And the planner, holding no approve key, cannot carry it the rest of the way.
    const selfApproved = await approve(workId, plannerToken);
    expect(selfApproved.status).toBe(403);
  });
});

describe('the customer breaks down their own request', () => {
  function taskBody(overrides: Record<string, unknown> = {}) {
    return {
      title: 'Шатны гэрэлтүүлэг шалгах',
      totalQuantity: 6,
      plannedStartDate: '2026-09-01T00:00:00.000Z',
      plannedEndDate: '2026-09-02T00:00:00.000Z',
      ...overrides,
    };
  }

  function addTask(workId: string, token: string, overrides: Record<string, unknown> = {}) {
    return request(app)
      .post(`${API}/planned-work/${workId}/tasks`)
      .set('Authorization', `Bearer ${token}`)
      .send(taskBody(overrides));
  }

  it('lets a customer add sub-tasks while their request is pending', async () => {
    const workId = await raiseAsCustomer();

    const response = await addTask(workId, portalToken);

    expect(response.status).toBe(201);
    expect(response.body.data.tasks).toHaveLength(1);
    expect(response.body.data.tasks[0].title).toBe('Шатны гэрэлтүүлэг шалгах');
  });

  /**
   * Approval settles the scope. Letting the requester keep adding work afterwards would
   * make the approver's agreement meaningless — they approved something smaller.
   */
  it('refuses further sub-tasks once the request is approved', async () => {
    const workId = await raiseAsCustomer();
    expect((await submit(workId, portalToken)).status).toBe(200);
    expect((await approve(workId, approverToken)).status).toBe(200);

    const response = await addTask(workId, portalToken);

    expect(response.status).toBe(400);
    expect((await PlannedWork.findById(workId))?.status).toBe('PLANNED');
  });

  /** Not-found rather than forbidden, so this cannot confirm another tenant's ids exist. */
  it("cannot touch another organisation's work", async () => {
    const foreign = await request(app)
      .post(`${API}/planned-work`)
      .set('Authorization', `Bearer ${plannerToken}`)
      .send(workBody(foreignBuildingId));
    expect(foreign.status).toBe(201);

    const response = await addTask(foreign.body.data.id as string, portalToken);

    expect(response.status).toBe(404);
  });

  it('cannot name an employee on its own sub-task', async () => {
    const workId = await raiseAsCustomer();

    const response = await addTask(workId, portalToken, { assignedEmployeeId: employeeId });

    expect(response.status).toBe(400);
  });

  /** A customer may correct their own breakdown right up until somebody approves it. */
  it('lets a customer delete a sub-task while pending, but not after approval', async () => {
    const workId = await raiseAsCustomer();
    const created = await addTask(workId, portalToken);
    const taskId = created.body.data.tasks[0].id as string;

    const second = await addTask(workId, portalToken, { title: 'Хоёр дахь' });
    expect(second.status).toBe(201);

    const removed = await request(app)
      .delete(`${API}/planned-work/${workId}/tasks/${taskId}`)
      .set('Authorization', `Bearer ${portalToken}`);
    expect(removed.status).toBe(200);

    expect((await submit(workId, portalToken)).status).toBe(200);
    expect((await approve(workId, approverToken)).status).toBe(200);

    const lateDelete = await request(app)
      .delete(`${API}/planned-work/${workId}/tasks/${second.body.data.tasks.at(-1).id}`)
      .set('Authorization', `Bearer ${portalToken}`);
    expect(lateDelete.status).toBe(400);
  });

  /** Staff planning is untouched: they still shape work at any status assertMutable allows. */
  it('leaves staff free to add sub-tasks to their own draft', async () => {
    const draft = await request(app)
      .post(`${API}/planned-work`)
      .set('Authorization', `Bearer ${plannerToken}`)
      .send(workBody(objects.buildingId));
    expect(draft.status).toBe(201);
    expect((await PlannedWork.findById(draft.body.data.id as string))?.status).toBe('DRAFT');

    const response = await addTask(draft.body.data.id as string, approverToken);

    expect(response.status).toBe(201);
  });
});

describe('what the portal is offered on its own request', () => {
  /**
   * THE BUG THIS EXISTS FOR. `availableActionsFor` drops every action when assignment scope
   * says no, and assignment scope asks which EMPLOYEE a job belongs to — so it answered
   * NOT_ASSIGNED for every customer and left them looking at their own draft with no way to
   * submit it. The write path had already been excused from that check; the read path that
   * decides which buttons to draw had not.
   */
  it('offers the customer Төлөвлөх on its own draft', async () => {
    const workId = await raiseAsCustomer();

    const detail = await request(app)
      .get(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${portalToken}`);

    expect(detail.status).toBe(200);
    const actions = (detail.body.data.availableActions as { action: string }[]).map(
      (entry) => entry.action,
    );
    expect(actions).toContain('PLAN');
  });

  /** ...and nothing an approver alone may do. */
  it('offers the customer no approval actions', async () => {
    const workId = await raiseAsCustomer();
    expect((await submit(workId, portalToken)).status).toBe(200);

    const detail = await request(app)
      .get(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${portalToken}`);

    const actions = (detail.body.data.availableActions as { action: string }[]).map(
      (entry) => entry.action,
    );
    expect(actions).not.toContain('APPROVE');
    expect(actions).not.toContain('REJECT');
  });

  /** A returned request is submittable again, which is the whole point of returning it. */
  it('offers Төлөвлөх again once the request has been returned', async () => {
    const workId = await raiseAsCustomer();
    expect((await submit(workId, portalToken)).status).toBe(200);
    expect(
      (await transition(workId, { action: 'REJECT', reason: 'Огноо тохирохгүй.' }, approverToken))
        .status,
    ).toBe(200);

    const detail = await request(app)
      .get(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${portalToken}`);

    const actions = (detail.body.data.availableActions as { action: string }[]).map(
      (entry) => entry.action,
    );
    expect(actions).toContain('PLAN');
  });

  /** The approver's side of the same read: they get the decision, marked as needing a crew. */
  it('offers the approver APPROVE, flagged as assigning a crew', async () => {
    const workId = await raiseAsCustomer();
    expect((await submit(workId, portalToken)).status).toBe(200);

    const detail = await request(app)
      .get(`${API}/planned-work/${workId}`)
      .set('Authorization', `Bearer ${approverToken}`);

    const approveAction = (
      detail.body.data.availableActions as { action: string; assignsCrew: boolean }[]
    ).find((entry) => entry.action === 'APPROVE');
    expect(approveAction).toBeDefined();
    expect(approveAction?.assignsCrew).toBe(true);
  });
});
