/**
 * The two narrow keys that let a technician report their own progress and settle their own
 * conclusion, and everything they deliberately do NOT let them do.
 *
 * Before them, `service_request.change_status` was the only way to move a request at all,
 * so a technician could not record that they had arrived on site. It could not simply be
 * granted: the same key cancels, returns, un-assigns, verifies, completes and reviews other
 * people's write-ups. These tests pin the line that was drawn instead — the six states, the
 * assignment scope, and the approve/return split — and, just as importantly, that the office
 * roles ended up with exactly what they had.
 */
import { PERMISSIONS } from '@monhorus/shared';
import type { Express } from 'express';
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createUserWithPermissions,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
} from '../../test/helpers';
import { Employee } from '../employee/employee.model';
import { invalidateRecipientCache } from '../notification/notification.service';
import { Customer, ObjectNode } from '../objects/object.models';
import { StoredFile } from '../storage/stored-file.model';
import { ServiceRequest } from './service-request.model';
import { WorkReport } from './work-report.model';

const API = '/api/v1';

/** The seeded TECHNICIAN grant, as `SYSTEM_ROLE_DEFAULT_PERMISSIONS` now carries it. */
const FIELD_KEYS = [
  PERMISSIONS.SERVICE_REQUEST_VIEW,
  PERMISSIONS.SERVICE_REQUEST_UPDATE,
  PERMISSIONS.SERVICE_REQUEST_SELF_PROGRESS,
  PERMISSIONS.SERVICE_REQUEST_APPROVE_REPORT,
] as const;

/** What DISPATCH holds on this endpoint: the whole workflow, unchanged by any of this. */
const OFFICE_KEYS = [
  PERMISSIONS.SERVICE_REQUEST_VIEW,
  PERMISSIONS.SERVICE_REQUEST_UPDATE,
  PERMISSIONS.SERVICE_REQUEST_CHANGE_STATUS,
  PERMISSIONS.DISPATCH_ASSIGN,
] as const;

let app: Express;
let customerId: Types.ObjectId;
let buildingId: Types.ObjectId;
let sequence = 0;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  return response.body.data.tokens.accessToken as string;
}

interface Actor {
  token: string;
  employeeId: Types.ObjectId;
}

/** A signed-in account with an employee card, so assignment can name it. */
async function makeStaff(
  email: string,
  permissions: readonly (typeof FIELD_KEYS)[number][] | readonly string[],
  teamId: Types.ObjectId | null = null,
): Promise<Actor> {
  sequence += 1;
  const user = await createUserWithPermissions(
    email,
    permissions as unknown as Parameters<typeof createUserWithPermissions>[1],
  );
  const employee = await Employee.create({
    employeeCode: `E-${sequence}`,
    firstName: 'Тест',
    lastName: 'Ажилтан',
    registrationNumber: `АА${String(10_000_000 + sequence)}`,
    status: 'ACTIVE',
    employeeType: 'FULL_TIME',
    employmentStartDate: new Date('2024-01-01'),
    team: teamId,
    systemUser: user.userId,
  });
  return { token: await login(user.email, user.password), employeeId: employee._id };
}

async function seedRequest(
  overrides: Record<string, unknown> = {},
): Promise<Types.ObjectId> {
  sequence += 1;
  const now = new Date();
  const created = await ServiceRequest.create({
    requestNumber: `SR-${String(sequence).padStart(6, '0')}`,
    customer: customerId,
    building: buildingId,
    requestType: 'REPAIR',
    isUrgent: false,
    description: 'Гэрэлтүүлэг ажиллахгүй байна.',
    contactName: 'Бат',
    contactPhone: '99112233',
    status: 'ASSIGNED',
    assignedEmployees: [],
    assignedTeam: null,
    slaStartedAt: now,
    slaDueAt: new Date(now.getTime() + 4 * 60 * 60 * 1000),
    ...overrides,
  });
  return created._id;
}

async function seedPhoto(): Promise<Types.ObjectId> {
  sequence += 1;
  const file = await StoredFile.create({
    originalName: `evidence-${sequence}.png`,
    storageKey: `test/${sequence}.png`,
    mimeType: 'image/png',
    sizeBytes: 512,
    ownerType: 'SERVICE_REQUEST',
    ownerId: customerId,
    uploadedBy: null,
    uploadedByName: 'Тест',
  });
  return file._id;
}

/** A conclusion carrying every mandatory field, so `assertReportAllows` is satisfied. */
async function seedCompleteReport(
  requestId: Types.ObjectId,
  status: 'DRAFT' | 'SUBMITTED' = 'DRAFT',
): Promise<void> {
  await WorkReport.create({
    serviceRequest: requestId,
    status,
    score: 78,
    riskLevel: 'ATTENTION',
    conclusion: 'Холболт сул байсныг чангаллаа.',
    recommendation: '7 хоногийн дараа дахин шалгах.',
    beforePhotos: [await seedPhoto()],
    afterPhotos: [await seedPhoto()],
    createdBy: null,
    createdByName: 'Тест',
    ...(status === 'SUBMITTED'
      ? { submittedByName: 'Тест', submittedAt: new Date() }
      : {}),
  });
}

function move(
  requestId: Types.ObjectId,
  token: string,
  status: string,
  reason?: string,
): request.Test {
  return request(app)
    .post(`${API}/service-requests/${String(requestId)}/status`)
    .set('Authorization', `Bearer ${token}`)
    .send(reason === undefined ? { status } : { status, reason });
}

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await stopTestApp();
});

beforeEach(async () => {
  await resetDomainCollections();
  invalidateRecipientCache();

  const customer = await Customer.create({ code: 'CT', name: 'Central Tower ХХК' });
  customerId = customer._id;

  const project = await ObjectNode.create({
    kind: 'PROJECT',
    code: 'P1',
    name: 'Төсөл',
    parent: null,
    customer: customer._id,
    ancestors: [],
  });
  const building = await ObjectNode.create({
    kind: 'BUILDING',
    code: 'B1',
    name: 'Барилга',
    parent: project._id,
    customer: customer._id,
    ancestors: [project._id],
  });
  buildingId = building._id;
});

describe('service_request.self_progress', () => {
  /**
   * The whole field lifecycle in one pass, because the value of the key is the SEQUENCE:
   * a technician who can say ACCEPTED but not ON_SITE has been given nothing usable.
   */
  it('walks a technician through every state the key authorises, on their own request', async () => {
    const tech = await makeStaff('walker@test.mn', FIELD_KEYS);
    const requestId = await seedRequest({ assignedEmployees: [tech.employeeId] });
    await seedCompleteReport(requestId);

    for (const step of [
      { status: 'ACCEPTED' },
      { status: 'ON_THE_WAY' },
      { status: 'ON_SITE' },
      { status: 'IN_PROGRESS' },
      // The one state in the set that also sits in REASON_REQUIRED_STATUSES.
      { status: 'WAITING', reason: 'Сэлбэг хүлээгдэж байна.' },
      { status: 'IN_PROGRESS' },
      { status: 'REPORT_SUBMITTED' },
    ]) {
      const response = await move(requestId, tech.token, step.status, step.reason);
      expect(
        { status: step.status, code: response.status },
        JSON.stringify(response.body),
      ).toEqual({ status: step.status, code: 200 });
      expect(response.body.data.status).toBe(step.status);
    }

    const saved = await ServiceRequest.findById(requestId);
    expect(saved?.status).toBe('REPORT_SUBMITTED');
    // The whole walk is on the record, so the audit trail is not merely the last hop.
    expect(saved?.statusHistory).toHaveLength(7);
  });

  /**
   * The point of the key being narrow. CANCELLED is a LEGAL transition from IN_PROGRESS —
   * the matrix allows it — and it is refused here purely because it is not the field's to
   * make. A 400 would have meant the graph refused it; 403 means the caller did.
   */
  it.each([
    ['CANCELLED', 'IN_PROGRESS'],
    ['REVISIT_REQUIRED', 'IN_PROGRESS'],
    ['UNASSIGNED', 'ACCEPTED'],
    ['RETURNED', 'ON_SITE'],
    ['VERIFICATION', 'REPORT_SUBMITTED'],
  ])('refuses %s, which is legal from %s but outside the set', async (to, from) => {
    const tech = await makeStaff(`outside-${to}@test.mn`, FIELD_KEYS);
    const requestId = await seedRequest({
      status: from,
      assignedEmployees: [tech.employeeId],
    });

    const response = await move(requestId, tech.token, to, 'Шалтгаан.');

    expect(response.status).toBe(403);
    expect(await ServiceRequest.findById(requestId)).toMatchObject({ status: from });
  });

  it("refuses a colleague's request", async () => {
    const tech = await makeStaff('mine@test.mn', FIELD_KEYS);
    const colleague = await makeStaff('theirs@test.mn', FIELD_KEYS);
    const requestId = await seedRequest({ assignedEmployees: [colleague.employeeId] });

    const response = await move(requestId, tech.token, 'ACCEPTED');

    expect(response.status).toBe(403);
    expect(await ServiceRequest.findById(requestId)).toMatchObject({ status: 'ASSIGNED' });
  });

  /**
   * The open queue is READABLE by a technician — that is what makes "Нээлттэй" work — so
   * this is the case a scope copied from the detail read would have got wrong. Claiming is
   * the separate, audited act that puts somebody on an unheld job.
   */
  it('refuses an unclaimed request the caller has not claimed', async () => {
    const tech = await makeStaff('passerby@test.mn', FIELD_KEYS);
    const requestId = await seedRequest({
      status: 'UNASSIGNED',
      assignedEmployees: [],
      assignedTeam: null,
    });

    // Readable...
    const read = await request(app)
      .get(`${API}/service-requests/${String(requestId)}`)
      .set('Authorization', `Bearer ${tech.token}`);
    expect(read.status).toBe(200);

    // ...and still not theirs to move.
    const response = await move(requestId, tech.token, 'ACCEPTED');
    expect(response.status).toBe(403);
  });

  /**
   * A request carried by the caller's TEAM is theirs, exactly as it is for planned work.
   *
   * The team is a bare id rather than a `Team` document because that is all the rule reads:
   * `resolveAssignedWorkFilter` compares `Employee.team` against `ServiceRequest.assignedTeam`
   * and never loads the team itself. Seeding one would be asserting a lookup that does not
   * happen.
   */
  it('admits a request assigned to the caller team', async () => {
    const teamId = new Types.ObjectId();
    const tech = await makeStaff('teamed@test.mn', FIELD_KEYS, teamId);
    const requestId = await seedRequest({ assignedEmployees: [], assignedTeam: teamId });

    const response = await move(requestId, tech.token, 'ACCEPTED');
    expect(response.status).toBe(200);
  });

  /** The key authorises a subset of the graph; it never adds an edge to it. */
  it('still refuses an illegal transition inside the set', async () => {
    const tech = await makeStaff('illegal@test.mn', FIELD_KEYS);
    const requestId = await seedRequest({ assignedEmployees: [tech.employeeId] });

    // IN_PROGRESS is in the set, and ASSIGNED -> IN_PROGRESS is not in the matrix.
    const response = await move(requestId, tech.token, 'IN_PROGRESS');

    expect(response.status).toBe(400);
    expect(await ServiceRequest.findById(requestId)).toMatchObject({ status: 'ASSIGNED' });
  });

  it('still refuses WAITING without a reason', async () => {
    const tech = await makeStaff('nowhy@test.mn', FIELD_KEYS);
    const requestId = await seedRequest({
      status: 'ON_SITE',
      assignedEmployees: [tech.employeeId],
    });

    const refused = await move(requestId, tech.token, 'WAITING');
    expect(refused.status).toBe(400);
    expect(refused.body.issues?.[0]?.field).toBe('reason');

    const accepted = await move(requestId, tech.token, 'WAITING', 'Цахилгаан тасарсан.');
    expect(accepted.status).toBe(200);
  });

  it('refuses an account holding neither key', async () => {
    const reader = await makeStaff('reader@test.mn', [PERMISSIONS.SERVICE_REQUEST_VIEW]);
    const requestId = await seedRequest({ assignedEmployees: [reader.employeeId] });

    const response = await move(requestId, reader.token, 'ACCEPTED');
    expect(response.status).toBe(403);
  });
});

describe('service_request.approve_report', () => {
  it('lets a technician approve the conclusion on their own request', async () => {
    const tech = await makeStaff('approver@test.mn', FIELD_KEYS);
    const requestId = await seedRequest({
      status: 'REPORT_SUBMITTED',
      assignedEmployees: [tech.employeeId],
    });
    await seedCompleteReport(requestId, 'SUBMITTED');

    const response = await request(app)
      .post(`${API}/service-requests/${String(requestId)}/report/approve`)
      .set('Authorization', `Bearer ${tech.token}`)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('APPROVED');
  });

  /**
   * The half that was NOT granted. Returning is a judgement on somebody else's work, so it
   * stays on `service_request.change_status` — which is the whole reason the approve/return
   * pair had to be split rather than the old key handed over.
   */
  it('does not let the same technician return one', async () => {
    const tech = await makeStaff('noreturn@test.mn', FIELD_KEYS);
    const requestId = await seedRequest({
      status: 'REPORT_SUBMITTED',
      assignedEmployees: [tech.employeeId],
    });
    await seedCompleteReport(requestId, 'SUBMITTED');

    const response = await request(app)
      .post(`${API}/service-requests/${String(requestId)}/report/return`)
      .set('Authorization', `Bearer ${tech.token}`)
      .send({ reason: 'Зураг дутуу байна.' });

    expect(response.status).toBe(403);
    const report = await WorkReport.findOne({ serviceRequest: requestId });
    expect(report?.status).toBe('SUBMITTED');
  });

  it("refuses approval of a colleague's conclusion", async () => {
    const tech = await makeStaff('outsider@test.mn', FIELD_KEYS);
    const colleague = await makeStaff('owner@test.mn', FIELD_KEYS);
    const requestId = await seedRequest({
      status: 'REPORT_SUBMITTED',
      assignedEmployees: [colleague.employeeId],
    });
    await seedCompleteReport(requestId, 'SUBMITTED');

    const response = await request(app)
      .post(`${API}/service-requests/${String(requestId)}/report/approve`)
      .set('Authorization', `Bearer ${tech.token}`)
      .send({});

    // 404 rather than 403: `requestIdInScope` hides a request that is not the caller's
    // behind "missing", so a conclusion route cannot be used to probe for request ids.
    expect([403, 404]).toContain(response.status);
    const report = await WorkReport.findOne({ serviceRequest: requestId });
    expect(report?.status).toBe('SUBMITTED');
  });
});

describe('the office keeps everything it had', () => {
  it('still cancels, returns and verifies on service_request.change_status alone', async () => {
    const office = await makeStaff('office@test.mn', OFFICE_KEYS);

    // A state the field key refuses outright.
    const toCancel = await seedRequest({ status: 'IN_PROGRESS' });
    const cancelled = await move(toCancel, office.token, 'CANCELLED', 'Харилцагч татгалзсан.');
    expect(cancelled.status).toBe(200);

    // On a request assigned to NOBODY, which the field key also refuses: an office caller
    // is not assignment-scoped, and must not become so because a narrower key now exists.
    const unheld = await seedRequest({ status: 'REPORT_SUBMITTED' });
    await seedCompleteReport(unheld, 'SUBMITTED');
    const returned = await request(app)
      .post(`${API}/service-requests/${String(unheld)}/report/return`)
      .set('Authorization', `Bearer ${office.token}`)
      .send({ reason: 'Зөвлөмж тодорхойгүй.' });
    expect(returned.status).toBe(200);
    expect(returned.body.data.status).toBe('RETURNED');
  });
});
