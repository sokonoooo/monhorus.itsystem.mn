import type { Express } from 'express';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { dayBounds } from '../../common/utils/day-bounds.util';
import { env } from '../../config/env';
import { resetDomainCollections, startTestApp, stopTestApp } from '../../test/helpers';
import { Customer } from '../objects/object.models';
import { invalidateSettingsCache } from '../settings/settings.service';
import { Invoice } from './invoice.model';
import {
  effectiveInvoiceStatus,
  listInvoices,
  overdueBoundary,
  overdueDaysOf,
  summariseInvoices,
} from './invoice.service';

/**
 * Overdue is framed on the Ulaanbaatar day, not the UTC day.
 *
 * `dueDate` is a calendar date stamped at UTC midnight, and the module used to close that
 * date with `setUTCHours(23, 59, 59, 999)`. The rest of the product — the dashboard's
 * finance block above all — frames the same day with `dayBounds(…, APP_TIMEZONE)`. For the
 * eight hours between 00:00 and 08:00 local the two framings disagree, and every invoice
 * surface disagreed with the dashboard: ₮2.2M overdue on one screen, ₮0 on the other, an
 * «Илгээсэн» badge on a row the dashboard was counting as late, an empty `?status=OVERDUE`
 * filter, and a customer reminder that arrived eight hours after the deadline it named.
 *
 * These tests fix the clock rather than reading it, because the bug only shows itself
 * during a third of the day and a test that depends on when it runs proves nothing.
 */
const UB = 'Asia/Ulaanbaatar';

/** The end of 4 September in Ulaanbaatar is 15:59:59.999Z; the UTC day ran to 23:59:59.999Z. */
const DUE = new Date('2026-09-04T00:00:00.000Z');

function sent(dueDate: Date = DUE): { status: 'SENT'; dueDate: Date } {
  return { status: 'SENT', dueDate };
}

describe('invoice overdue is framed on the local day', () => {
  it('uses the configured application timezone', () => {
    expect(env.APP_TIMEZONE).toBe(UB);
  });

  it('is not overdue while it is still the due date in Ulaanbaatar', () => {
    // 23:00 on 4 September in Ulaanbaatar. Still the due date; still on time.
    expect(effectiveInvoiceStatus(sent(), new Date('2026-09-04T15:00:00.000Z'))).toBe('SENT');
    expect(overdueDaysOf(sent(), new Date('2026-09-04T15:00:00.000Z'))).toBeNull();
  });

  /**
   * The case the old code got wrong. 00:30 on 5 September in Ulaanbaatar is 16:30Z on the
   * 4th, which the UTC framing still called "the due date" — for eight more hours.
   */
  it('is overdue from the first minute of the next local day', () => {
    const justAfterLocalMidnight = new Date('2026-09-04T16:30:00.000Z');

    expect(effectiveInvoiceStatus(sent(), justAfterLocalMidnight)).toBe('OVERDUE');
    expect(overdueDaysOf(sent(), justAfterLocalMidnight)).toBe(1);
  });

  it('is still overdue later the same local morning', () => {
    // 09:00 on 5 September in Ulaanbaatar — the hour the old framing finally caught up.
    const morning = new Date('2026-09-05T01:00:00.000Z');

    expect(effectiveInvoiceStatus(sent(), morning)).toBe('OVERDUE');
    expect(overdueDaysOf(sent(), morning)).toBe(1);
  });

  it('leaves a settled invoice alone whatever the hour', () => {
    for (const status of ['DRAFT', 'PAID', 'CANCELLED'] as const) {
      expect(effectiveInvoiceStatus({ status, dueDate: DUE }, new Date('2026-09-30T00:00:00.000Z'))).toBe(
        status,
      );
    }
  });

  /**
   * The dashboard reaches the same boundary by the same expression
   * (`dashboard.service.ts`, financeBlock: `dayBounds(now, env.APP_TIMEZONE).start`). This
   * is the assertion that keeps the two screens from drifting apart again.
   */
  it('shares the dashboard boundary at every hour of the day', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const now = new Date(Date.UTC(2026, 8, 4, hour, 30));
      expect(overdueBoundary(now).toISOString()).toBe(
        dayBounds(now, env.APP_TIMEZONE).start.toISOString(),
      );
    }
  });
});

describe('the invoice list, the summary and the dashboard agree at every hour', () => {
  let app: Express;
  let customerId: Types.ObjectId;

  beforeAll(async () => {
    app = await startTestApp();
    expect(app).toBeTruthy();
  });

  afterAll(async () => {
    await stopTestApp();
  });

  beforeEach(async () => {
    await resetDomainCollections();
    invalidateSettingsCache();
    const customer = await Customer.create({ code: 'C-OD-1', name: 'Их дэлгүүр' });
    customerId = customer._id;

    await Invoice.create({
      invoiceNumber: 'INV-202609-0001',
      customer: customerId,
      serviceAgreement: null,
      billingType: 'MONTHLY_SERVICE',
      billingPeriod: '2026-09',
      issueDate: new Date('2026-09-01T00:00:00.000Z'),
      dueDate: DUE,
      lines: [],
      subtotal: 2_200_000,
      taxPercent: 0,
      taxAmount: 0,
      total: 2_200_000,
      currency: 'MNT',
      status: 'SENT',
    });
  });

  /**
   * Walked hour by hour across the local midnight the bug lived on. Each hour asks the
   * same question of four code paths — the row badge, the `?status=OVERDUE` filter, the
   * receivables card, and the dashboard's own boundary — and requires one answer.
   */
  it('answers overdue identically on every surface, hour by hour', async () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const now = new Date(Date.UTC(2026, 8, 4, hour, 30));
      const dashboardSaysOverdue = DUE < dayBounds(now, env.APP_TIMEZONE).start;

      const page = await listInvoices({ page: 1, limit: 25 }, now);
      const filtered = await listInvoices({ page: 1, limit: 25, status: 'OVERDUE' }, now);
      const summary = await summariseInvoices({}, now);

      const label = `at ${now.toISOString()}`;
      expect(`${label}: ${page.items[0]?.effectiveStatus}`).toBe(
        `${label}: ${dashboardSaysOverdue ? 'OVERDUE' : 'SENT'}`,
      );
      expect(`${label}: ${filtered.total}`).toBe(`${label}: ${dashboardSaysOverdue ? 1 : 0}`);
      expect(`${label}: ${summary.overdueCount}`).toBe(`${label}: ${dashboardSaysOverdue ? 1 : 0}`);
      expect(`${label}: ${summary.overdueTotal}`).toBe(
        `${label}: ${dashboardSaysOverdue ? 2_200_000 : 0}`,
      );
    }
  });
});
