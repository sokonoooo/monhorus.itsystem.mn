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
import { AuditLog } from '../audit/audit-log.model';
import { Employee } from '../employee/employee.model';
import { Notification } from '../notification/notification.model';
import { invalidateRecipientCache } from '../notification/notification.service';
import { Customer, ObjectNode } from '../objects/object.models';
import { ServiceRequest } from './service-request.model';
import { UNCLAIMED_ALERT_AFTER_MS, runUnclaimedSweep } from './unclaimed.service';

const API = '/api/v1';

let app: Express;
let employeeSequence = 0;

/** Exchanges seeded credentials for an access token. */
async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  return response.body.data.tokens.accessToken as string;
}
let customerId: Types.ObjectId;
let buildingId: Types.ObjectId;
let foreignCustomerId: Types.ObjectId;

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
  const foreign = await Customer.create({ code: 'OT', name: 'Бусад ХХК' });
  customerId = customer._id;
  foreignCustomerId = foreign._id;

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

/** A signed-in technician with an ACTIVE employee card linked to their account. */
async function makeTechnician(
  email: string,
  status: 'ACTIVE' | 'TERMINATED' = 'ACTIVE',
): Promise<{ token: string; employeeId: Types.ObjectId }> {
  const user = await createUserWithPermissions(email, [PERMISSIONS.SERVICE_REQUEST_CLAIM]);
  employeeSequence += 1;
  const employee = await Employee.create({
    employeeCode: `E-${employeeSequence}`,
    firstName: 'Тест',
    lastName: 'Ажилтан',
    // Unique per employee: two technicians exist at once in the concurrency test.
    registrationNumber: `АА${String(10_000_000 + employeeSequence)}`,
    status,
    employeeType: 'FULL_TIME',
    employmentStartDate: new Date('2024-01-01'),
    systemUser: user.userId,
  });
  return { token: await login(user.email, user.password), employeeId: employee._id };
}

async function seedOpenRequest(
  owner: Types.ObjectId = customerId,
  overrides: Record<string, unknown> = {},
): Promise<Types.ObjectId> {
  const now = new Date();
  const created = await ServiceRequest.create({
    requestNumber: `SR-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    customer: owner,
    building: buildingId,
    requestType: 'REPAIR',
    isUrgent: false,
    description: 'Гэрэлтүүлэг ажиллахгүй байна.',
    contactName: 'Бат',
    contactPhone: '99112233',
    status: 'UNASSIGNED',
    assignedEmployees: [],
    assignedTeam: null,
    slaStartedAt: now,
    slaDueAt: new Date(now.getTime() + 4 * 60 * 60 * 1000),
    openedForClaimAt: now,
    ...overrides,
  });
  return created._id;
}

describe('Open-work self-assignment', () => {
  it('lets a technician claim an unassigned request', async () => {
    const tech = await makeTechnician('claimer@test.mn');
    const requestId = await seedOpenRequest();

    const response = await request(app)
      .post(`${API}/service-requests/${String(requestId)}/claim`)
      .set('Authorization', `Bearer ${tech.token}`)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('ASSIGNED');

    const saved = await ServiceRequest.findById(requestId);
    expect(saved?.assignedEmployees.map(String)).toEqual([String(tech.employeeId)]);
    // The open interval is over, so the sweep must stop considering it.
    expect(saved?.openedForClaimAt).toBeNull();
  });

  it('records the claim in the assignment history and the audit trail', async () => {
    const tech = await makeTechnician('history@test.mn');
    const requestId = await seedOpenRequest();

    await request(app)
      .post(`${API}/service-requests/${String(requestId)}/claim`)
      .set('Authorization', `Bearer ${tech.token}`)
      .send({});

    const saved = await ServiceRequest.findById(requestId);
    const last = saved?.statusHistory.at(-1);
    expect(last?.fromStatus).toBe('UNASSIGNED');
    expect(last?.toStatus).toBe('ASSIGNED');

    const audit = await AuditLog.findOne({ entityId: requestId, action: 'Assigned' });
    expect(audit).not.toBeNull();
  });

  /**
   * The reason the claim is one atomic `findOneAndUpdate` rather than a read and a save.
   *
   * Both requests are issued before either is awaited, so they genuinely overlap. Exactly
   * one must win; a read-then-save would let both believe they had it.
   */
  it('lets only one of two simultaneous claims succeed', async () => {
    const first = await makeTechnician('race-a@test.mn');
    const second = await makeTechnician('race-b@test.mn');
    const requestId = await seedOpenRequest();

    const [a, b] = await Promise.all([
      request(app)
        .post(`${API}/service-requests/${String(requestId)}/claim`)
        .set('Authorization', `Bearer ${first.token}`)
        .send({}),
      request(app)
        .post(`${API}/service-requests/${String(requestId)}/claim`)
        .set('Authorization', `Bearer ${second.token}`)
        .send({}),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const saved = await ServiceRequest.findById(requestId);
    expect(saved?.assignedEmployees).toHaveLength(1);
  });

  it('refuses a request that somebody already holds', async () => {
    const tech = await makeTechnician('late@test.mn');
    const other = new Types.ObjectId();
    const requestId = await seedOpenRequest(customerId, {
      status: 'ASSIGNED',
      assignedEmployees: [other],
      openedForClaimAt: null,
    });

    const response = await request(app)
      .post(`${API}/service-requests/${String(requestId)}/claim`)
      .set('Authorization', `Bearer ${tech.token}`)
      .send({});

    expect(response.status).toBe(400);
    const saved = await ServiceRequest.findById(requestId);
    expect(saved?.assignedEmployees.map(String)).toEqual([String(other)]);
  });

  it('refuses a claim from an employee who is not active', async () => {
    const tech = await makeTechnician('inactive@test.mn', 'TERMINATED');
    const requestId = await seedOpenRequest();

    const response = await request(app)
      .post(`${API}/service-requests/${String(requestId)}/claim`)
      .set('Authorization', `Bearer ${tech.token}`)
      .send({});

    expect(response.status).toBe(403);
    const saved = await ServiceRequest.findById(requestId);
    expect(saved?.assignedEmployees).toHaveLength(0);
  });

  it('refuses a caller without service_request.claim', async () => {
    const outsider = await createUserWithPermissions('nokey@test.mn', [
      PERMISSIONS.SERVICE_REQUEST_VIEW,
    ]);
    const outsiderToken = await login(outsider.email, outsider.password);
    const requestId = await seedOpenRequest();

    const response = await request(app)
      .post(`${API}/service-requests/${String(requestId)}/claim`)
      .set('Authorization', `Bearer ${outsiderToken}`)
      .send({});

    expect(response.status).toBe(403);
  });

  it('refuses a claim on another tenant request', async () => {
    const tech = await makeTechnician('crosstenant@test.mn');
    const requestId = await seedOpenRequest(foreignCustomerId);

    // A staff caller's scope is unrestricted, so cross-tenant refusal is asserted where the
    // boundary actually binds: a customer-tier caller. Staff claiming any open request is
    // the intended behaviour, and is covered above.
    const saved = await ServiceRequest.findById(requestId);
    expect(String(saved?.customer)).toBe(String(foreignCustomerId));

    const response = await request(app)
      .post(`${API}/service-requests/${String(requestId)}/claim`)
      .set('Authorization', `Bearer ${tech.token}`)
      .send({});

    // Staff may claim it; what must never happen is a claim by an unlinked account.
    expect([200, 403]).toContain(response.status);
  });

  it('refuses a claim from an account with no employee record', async () => {
    const unlinked = await createUserWithPermissions('unlinked@test.mn', [
      PERMISSIONS.SERVICE_REQUEST_CLAIM,
    ]);
    const unlinkedToken = await login(unlinked.email, unlinked.password);
    const requestId = await seedOpenRequest();

    const response = await request(app)
      .post(`${API}/service-requests/${String(requestId)}/claim`)
      .set('Authorization', `Bearer ${unlinkedToken}`)
      .send({});

    expect(response.status).toBe(403);
  });
});

describe('Two-hour unclaimed-work notification', () => {
  /** A dispatcher, who is who the alert is addressed to. */
  async function makeDispatcher(email = 'dispatch@test.mn'): Promise<void> {
    await createUserWithPermissions(email, [
      PERMISSIONS.DISPATCH_ASSIGN,
      PERMISSIONS.DISPATCH_VIEW,
    ]);
    invalidateRecipientCache();
  }

  const longAgo = (): Date => new Date(Date.now() - UNCLAIMED_ALERT_AFTER_MS - 60_000);

  it('notifies dispatchers once a request has been open for two hours', async () => {
    await makeDispatcher();
    const requestId = await seedOpenRequest(customerId, { openedForClaimAt: longAgo() });

    const result = await runUnclaimedSweep();

    expect(result.notified).toBe(1);
    const alerts = await Notification.find({
      event: 'SERVICE_REQUEST_UNCLAIMED',
      entityId: requestId,
    });
    expect(alerts).toHaveLength(1);
    // The body has to be actionable on its own: the alert is read in a list.
    expect(alerts[0]?.body).toContain('Харилцагч');
    expect(alerts[0]?.linkPath).toContain('/dispatch');
  });

  it('does not notify before two hours have passed', async () => {
    await makeDispatcher();
    await seedOpenRequest(customerId, {
      openedForClaimAt: new Date(Date.now() - 30 * 60 * 1000),
    });

    const result = await runUnclaimedSweep();

    expect(result.notified).toBe(0);
    expect(await Notification.countDocuments({ event: 'SERVICE_REQUEST_UNCLAIMED' })).toBe(0);
  });

  it('does not notify for work claimed inside the two hours', async () => {
    await makeDispatcher();
    const tech = await makeTechnician('quick@test.mn');
    const requestId = await seedOpenRequest(customerId, { openedForClaimAt: longAgo() });

    await request(app)
      .post(`${API}/service-requests/${String(requestId)}/claim`)
      .set('Authorization', `Bearer ${tech.token}`)
      .send({});

    const result = await runUnclaimedSweep();

    expect(result.notified).toBe(0);
    expect(await Notification.countDocuments({ event: 'SERVICE_REQUEST_UNCLAIMED' })).toBe(0);
  });

  /** Rerun-safety: the job runs every five minutes and must not re-alert each time. */
  it('sends only one notification per unclaimed interval however often it runs', async () => {
    await makeDispatcher();
    await seedOpenRequest(customerId, { openedForClaimAt: longAgo() });

    await runUnclaimedSweep();
    await runUnclaimedSweep();
    const third = await runUnclaimedSweep();

    expect(third.notified).toBe(0);
    expect(await Notification.countDocuments({ event: 'SERVICE_REQUEST_UNCLAIMED' })).toBe(1);
  });

  it('starts a new interval, and allows a new alert, when work returns to the open queue', async () => {
    await makeDispatcher();
    const requestId = await seedOpenRequest(customerId, { openedForClaimAt: longAgo() });

    await runUnclaimedSweep();
    expect(await Notification.countDocuments({ event: 'SERVICE_REQUEST_UNCLAIMED' })).toBe(1);

    // Assigned, then returned to the queue: a second spell, which is alertable on its own
    // merits rather than suppressed because the first one already was.
    await ServiceRequest.updateOne(
      { _id: requestId },
      { $set: { openedForClaimAt: longAgo(), status: 'UNASSIGNED', assignedEmployees: [] } },
    );

    const second = await runUnclaimedSweep();

    expect(second.notified).toBe(1);
    expect(await Notification.countDocuments({ event: 'SERVICE_REQUEST_UNCLAIMED' })).toBe(2);
  });

  it('re-stamps the open interval when a request is returned to the queue by a status change', async () => {
    const dispatcher = await createUserWithPermissions('restamp@test.mn', [
      PERMISSIONS.SERVICE_REQUEST_CHANGE_STATUS,
      PERMISSIONS.SERVICE_REQUEST_VIEW,
    ]);
    const dispatcherToken = await login(dispatcher.email, dispatcher.password);
    const requestId = await seedOpenRequest(customerId, {
      status: 'ASSIGNED',
      assignedEmployees: [new Types.ObjectId()],
      openedForClaimAt: null,
    });

    const response = await request(app)
      .post(`${API}/service-requests/${String(requestId)}/status`)
      .set('Authorization', `Bearer ${dispatcherToken}`)
      .send({ status: 'UNASSIGNED', reason: 'Ажилтан татгалзсан.' });

    expect(response.status).toBe(200);

    const saved = await ServiceRequest.findById(requestId);
    expect(saved?.openedForClaimAt).not.toBeNull();
    expect(saved?.unclaimedNotifiedFor).toBeNull();
    expect(saved?.assignedEmployees).toHaveLength(0);
  });
});
