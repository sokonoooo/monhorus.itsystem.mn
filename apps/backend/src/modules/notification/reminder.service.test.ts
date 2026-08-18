import { PERMISSIONS } from '@monhorus/shared';
import type { Express } from 'express';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createObjectFixture,
  createUserWithPermissions,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
} from '../../test/helpers';
import { Invoice } from '../invoice/invoice.model';
import { ServiceRequest } from '../service-request/service-request.model';
import { PlannedWork } from '../planned-work/planned-work.models';
import { Notification } from './notification.model';
import { INVOICE_DUE_SOON_MS, PLANNED_WORK_DUE_SOON_MS, runReminderSweep } from './reminder.service';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let app: Express;

async function makePlannedWork(overrides: Record<string, unknown>): Promise<string> {
  const fixture = await createObjectFixture();
  const start = new Date(Date.now() - 7 * DAY);
  const work = await PlannedWork.create({
    workNumber: `PW-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    project: null,
    building: new Types.ObjectId(fixture.buildingId),
    customer: new Types.ObjectId(fixture.customerId),
    title: 'Хагас жилийн үзлэг',
    plannedStartDate: start,
    plannedEndDate: new Date(Date.now() + DAY),
    originalPlannedEndDate: new Date(Date.now() + DAY),
    status: 'PLANNED',
    ...overrides,
  });
  return String(work._id);
}

async function makeInvoice(overrides: Record<string, unknown>): Promise<string> {
  const fixture = await createObjectFixture();
  const invoice = await Invoice.create({
    invoiceNumber: `INV-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    customer: new Types.ObjectId(fixture.customerId),
    billingType: 'MONTHLY_SERVICE',
    billingPeriod: '2026-08',
    issueDate: new Date(Date.now() - 10 * DAY),
    dueDate: new Date(Date.now() + 2 * DAY),
    lines: [],
    subtotal: 100000,
    taxPercent: 10,
    taxAmount: 10000,
    total: 110000,
    status: 'SENT',
    ...overrides,
  });
  return String(invoice._id);
}

/**
 * `slaDueAt` is set explicitly rather than computed, so a case can place a request at any
 * point on the SLA ladder without depending on the configured window.
 */
async function makeServiceRequest(overrides: Record<string, unknown>): Promise<string> {
  const fixture = await createObjectFixture();
  const request = await ServiceRequest.create({
    requestNumber: `SR-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    customer: new Types.ObjectId(fixture.customerId),
    building: new Types.ObjectId(fixture.buildingId),
    requestType: 'REPAIR',
    description: 'Гэрэл асахгүй байна',
    contactName: 'Бат',
    contactPhone: '99001122',
    status: 'IN_PROGRESS',
    isUrgent: false,
    slaStartedAt: new Date(Date.now() - 4 * HOUR),
    slaDueAt: new Date(Date.now() + 4 * HOUR),
    ...overrides,
  });
  return String(request._id);
}

function countOf(event: string): Promise<number> {
  return Notification.countDocuments({ event });
}

describe('Reminder sweep', () => {
  beforeAll(async () => {
    app = await startTestApp();
    expect(app).toBeDefined();
  });
  afterAll(async () => {
    await stopTestApp();
  });
  beforeEach(async () => {
    await resetDomainCollections();
    // Somebody has to be entitled to receive these, or every sweep is a silent no-op.
    await createUserWithPermissions('watcher@test.mn', [
      PERMISSIONS.PLANNED_WORK_VIEW,
      PERMISSIONS.INVOICE_VIEW,
      PERMISSIONS.SERVICE_REQUEST_VIEW,
      PERMISSIONS.NOTIFICATION_VIEW,
    ]);
  });

  describe('planned work', () => {
    /**
     * The regression that motivated this file: reconciliation has been stamping `overdueAt`
     * since before notifications existed, so works breached before today already carry a
     * stamp. Keying the sweep off the transition would have left every one of them silent
     * forever.
     */
    it('announces work that was already stamped overdue', async () => {
      await makePlannedWork({
        plannedEndDate: new Date(Date.now() - 2 * DAY),
        originalPlannedEndDate: new Date(Date.now() - 2 * DAY),
        overdueAt: new Date(Date.now() - 2 * DAY),
        overdueNotificationSentAt: null,
      });

      const result = await runReminderSweep();

      expect(result.plannedWorkOverdue).toBe(1);
      expect(await countOf('PLANNED_WORK_OVERDUE')).toBeGreaterThan(0);
    });

    it('announces an overdue work once, not on every pass', async () => {
      await makePlannedWork({
        plannedEndDate: new Date(Date.now() - 2 * DAY),
        originalPlannedEndDate: new Date(Date.now() - 2 * DAY),
        overdueAt: new Date(Date.now() - 2 * DAY),
      });

      await runReminderSweep();
      const after = await countOf('PLANNED_WORK_OVERDUE');
      await runReminderSweep();
      await runReminderSweep();

      expect(await countOf('PLANNED_WORK_OVERDUE')).toBe(after);
    });

    it('warns about work approaching its deadline', async () => {
      await makePlannedWork({
        plannedEndDate: new Date(Date.now() + PLANNED_WORK_DUE_SOON_MS / 2),
      });

      const result = await runReminderSweep();

      expect(result.plannedWorkDueSoon).toBe(1);
    });

    it('says nothing about work whose deadline is beyond the window', async () => {
      await makePlannedWork({ plannedEndDate: new Date(Date.now() + 10 * DAY) });

      const result = await runReminderSweep();

      expect(result.plannedWorkDueSoon).toBe(0);
    });

    /**
     * The point of staking the deadline rather than a boolean: a rescheduled work is a
     * different deadline, so it earns a fresh warning without any clear step on the
     * reschedule path.
     */
    it('warns again after the deadline moves', async () => {
      const id = await makePlannedWork({
        plannedEndDate: new Date(Date.now() + PLANNED_WORK_DUE_SOON_MS / 2),
      });

      await runReminderSweep();
      const first = await countOf('PLANNED_WORK_DUE_SOON');

      await PlannedWork.updateOne(
        { _id: id },
        { $set: { plannedEndDate: new Date(Date.now() + PLANNED_WORK_DUE_SOON_MS / 3) } },
      );
      await runReminderSweep();

      expect(await countOf('PLANNED_WORK_DUE_SOON')).toBeGreaterThan(first);
    });
  });

  describe('invoices', () => {
    it('warns before an invoice falls due', async () => {
      await makeInvoice({ dueDate: new Date(Date.now() + INVOICE_DUE_SOON_MS / 2) });

      const result = await runReminderSweep();

      expect(result.invoiceDueSoon).toBe(1);
    });

    it('announces an overdue invoice', async () => {
      await makeInvoice({ dueDate: new Date(Date.now() - 3 * DAY) });

      const result = await runReminderSweep();

      expect(result.invoiceOverdue).toBe(1);
    });

    /**
     * An unpaid invoice stays overdue for weeks. Announcing it every quarter of an hour is
     * how a notification centre becomes something people stop reading.
     */
    it('announces an overdue invoice once, not on every pass', async () => {
      await makeInvoice({ dueDate: new Date(Date.now() - 3 * DAY) });

      await runReminderSweep();
      await runReminderSweep();
      await runReminderSweep();

      expect(await countOf('INVOICE_OVERDUE')).toBe(1);
    });

    it('leaves a paid invoice alone', async () => {
      await makeInvoice({ dueDate: new Date(Date.now() - 3 * DAY), status: 'PAID' });

      const result = await runReminderSweep();

      expect(result.invoiceOverdue).toBe(0);
      expect(result.invoiceDueSoon).toBe(0);
    });

    /**
     * `effectiveInvoiceStatus` compares against the END of the due date, so an invoice is
     * not overdue on the day it falls due. The sweep reuses that function rather than
     * re-deriving the rule, and this pins the two together.
     */
    it('does not call an invoice overdue on its due date', async () => {
      const today = new Date();
      today.setUTCHours(9, 0, 0, 0);
      await makeInvoice({ dueDate: today });

      const result = await runReminderSweep(new Date(today.getTime() + 2 * HOUR));

      expect(result.invoiceOverdue).toBe(0);
    });
  });

  describe('SLA', () => {
    it('announces a breached SLA', async () => {
      await makeServiceRequest({
        slaStartedAt: new Date(Date.now() - 10 * HOUR),
        slaDueAt: new Date(Date.now() - HOUR),
      });

      const result = await runReminderSweep();

      expect(result.slaBreached).toBe(1);
      expect(await countOf('SLA_BREACHED')).toBeGreaterThan(0);
    });

    it('announces a breach once, not on every pass', async () => {
      await makeServiceRequest({
        slaStartedAt: new Date(Date.now() - 10 * HOUR),
        slaDueAt: new Date(Date.now() - HOUR),
      });

      await runReminderSweep();
      const after = await countOf('SLA_BREACHED');
      await runReminderSweep();

      expect(await countOf('SLA_BREACHED')).toBe(after);
    });

    /**
     * `evaluateSla` checks the at-risk ratio before the near-breach one, so a request deep
     * into its window reports AT_RISK and never passes through the NEAR_BREACH band. Matching
     * only that band would skip exactly the requests moving fastest.
     */
    it('warns on a request well past the near-breach threshold', async () => {
      // 95% consumed: past both ratios, so evaluateSla reports AT_RISK, not NEAR_BREACH.
      await makeServiceRequest({
        slaStartedAt: new Date(Date.now() - 95 * 60 * 1000),
        slaDueAt: new Date(Date.now() + 5 * 60 * 1000),
      });

      const result = await runReminderSweep();

      expect(result.slaNearBreach).toBe(1);
    });

    it('says nothing about a request early in its window', async () => {
      await makeServiceRequest({
        slaStartedAt: new Date(Date.now() - 10 * 60 * 1000),
        slaDueAt: new Date(Date.now() + 10 * HOUR),
      });

      const result = await runReminderSweep();

      expect(result.slaNearBreach).toBe(0);
      expect(result.slaBreached).toBe(0);
    });

    it('leaves a completed request alone', async () => {
      await makeServiceRequest({
        status: 'COMPLETED',
        completedAt: new Date(Date.now() - 2 * HOUR),
        slaDueAt: new Date(Date.now() - HOUR),
      });

      const result = await runReminderSweep();

      expect(result.slaBreached).toBe(0);
    });
  });

  it('reports every category in one pass', async () => {
    await makePlannedWork({
      plannedEndDate: new Date(Date.now() - 2 * DAY),
      originalPlannedEndDate: new Date(Date.now() - 2 * DAY),
      overdueAt: new Date(Date.now() - 2 * DAY),
    });
    await makeInvoice({ dueDate: new Date(Date.now() - 3 * DAY) });

    const result = await runReminderSweep();

    expect(result).toMatchObject({ plannedWorkOverdue: 1, invoiceOverdue: 1 });
    // The keys exist even at zero, so a sweep that finds nothing is still legible in logs.
    expect(Object.keys(result).sort()).toEqual([
      'invoiceDueSoon',
      'invoiceOverdue',
      'plannedWorkDueSoon',
      'plannedWorkOverdue',
      'slaBreached',
      'slaNearBreach',
    ]);
  });
});
