import { OVERDUE_ELIGIBLE_LIFECYCLE_STATUSES } from '@monhorus/shared';
import { Types } from 'mongoose';

import { logger } from '../../config/logger';
import { Invoice } from '../invoice/invoice.model';
import { effectiveInvoiceStatus } from '../invoice/invoice.service';
import { PlannedWork } from '../planned-work/planned-work.models';
import { ServiceRequest } from '../service-request/service-request.model';
import { evaluateSla } from '../service-request/sla.service';
import { getSlaConfig } from '../settings/settings.service';
import { notify } from './notification.service';
import { userIdsForEmployees } from './recipient.util';

/**
 * Deadline reminders: the six events section 14.3 declares and nothing emitted.
 *
 * Each sweep follows the idiom `unclaimed.service.ts` established, because the failure it
 * prevents is the one that matters here: a job that runs every few minutes must not
 * re-announce the same deadline on every pass. The notification is written only after a
 * conditional update has staked a marker, so a duplicate is impossible rather than merely
 * unlikely, and two concurrent passes cannot both win.
 *
 * Every marker stores the *deadline it was sent for* rather than a boolean. Equal means
 * this deadline has been announced; different or null means it has not. That is what makes
 * a rescheduled work, an extended SLA or an edited invoice due date re-arm on its own,
 * with no clear step on the mutation paths for somebody to forget.
 *
 *
 * THRESHOLDS
 *
 * Three of these events need a lead time, and the codebase defines none — there is no
 * planned-work setting group, and `finance.invoice_due_days` is the due-date prefill, not a
 * reminder window. The values below were chosen on 2026-08-18 and are stated here rather
 * than buried, because they are assumptions and not requirements:
 *
 *   - planned work: 24 hours before the planned end. The end date is the actionable one;
 *     the event label mentions start and end, but a warning about work that has not begun
 *     is a scheduling question, not a deadline.
 *   - invoice: 3 days before the due date, which leaves a working day to act on.
 *   - overdue invoices announce once, on first breach, not daily.
 *
 * They are module constants rather than settings keys deliberately: the settings catalogue
 * states that a key nothing reads is a placeholder pretending to be a feature, so promoting
 * these belongs with the screen that would edit them. `UNCLAIMED_ALERT_AFTER_MS` sets the
 * same precedent.
 */

export const PLANNED_WORK_DUE_SOON_MS = 24 * 60 * 60 * 1000;
export const INVOICE_DUE_SOON_MS = 3 * 24 * 60 * 60 * 1000;

/** One pass handles at most this many rows per category, so a backlog cannot stall a tick. */
const SWEEP_LIMIT = 500;

export interface ReminderSweepResult {
  plannedWorkDueSoon: number;
  plannedWorkOverdue: number;
  slaNearBreach: number;
  slaBreached: number;
  invoiceDueSoon: number;
  invoiceOverdue: number;
}

async function recipientsForWork(
  employeeIds: readonly Types.ObjectId[],
): Promise<Types.ObjectId[]> {
  return userIdsForEmployees(employeeIds.map((id) => String(id)));
}

/**
 * Planned work that has crossed its deadline.
 *
 * Queries on `overdueNotificationSentAt` rather than piggybacking on the reconciliation
 * pass that stamps `overdueAt`. The two are separate on purpose: reconciliation has been
 * stamping `overdueAt` since before notifications existed, so a fleet of already-breached
 * works carries a stamp and would never be announced if this keyed off the transition.
 * Keying off the unsent marker catches them on the first run.
 */
async function sweepPlannedWorkOverdue(now: Date): Promise<number> {
  const candidates = await PlannedWork.find({
    status: { $in: OVERDUE_ELIGIBLE_LIFECYCLE_STATUSES },
    overdueAt: { $ne: null },
    overdueNotificationSentAt: null,
  })
    .select('_id workNumber title assignedEmployees plannedEndDate')
    .limit(SWEEP_LIMIT);

  let sent = 0;
  for (const work of candidates) {
    const staked = await PlannedWork.updateOne(
      { _id: work._id, overdueNotificationSentAt: null },
      { $set: { overdueNotificationSentAt: now } },
    );
    if (staked.modifiedCount === 0) continue;

    await notify({
      event: 'PLANNED_WORK_OVERDUE',
      title: `${work.workNumber} төлөвлөгөөт ажлын хугацаа хэтэрлээ`,
      body: work.title,
      entityType: 'PlannedWork',
      entityId: work._id,
      linkPath: `/planned-work/${String(work._id)}`,
      permission: 'planned_work.view',
      userIds: await recipientsForWork(work.assignedEmployees),
    });
    sent += 1;
  }
  return sent;
}

/** Planned work approaching its deadline. */
async function sweepPlannedWorkDueSoon(now: Date): Promise<number> {
  const horizon = new Date(now.getTime() + PLANNED_WORK_DUE_SOON_MS);

  const candidates = await PlannedWork.find({
    status: { $in: OVERDUE_ELIGIBLE_LIFECYCLE_STATUSES },
    overdueAt: null,
    plannedEndDate: { $gt: now, $lte: horizon },
  })
    .select('_id workNumber title assignedEmployees plannedEndDate dueSoonNotifiedFor')
    .limit(SWEEP_LIMIT);

  let sent = 0;
  for (const work of candidates) {
    const deadline = work.plannedEndDate;
    if (work.dueSoonNotifiedFor?.getTime() === deadline.getTime()) continue;

    const staked = await PlannedWork.updateOne(
      {
        _id: work._id,
        // Re-asserted so a work rescheduled between the find and this write is not warned.
        plannedEndDate: deadline,
        $or: [{ dueSoonNotifiedFor: null }, { dueSoonNotifiedFor: { $ne: deadline } }],
      },
      { $set: { dueSoonNotifiedFor: deadline } },
    );
    if (staked.modifiedCount === 0) continue;

    await notify({
      event: 'PLANNED_WORK_DUE_SOON',
      title: `${work.workNumber} төлөвлөгөөт ажлын хугацаа дөхлөө`,
      body: work.title,
      entityType: 'PlannedWork',
      entityId: work._id,
      linkPath: `/planned-work/${String(work._id)}`,
      permission: 'planned_work.view',
      userIds: await recipientsForWork(work.assignedEmployees),
    });
    sent += 1;
  }
  return sent;
}

/**
 * Service requests approaching or past their SLA deadline.
 *
 * Near-breach fires on threshold *crossing*, not on the narrow NEAR_BREACH band that
 * `evaluateSla` reports. The ladder there checks the at-risk ratio first, so a request that
 * consumes its window between two ticks reports AT_RISK and never passes through
 * NEAR_BREACH — matching only that state would silently skip exactly the requests moving
 * fastest, which are the ones worth warning about.
 */
async function sweepSla(now: Date): Promise<{ near: number; breached: number }> {
  const config = await getSlaConfig();

  const candidates = await ServiceRequest.find({
    status: { $nin: ['COMPLETED', 'CANCELLED'] },
    slaDueAt: { $ne: null },
  })
    .select(
      '_id requestNumber description status isUrgent slaStartedAt slaDueAt completedAt ' +
        'slaNearBreachNotifiedFor slaBreachNotifiedFor',
    )
    .limit(SWEEP_LIMIT);

  let near = 0;
  let breached = 0;

  for (const request of candidates) {
    const deadline = request.slaDueAt;
    const { state } = evaluateSla({
      status: request.status,
      isUrgent: request.isUrgent,
      slaStartedAt: request.slaStartedAt,
      slaDueAt: deadline,
      completedAt: request.completedAt,
      now,
      config,
    });

    if (state === 'BREACHED') {
      if (request.slaBreachNotifiedFor?.getTime() === deadline.getTime()) continue;
      const staked = await ServiceRequest.updateOne(
        {
          _id: request._id,
          slaDueAt: deadline,
          $or: [{ slaBreachNotifiedFor: null }, { slaBreachNotifiedFor: { $ne: deadline } }],
        },
        { $set: { slaBreachNotifiedFor: deadline } },
      );
      if (staked.modifiedCount === 0) continue;

      await notify({
        event: 'SLA_BREACHED',
        title: `${request.requestNumber} SLA хугацаа зөрчигдлөө`,
        body: request.description,
        entityType: 'Work',
        entityId: request._id,
        linkPath: `/service-requests/${String(request._id)}`,
        permission: 'service_request.view',
      });
      breached += 1;
      continue;
    }

    if (state === 'NEAR_BREACH' || state === 'AT_RISK') {
      if (request.slaNearBreachNotifiedFor?.getTime() === deadline.getTime()) continue;
      const staked = await ServiceRequest.updateOne(
        {
          _id: request._id,
          slaDueAt: deadline,
          $or: [
            { slaNearBreachNotifiedFor: null },
            { slaNearBreachNotifiedFor: { $ne: deadline } },
          ],
        },
        { $set: { slaNearBreachNotifiedFor: deadline } },
      );
      if (staked.modifiedCount === 0) continue;

      await notify({
        event: 'SLA_NEAR_BREACH',
        title: `${request.requestNumber} SLA хугацаа дөхлөө`,
        body: request.description,
        entityType: 'Work',
        entityId: request._id,
        linkPath: `/service-requests/${String(request._id)}`,
        permission: 'service_request.view',
      });
      near += 1;
    }
  }

  return { near, breached };
}

/**
 * Unpaid invoices approaching or past their due date.
 *
 * Overdue reuses `effectiveInvoiceStatus` rather than re-deriving the comparison, because
 * that function already encodes the rule that an invoice is not overdue on the day it falls
 * due — it compares against the end of the due date. Two implementations of that rule would
 * eventually disagree, and the notification would contradict the screen.
 *
 * The customer is notified as well as the finance team: an unpaid invoice is the one
 * notification the payer genuinely needs.
 */
async function sweepInvoices(now: Date): Promise<{ dueSoon: number; overdue: number }> {
  const horizon = new Date(now.getTime() + INVOICE_DUE_SOON_MS);

  const candidates = await Invoice.find({ status: 'SENT' })
    .select('_id invoiceNumber customer total currency dueDate status dueSoonNotifiedFor overdueNotifiedFor')
    .limit(SWEEP_LIMIT);

  let dueSoon = 0;
  let overdue = 0;

  for (const invoice of candidates) {
    const deadline = invoice.dueDate;
    const effective = effectiveInvoiceStatus(invoice, now);

    if (effective === 'OVERDUE') {
      if (invoice.overdueNotifiedFor?.getTime() === deadline.getTime()) continue;
      const staked = await Invoice.updateOne(
        {
          _id: invoice._id,
          dueDate: deadline,
          status: 'SENT',
          $or: [{ overdueNotifiedFor: null }, { overdueNotifiedFor: { $ne: deadline } }],
        },
        { $set: { overdueNotifiedFor: deadline } },
      );
      if (staked.modifiedCount === 0) continue;

      await notify({
        event: 'INVOICE_OVERDUE',
        title: `${invoice.invoiceNumber} нэхэмжлэлийн төлбөр хугацаа хэтэрлээ`,
        body: `Төлөх дүн ${invoice.total.toLocaleString('mn-MN')} ${invoice.currency}.`,
        entityType: 'Invoice',
        entityId: invoice._id,
        linkPath: `/invoices/${String(invoice._id)}`,
        permission: 'invoice.view',
        customerId: invoice.customer,
      });
      overdue += 1;
      continue;
    }

    if (deadline > now && deadline <= horizon) {
      if (invoice.dueSoonNotifiedFor?.getTime() === deadline.getTime()) continue;
      const staked = await Invoice.updateOne(
        {
          _id: invoice._id,
          dueDate: deadline,
          status: 'SENT',
          $or: [{ dueSoonNotifiedFor: null }, { dueSoonNotifiedFor: { $ne: deadline } }],
        },
        { $set: { dueSoonNotifiedFor: deadline } },
      );
      if (staked.modifiedCount === 0) continue;

      await notify({
        event: 'INVOICE_DUE_SOON',
        title: `${invoice.invoiceNumber} нэхэмжлэлийн төлбөрийн хугацаа дөхлөө`,
        body: `Төлөх дүн ${invoice.total.toLocaleString('mn-MN')} ${invoice.currency}.`,
        entityType: 'Invoice',
        entityId: invoice._id,
        linkPath: `/invoices/${String(invoice._id)}`,
        permission: 'invoice.view',
        customerId: invoice.customer,
      });
      dueSoon += 1;
    }
  }

  return { dueSoon, overdue };
}

/**
 * One pass over every deadline category.
 *
 * Categories run in sequence rather than concurrently: this is a background sweep with no
 * latency requirement, and serialising keeps it from competing with request traffic for
 * connections on a host with 7.4 GB of RAM and four other tenants on it.
 */
export async function runReminderSweep(now: Date = new Date()): Promise<ReminderSweepResult> {
  const plannedWorkOverdue = await sweepPlannedWorkOverdue(now);
  const plannedWorkDueSoon = await sweepPlannedWorkDueSoon(now);
  const sla = await sweepSla(now);
  const invoices = await sweepInvoices(now);

  const result: ReminderSweepResult = {
    plannedWorkOverdue,
    plannedWorkDueSoon,
    slaNearBreach: sla.near,
    slaBreached: sla.breached,
    invoiceDueSoon: invoices.dueSoon,
    invoiceOverdue: invoices.overdue,
  };

  if (Object.values(result).some((count) => count > 0)) {
    logger.info(result, 'Reminder sweep sent deadline notifications');
  }
  return result;
}
