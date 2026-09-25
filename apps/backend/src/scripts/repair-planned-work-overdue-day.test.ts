import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PlannedWork } from '../modules/planned-work/planned-work.models';
import {
  createObjectFixture,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
  type ObjectFixture,
} from '../test/helpers';
import { repairPlannedWorkOverdueDay } from './repair-planned-work-overdue-day';

/**
 * The stamps the UTC-day framing left behind.
 *
 * The code fix repairs the DERIVED status on its own — `effectiveStatusOf` recomputes on
 * every read — but `overdueAt` and `completedLate` were persisted, and nothing in the
 * application ever clears them: `markOverdueIfNeeded` skips a work that already carries a
 * stamp, and only an authorised reschedule lifts one. Without this repair a work wrongly
 * marked at 08:00 on its own due date stays marked for good.
 */

/** Due 10 September, stored the way every web client writes a calendar date. */
const DUE = new Date('2026-09-10T00:00:00.000Z');

/** 09:00 on 10 September in Ulaanbaatar: the hour the old framing wrongly stamped. */
const FALSE_STAMP = new Date('2026-09-10T01:00:00.000Z');

/** 11:00 on 10 September in Ulaanbaatar — still the due date. "Now", for the run. */
const NOW_ON_DUE_DATE = new Date('2026-09-10T03:00:00.000Z');

describe('repairPlannedWorkOverdueDay', () => {
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

  async function seedWork(overrides: Record<string, unknown> = {}): Promise<Types.ObjectId> {
    const work = await PlannedWork.create({
      workNumber: `PW-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      project: null,
      building: new Types.ObjectId(fixture.buildingId),
      customer: new Types.ObjectId(fixture.customerId),
      title: 'Хагас жилийн үзлэг',
      plannedStartDate: new Date('2026-09-01T00:00:00.000Z'),
      plannedEndDate: DUE,
      originalPlannedEndDate: DUE,
      status: 'PLANNED',
      ...overrides,
    });
    return work._id;
  }

  it('clears a stamp written during the work’s own due date', async () => {
    const id = await seedWork({ overdueAt: FALSE_STAMP });

    const result = await repairPlannedWorkOverdueDay({ dryRun: false, now: NOW_ON_DUE_DATE });

    expect(result.clearedStamps).toHaveLength(1);
    expect(result.clearedStamps[0]?.workId).toBe(String(id));
    expect((await PlannedWork.findById(id))?.overdueAt).toBeNull();
  });

  it('also clears the notification marker, so a real breach is still announced later', async () => {
    const id = await seedWork({
      overdueAt: FALSE_STAMP,
      overdueNotificationSentAt: FALSE_STAMP,
    });

    const result = await repairPlannedWorkOverdueDay({ dryRun: false, now: NOW_ON_DUE_DATE });

    expect(result.clearedStamps[0]?.notificationAlreadySent).toBe(true);
    const after = await PlannedWork.findById(id);
    expect(after?.overdueNotificationSentAt).toBeNull();
  });

  /**
   * The distinguishing test. The repair does not ask which client wrote a row or look for
   * a `T00:00:00.000Z` shape; it re-evaluates the corrected predicate. A work whose
   * deadline really has passed keeps its stamp.
   */
  it('leaves a genuinely overdue work stamped', async () => {
    const stampedFor = new Date('2026-09-02T01:00:00.000Z');
    const id = await seedWork({
      plannedEndDate: new Date('2026-09-01T00:00:00.000Z'),
      originalPlannedEndDate: new Date('2026-09-01T00:00:00.000Z'),
      overdueAt: stampedFor,
    });

    const result = await repairPlannedWorkOverdueDay({ dryRun: false, now: NOW_ON_DUE_DATE });

    expect(result.clearedStamps).toHaveLength(0);
    expect((await PlannedWork.findById(id))?.overdueAt?.toISOString()).toBe(
      stampedFor.toISOString(),
    );
  });

  it('defaults to a dry run and writes nothing', async () => {
    const id = await seedWork({ overdueAt: FALSE_STAMP });

    const result = await repairPlannedWorkOverdueDay({ now: NOW_ON_DUE_DATE });

    expect(result.dryRun).toBe(true);
    expect(result.clearedStamps).toHaveLength(1);
    // Reported, but not written.
    expect((await PlannedWork.findById(id))?.overdueAt).not.toBeNull();
  });

  it('is idempotent', async () => {
    await seedWork({ overdueAt: FALSE_STAMP });

    const first = await repairPlannedWorkOverdueDay({ dryRun: false, now: NOW_ON_DUE_DATE });
    const second = await repairPlannedWorkOverdueDay({ dryRun: false, now: NOW_ON_DUE_DATE });

    expect(first.clearedStamps).toHaveLength(1);
    expect(second.clearedStamps).toHaveLength(0);
  });

  it('clears a late mark on a work completed during its own deadline day', async () => {
    // Completed at 09:00 on 10 September in Ulaanbaatar. The old comparison called this
    // an hour late because it measured from 08:00 local.
    const id = await seedWork({
      status: 'COMPLETED',
      actualEndDate: new Date('2026-09-10T01:00:00.000Z'),
      completedLate: true,
      delayMinutes: 60,
    });

    const result = await repairPlannedWorkOverdueDay({ dryRun: false, now: NOW_ON_DUE_DATE });

    expect(result.clearedLateMarks).toHaveLength(1);
    expect(result.clearedLateMarks[0]?.previousDelayMinutes).toBe(60);
    const after = await PlannedWork.findById(id);
    expect(after?.completedLate).toBe(false);
    expect(after?.delayMinutes).toBeNull();
  });

  it('leaves a genuinely late completion marked', async () => {
    const id = await seedWork({
      status: 'COMPLETED',
      // 09:00 on 11 September local: a day past the deadline.
      actualEndDate: new Date('2026-09-11T01:00:00.000Z'),
      completedLate: true,
      delayMinutes: 540,
    });

    const result = await repairPlannedWorkOverdueDay({ dryRun: false, now: NOW_ON_DUE_DATE });

    expect(result.clearedLateMarks).toHaveLength(0);
    expect((await PlannedWork.findById(id))?.completedLate).toBe(true);
  });
});
