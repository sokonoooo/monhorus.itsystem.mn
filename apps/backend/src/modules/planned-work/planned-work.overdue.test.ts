import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { dayBounds } from '../../common/utils/day-bounds.util';
import { env } from '../../config/env';
import {
  createObjectFixture,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
  type ObjectFixture,
} from '../../test/helpers';
import { PlannedWork } from './planned-work.models';
import {
  deadlineEndOf,
  effectiveStatusOf,
  markOverdueIfNeeded,
  overdueBoundary,
  runOverdueReconciliation,
} from './planned-work.overdue.service';

/**
 * Overdue is framed on the Ulaanbaatar day, not the UTC instant.
 *
 * `plannedEndDate` is a calendar date that the web stamps at UTC midnight — 08:00 in
 * Ulaanbaatar. Compared against a raw `now`, a work due 10 September went OVERDUE at 08:01
 * on the 10th, with a full working day still to run. That was not cosmetic: it persisted
 * `overdueAt`, wrote a one-time PLANNED_WORK_BECAME_OVERDUE audit event and fired the
 * PLANNED_WORK_OVERDUE notification.
 *
 * These tests fix the clock rather than reading it, because the bug only showed itself
 * between 08:00 and midnight and a test that depends on when it runs proves nothing.
 *
 * The sibling case, and the same fix, is `invoice.overdue.test.ts`.
 */
const UB = 'Asia/Ulaanbaatar';

/** Due 10 September. Stored the way every web client writes it. */
const DUE = new Date('2026-09-10T00:00:00.000Z');

/** 09:00 on 10 September in Ulaanbaatar — the due date, during working hours. */
const NINE_AM_ON_DUE_DATE = new Date('2026-09-10T01:00:00.000Z');

/** 00:30 on 11 September in Ulaanbaatar — the first minutes of the day after. */
const JUST_AFTER_MIDNIGHT_NEXT_DAY = new Date('2026-09-10T16:30:00.000Z');

function outstanding(plannedEndDate: Date = DUE): {
  status: 'PLANNED';
  plannedEndDate: Date;
} {
  return { status: 'PLANNED', plannedEndDate };
}

describe('planned work overdue is framed on the local day', () => {
  it('uses the configured application timezone', () => {
    expect(env.APP_TIMEZONE).toBe(UB);
  });

  /**
   * THE BUG. At 08:01 local on its own due date the old framing already said OVERDUE.
   */
  it('is not overdue at 09:00 on its own due date', () => {
    expect(effectiveStatusOf(outstanding(), NINE_AM_ON_DUE_DATE)).toBe('PLANNED');
  });

  it('is not overdue at any hour of its own due date', () => {
    // 00:00 through 23:00 in Ulaanbaatar on 10 September.
    for (let hour = 0; hour < 24; hour += 1) {
      const localHour = new Date(Date.UTC(2026, 8, 9, 16, 0) + hour * 3_600_000);
      expect(effectiveStatusOf(outstanding(), localHour), `hour ${hour} local`).toBe('PLANNED');
    }
  });

  it('is overdue from the first minute of the next local day', () => {
    expect(effectiveStatusOf(outstanding(), JUST_AFTER_MIDNIGHT_NEXT_DAY)).toBe('OVERDUE');
  });

  it('leaves a settled work alone whatever the hour', () => {
    for (const status of ['COMPLETED', 'CANCELLED', 'ARCHIVED'] as const) {
      expect(
        effectiveStatusOf({ status, plannedEndDate: DUE }, JUST_AFTER_MIDNIGHT_NEXT_DAY),
      ).toBe(status);
    }
  });

  /**
   * The boundary is reached by the same expression the dashboard and the invoice module
   * use. This is the assertion that keeps the surfaces from drifting apart again.
   */
  it('shares the day boundary with dayBounds at every hour of the day', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const now = new Date(Date.UTC(2026, 8, 10, hour, 30));
      expect(overdueBoundary(now).toISOString()).toBe(
        dayBounds(now, env.APP_TIMEZONE).start.toISOString(),
      );
    }
  });

  it('closes the deadline day at 23:59:59.999 local', () => {
    // 15:59:59.999Z is 23:59:59.999 in Ulaanbaatar on the 10th.
    expect(deadlineEndOf(DUE).toISOString()).toBe('2026-09-10T15:59:59.999Z');
  });
});

describe('the overdue stamp follows the same boundary', () => {
  let fixture: ObjectFixture;

  beforeAll(async () => {
    await startTestApp();
  }, 60_000);

  afterAll(async () => {
    await stopTestApp();
  });

  beforeEach(async () => {
    await resetDomainCollections();
    fixture = await createObjectFixture();
  });

  async function seedWork(plannedEndDate: Date = DUE): Promise<Types.ObjectId> {
    const work = await PlannedWork.create({
      workNumber: `PW-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      project: null,
      building: new Types.ObjectId(fixture.buildingId),
      customer: new Types.ObjectId(fixture.customerId),
      title: 'Хагас жилийн үзлэг',
      plannedStartDate: new Date('2026-09-01T00:00:00.000Z'),
      plannedEndDate,
      originalPlannedEndDate: plannedEndDate,
      status: 'PLANNED',
    });
    return work._id;
  }

  it('does not stamp overdueAt at 09:00 on the due date', async () => {
    const id = await seedWork();
    const work = await PlannedWork.findById(id);

    expect(await markOverdueIfNeeded(work!, NINE_AM_ON_DUE_DATE)).toBe(false);
    expect((await PlannedWork.findById(id))?.overdueAt).toBeNull();
  });

  it('stamps overdueAt once the local day has turned', async () => {
    const id = await seedWork();
    const work = await PlannedWork.findById(id);

    expect(await markOverdueIfNeeded(work!, JUST_AFTER_MIDNIGHT_NEXT_DAY)).toBe(true);
    expect((await PlannedWork.findById(id))?.overdueAt).not.toBeNull();
  });

  /**
   * The hourly sweep filters in the database, so the boundary has to survive being pushed
   * into the query. A `dayBounds` applied to the stored field could not.
   */
  it('the reconciliation sweep marks nothing during the due date', async () => {
    await seedWork();

    const result = await runOverdueReconciliation(NINE_AM_ON_DUE_DATE);

    expect(result.markedOverdue).toBe(0);
    expect(result.scanned).toBe(0);
  });

  it('the reconciliation sweep marks the breach after the local day turns', async () => {
    await seedWork();

    const result = await runOverdueReconciliation(JUST_AFTER_MIDNIGHT_NEXT_DAY);

    expect(result.markedOverdue).toBe(1);
  });
});
