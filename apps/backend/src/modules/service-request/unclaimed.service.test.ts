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
import { Notification } from '../notification/notification.model';
import { invalidateRecipientCache } from '../notification/notification.service';
import { Customer, ObjectNode } from '../objects/object.models';
import { ServiceRequest } from './service-request.model';
import {
  UNCLAIMED_ALERT_AFTER_MS,
  UNCLAIMED_ALERT_MAX_SENDS,
  markOpenForClaim,
  runUnclaimedSweep,
} from './unclaimed.service';

/**
 * The repeating unclaimed-work chase.
 *
 * Every assertion here reads the `Notification` collection rather than the sweep's return
 * value, and reads it PER RECIPIENT: the whole change is about who is chased and how often,
 * and a count of "reminders sent" would pass just as happily if they all went to the wrong
 * inbox. `runUnclaimedSweep` takes its clock as an argument, so the schedule is driven by
 * moving `now` forward rather than by waiting or by faking timers.
 */

const API = '/api/v1';

let app: Express;
let customerId: Types.ObjectId;
let buildingId: Types.ObjectId;
let employeeSequence = 0;

/** The instant the request enters the open queue; every threshold is measured from it. */
const OPENED_AT = new Date('2026-08-19T08:00:00.000Z');
const minutes = (count: number): Date => new Date(OPENED_AT.getTime() + count * 60_000);
const GAP_MINUTES = UNCLAIMED_ALERT_AFTER_MS / 60_000;

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

/** Exchanges seeded credentials for an access token. */
async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  return response.body.data.tokens.accessToken as string;
}

/**
 * Somebody who can actually take the job: the holder of `service_request.claim`.
 *
 * This is the permission the chase now addresses, so this account is the one whose inbox
 * proves the reminder reached a person who can act on it.
 */
async function makeClaimer(email = 'tech@test.mn'): Promise<Types.ObjectId> {
  const user = await createUserWithPermissions(email, [PERMISSIONS.SERVICE_REQUEST_CLAIM]);
  invalidateRecipientCache();
  return new Types.ObjectId(user.userId);
}

/** A claimer with an ACTIVE employee card, so the claim endpoint will accept them. */
async function makeTechnician(
  email = 'claimer@test.mn',
): Promise<{ token: string; userId: Types.ObjectId }> {
  const user = await createUserWithPermissions(email, [PERMISSIONS.SERVICE_REQUEST_CLAIM]);
  employeeSequence += 1;
  await Employee.create({
    employeeCode: `E-${employeeSequence}`,
    firstName: 'Тест',
    lastName: 'Ажилтан',
    registrationNumber: `АА${String(10_000_000 + employeeSequence)}`,
    status: 'ACTIVE',
    employeeType: 'FULL_TIME',
    employmentStartDate: new Date('2024-01-01'),
    systemUser: user.userId,
  });
  invalidateRecipientCache();
  return { token: await login(user.email, user.password), userId: new Types.ObjectId(user.userId) };
}

/** A dispatcher, who under the new rule hears only the final, escalated reminder. */
async function makeDispatcher(email = 'dispatch@test.mn'): Promise<Types.ObjectId> {
  const user = await createUserWithPermissions(email, [
    PERMISSIONS.DISPATCH_ASSIGN,
    PERMISSIONS.DISPATCH_VIEW,
  ]);
  invalidateRecipientCache();
  return new Types.ObjectId(user.userId);
}

async function seedOpenRequest(
  overrides: Record<string, unknown> = {},
): Promise<Types.ObjectId> {
  const created = await ServiceRequest.create({
    requestNumber: `SR-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    customer: customerId,
    building: buildingId,
    requestType: 'REPAIR',
    isUrgent: false,
    description: 'Гэрэлтүүлэг ажиллахгүй байна.',
    contactName: 'Бат',
    contactPhone: '99112233',
    status: 'UNASSIGNED',
    assignedEmployees: [],
    assignedTeam: null,
    slaStartedAt: OPENED_AT,
    slaDueAt: new Date(OPENED_AT.getTime() + 4 * 60 * 60 * 1000),
    openedForClaimAt: OPENED_AT,
    ...overrides,
  });
  return created._id;
}

const alertsFor = async (recipient: Types.ObjectId): Promise<number> =>
  Notification.countDocuments({ event: 'SERVICE_REQUEST_UNCLAIMED', recipient });

describe('Unclaimed-work chase', () => {
  it('says nothing before the first threshold', async () => {
    const claimer = await makeClaimer();
    await seedOpenRequest();

    const result = await runUnclaimedSweep(minutes(GAP_MINUTES - 1));

    expect(result.notified).toBe(0);
    expect(await alertsFor(claimer)).toBe(0);
  });

  it('reminds the people who can claim it once the threshold is reached', async () => {
    const claimer = await makeClaimer();
    const dispatcher = await makeDispatcher();
    const requestId = await seedOpenRequest();

    const result = await runUnclaimedSweep(minutes(GAP_MINUTES));

    expect(result.notified).toBe(1);
    const alerts = await Notification.find({
      event: 'SERVICE_REQUEST_UNCLAIMED',
      entityId: requestId,
    });
    expect(alerts).toHaveLength(1);
    expect(String(alerts[0]?.recipient)).toBe(String(claimer));
    // The body has to be actionable on its own: the alert is read in a list.
    expect(alerts[0]?.body).toContain('Харилцагч');
    // The link goes where the "Өөртөө авах" action is, not to the dispatch board.
    expect(alerts[0]?.linkPath).toContain('/service-requests/');
    expect(alerts[0]?.title).toContain(`1/${UNCLAIMED_ALERT_MAX_SENDS}`);
    // A dispatcher is not chased; they hear only the final escalation.
    expect(await alertsFor(dispatcher)).toBe(0);
  });

  it('repeats once per interval and never exceeds the cap', async () => {
    const claimer = await makeClaimer();
    await seedOpenRequest();

    for (let sent = 1; sent <= UNCLAIMED_ALERT_MAX_SENDS; sent += 1) {
      // The tick that arrives before the next one is due must add nothing.
      const early = await runUnclaimedSweep(minutes(sent * GAP_MINUTES - 1));
      expect(early.notified).toBe(0);
      expect(await alertsFor(claimer)).toBe(sent - 1);

      const due = await runUnclaimedSweep(minutes(sent * GAP_MINUTES));
      expect(due.notified).toBe(1);
      expect(await alertsFor(claimer)).toBe(sent);
    }

    // Silence from here on, however long it stays open and however often the job runs:
    // an unassignable call must not buzz all night.
    for (const at of [GAP_MINUTES * 4, GAP_MINUTES * 8, 24 * 60]) {
      const later = await runUnclaimedSweep(minutes(at));
      expect(later.notified).toBe(0);
    }
    expect(await alertsFor(claimer)).toBe(UNCLAIMED_ALERT_MAX_SENDS);
  });

  it('escalates the final reminder to dispatchers, and only the final one', async () => {
    const claimer = await makeClaimer();
    const dispatcher = await makeDispatcher();
    const requestId = await seedOpenRequest();

    for (let sent = 1; sent <= UNCLAIMED_ALERT_MAX_SENDS; sent += 1) {
      await runUnclaimedSweep(minutes(sent * GAP_MINUTES));
    }

    expect(await alertsFor(claimer)).toBe(UNCLAIMED_ALERT_MAX_SENDS);
    const escalations = await Notification.find({
      event: 'SERVICE_REQUEST_UNCLAIMED',
      recipient: dispatcher,
    });
    expect(escalations).toHaveLength(1);
    expect(escalations[0]?.linkPath).toBe(`/dispatch?requestId=${String(requestId)}`);
    expect(escalations[0]?.title).toContain('хуваарилалт шаардлагатай');
  });

  /**
   * Rerun-safety, which is the reason the send is staked with a conditional update rather
   * than decided from a read. Both passes are issued before either is awaited, so they
   * genuinely overlap, and both read a count of zero.
   */
  it('sends one reminder when two sweeps run at the same instant', async () => {
    const claimer = await makeClaimer();
    await seedOpenRequest();

    const at = minutes(GAP_MINUTES);
    const [first, second] = await Promise.all([runUnclaimedSweep(at), runUnclaimedSweep(at)]);

    expect(first.notified + second.notified).toBe(1);
    expect(await alertsFor(claimer)).toBe(1);
    const saved = await ServiceRequest.findOne({});
    expect(saved?.unclaimedAlertCount).toBe(1);
  });

  it('gives a request returned to the open queue a fresh set of reminders', async () => {
    const claimer = await makeClaimer();
    const requestId = await seedOpenRequest();

    for (let sent = 1; sent <= UNCLAIMED_ALERT_MAX_SENDS; sent += 1) {
      await runUnclaimedSweep(minutes(sent * GAP_MINUTES));
    }
    expect(await alertsFor(claimer)).toBe(UNCLAIMED_ALERT_MAX_SENDS);

    // Assigned, then returned to the queue. A second spell is chased on its own merits:
    // somebody has just handed the work back, which is precisely when it must not be silent.
    const reopenedAt = minutes(10 * GAP_MINUTES);
    await ServiceRequest.updateOne(
      { _id: requestId },
      {
        $set: {
          openedForClaimAt: reopenedAt,
          unclaimedNotifiedFor: null,
          unclaimedAlertCount: 0,
          status: 'UNASSIGNED',
          assignedEmployees: [],
        },
      },
    );

    for (let sent = 1; sent <= UNCLAIMED_ALERT_MAX_SENDS; sent += 1) {
      const due = await runUnclaimedSweep(
        new Date(reopenedAt.getTime() + sent * UNCLAIMED_ALERT_AFTER_MS),
      );
      expect(due.notified).toBe(1);
    }

    expect(await alertsFor(claimer)).toBe(UNCLAIMED_ALERT_MAX_SENDS * 2);
  });

  it('resets the count through the status change that reopens a request', async () => {
    const changer = await createUserWithPermissions('restamp@test.mn', [
      PERMISSIONS.SERVICE_REQUEST_CHANGE_STATUS,
      PERMISSIONS.SERVICE_REQUEST_VIEW,
    ]);
    const token = await login(changer.email, changer.password);
    const requestId = await seedOpenRequest({
      status: 'ASSIGNED',
      assignedEmployees: [new Types.ObjectId()],
      openedForClaimAt: null,
      unclaimedNotifiedFor: OPENED_AT,
      unclaimedAlertCount: UNCLAIMED_ALERT_MAX_SENDS,
    });

    const response = await request(app)
      .post(`${API}/service-requests/${String(requestId)}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'UNASSIGNED', reason: 'Ажилтан татгалзсан.' });

    expect(response.status).toBe(200);

    const saved = await ServiceRequest.findById(requestId);
    expect(saved?.openedForClaimAt).not.toBeNull();
    expect(saved?.unclaimedNotifiedFor).toBeNull();
    // Without this the returned job would be born capped, and therefore silent.
    expect(saved?.unclaimedAlertCount).toBe(0);
    expect(saved?.assignedEmployees).toHaveLength(0);
  });

  it('stops chasing a request as soon as somebody claims it', async () => {
    const claimer = await makeClaimer('watcher@test.mn');
    const tech = await makeTechnician();
    const requestId = await seedOpenRequest();

    await runUnclaimedSweep(minutes(GAP_MINUTES));
    expect(await alertsFor(claimer)).toBe(1);

    await request(app)
      .post(`${API}/service-requests/${String(requestId)}/claim`)
      .set('Authorization', `Bearer ${tech.token}`)
      .send({});

    const later = await runUnclaimedSweep(minutes(GAP_MINUTES * 2));

    expect(later.notified).toBe(0);
    expect(await alertsFor(claimer)).toBe(1);

    /*
     * Clearing the open stamp is what ends the chase, and it is the only thing the claim
     * path has to do. The counter is left as it was — the claim writes the request in one
     * atomic update of its own rather than calling `clearOpenForClaim` — and that stale
     * value is inert: the sweep's query never sees a row with no open stamp, and if the
     * work returns to the queue `markOpenForClaim` resets the count before anyone reads it.
     */
    const saved = await ServiceRequest.findById(requestId);
    expect(saved?.openedForClaimAt).toBeNull();
    expect(saved?.unclaimedNotifiedFor).toBeNull();

    // The claim leaves nothing behind that could silence a second spell in the queue.
    await ServiceRequest.updateOne(
      { _id: requestId },
      { $set: { status: 'UNASSIGNED', assignedEmployees: [] } },
    );
    await markOpenForClaim(requestId, minutes(GAP_MINUTES * 3));
    const reopened = await runUnclaimedSweep(minutes(GAP_MINUTES * 4));
    expect(reopened.notified).toBe(1);
    expect(await alertsFor(claimer)).toBe(2);
  });
});
