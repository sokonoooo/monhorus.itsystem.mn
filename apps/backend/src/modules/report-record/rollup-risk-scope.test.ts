import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ResolvedCustomerScope } from '../../common/security/customer-scope';
import {
  createObjectFixture,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
  type ObjectFixture,
} from '../../test/helpers';
import { floorLoadSummary } from '../object-master/load.service';
import { ObjectRecord, ObjectType } from '../object-master/object-master.models';
import { recalculateFrom, rollupOf } from './rollup.service';

/** A staff caller: no tenant predicate, which is what the summary is normally read with. */
const STAFF_SCOPE: ResolvedCustomerScope = { mode: 'STAFF' };

/**
 * What a risk figure is allowed to speak for.
 *
 * `countsTowardLoad` has excluded a decommissioned object from the capacity arithmetic
 * since rule 17.17; the four risk readers excluded nothing. The combination is worse than
 * either half, because rule 17.9 retires an object precisely BECAUSE it scored worst — so
 * the retirement guaranteed that the worst score on the floor belonged to something no
 * longer in service, and pinned the floor, its building and its project at that band. The
 * assessment rows are immutable, so the object could not be deleted to clear it.
 */

let objects: ObjectFixture;
let sequence = 0;

async function panelType(): Promise<Types.ObjectId> {
  const type =
    (await ObjectType.findOne({ code: 'DB' })) ??
    (await ObjectType.create({
      code: 'DB',
      name: 'Түгээх самбар',
      category: 'PANEL',
      showOnPlan: false,
      insidePanel: false,
      generatesConclusion: true,
      icon: 'PANEL',
      isActive: true,
    }));
  return type._id;
}

async function scoredPanel(options: {
  score: number | null;
  riskLevel?: string | null;
  status?: 'ACTIVE' | 'INACTIVE' | 'DECOMMISSIONED';
}): Promise<Types.ObjectId> {
  sequence += 1;
  const object = await ObjectRecord.create({
    code: `DB-${sequence}`,
    name: `Түгээх самбар ${sequence}`,
    category: 'PANEL',
    objectType: await panelType(),
    customer: new Types.ObjectId(objects.customerId),
    floor: new Types.ObjectId(objects.floorId),
    status: options.status ?? 'ACTIVE',
    panel: { capacityKw: 25, location: null, protection: null },
    latestAssessment:
      options.score === null
        ? null
        : {
            assessment: new Types.ObjectId(),
            score: options.score,
            riskLevel: options.riskLevel ?? 'OUT_OF_SERVICE',
            assessedAt: new Date('2026-08-01T00:00:00.000Z'),
          },
  });
  return object._id;
}

async function floorRollup() {
  await recalculateFrom(new Types.ObjectId(objects.floorId));
  return rollupOf(new Types.ObjectId(objects.floorId));
}

beforeAll(async () => {
  await startTestApp();
}, 60_000);

afterAll(async () => {
  await stopTestApp();
});

beforeEach(async () => {
  await resetDomainCollections();
  objects = await createObjectFixture();
});

describe('decommissioned equipment in the risk figures', () => {
  it('stops pinning its floor at the band it was retired for', async () => {
    const sound = await scoredPanel({ score: 90, riskLevel: 'NORMAL' });
    await scoredPanel({ score: 5, riskLevel: 'OUT_OF_SERVICE', status: 'DECOMMISSIONED' });

    const rollup = await floorRollup();

    expect(rollup.score).toBe(90);
    expect(rollup.riskLevel).toBe('NORMAL');
    expect(rollup.worstObjectId).toBe(String(sound));
    expect(rollup.assessedCount).toBe(1);
    expect(rollup.unassessedCount).toBe(0);
  });

  it('carries the exclusion up to the building and the project', async () => {
    await scoredPanel({ score: 90, riskLevel: 'NORMAL' });
    await scoredPanel({ score: 5, riskLevel: 'OUT_OF_SERVICE', status: 'DECOMMISSIONED' });
    await recalculateFrom(new Types.ObjectId(objects.floorId));

    expect((await rollupOf(new Types.ObjectId(objects.buildingId))).score).toBe(90);
    expect((await rollupOf(new Types.ObjectId(objects.projectId))).score).toBe(90);
  });

  /**
   * The judgement written down.
   *
   * Excluded OUTRIGHT, not folded into `unassessedCount`: there is nowhere honest to put a
   * retired object on a DTO that carries per-band counts plus "never assessed", and calling
   * the one panel that WAS assessed «үнэлгээ хийгээгүй» would be a second wrong answer. A
   * floor of nothing but retired equipment reports no bands, nothing unassessed and no
   * rollup — "there is nothing in service here".
   */
  it('reports a floor of nothing but retired equipment as empty, not as unassessed', async () => {
    await scoredPanel({ score: 5, riskLevel: 'OUT_OF_SERVICE', status: 'DECOMMISSIONED' });

    const rollup = await floorRollup();

    expect(rollup.score).toBeNull();
    expect(rollup.riskLevel).toBeNull();
    expect(rollup.assessedCount).toBe(0);
    expect(rollup.unassessedCount).toBe(0);
  });

  /**
   * INACTIVE is NOT excluded, even though `countsTowardLoad` drops it.
   *
   * «Түр идэвхгүй» is temporary: the device draws no power today, which is why the load
   * excludes it, but a critical fault on a panel that is about to be re-energised is
   * exactly the finding an operator must not lose.
   */
  it('still counts a temporarily inactive object, which the load figures do not', async () => {
    await scoredPanel({ score: 90, riskLevel: 'NORMAL' });
    const parked = await scoredPanel({ score: 30, riskLevel: 'CRITICAL', status: 'INACTIVE' });

    const rollup = await floorRollup();

    expect(rollup.score).toBe(30);
    expect(rollup.worstObjectId).toBe(String(parked));
  });

  /** The contradiction the audit found inside a single response. */
  it('keeps the floor summary from counting a band it declines to draw load from', async () => {
    await scoredPanel({ score: 90, riskLevel: 'NORMAL' });
    await scoredPanel({ score: 5, riskLevel: 'OUT_OF_SERVICE', status: 'DECOMMISSIONED' });

    const summary = await floorLoadSummary(new Types.ObjectId(objects.floorId), STAFF_SCOPE);

    expect(summary.riskCounts).toEqual([{ level: 'NORMAL', count: 1 }]);
    expect(summary.unassessedCount).toBe(0);
    // The inventory count is not a risk figure: the panel is still registered on the floor.
    expect(summary.panelCount).toBe(2);
  });
});

/**
 * A score of zero is a score.
 *
 * `assessedCount` was summed with `$cond: [$ifNull(score, false), 1, 0]`, and 0 is falsy in
 * `$cond` — so the worst possible assessment counted as no assessment at all. The floor
 * stored no rollup and rendered as «үнэлгээ хийгээгүй» for a panel that had just been
 * scored zero.
 *
 * Written on an INACTIVE panel on purpose: under the shipped ladder a score of 0 lands in
 * the band that retires equipment, and rule 17.9 only converts an ACTIVE object, so this is
 * the state in which a zero survives to be counted.
 */
describe('a score of zero on the roll-up', () => {
  it('is an assessment, not a blank', async () => {
    const zeroed = await scoredPanel({
      score: 0,
      riskLevel: 'OUT_OF_SERVICE',
      status: 'INACTIVE',
    });

    const rollup = await floorRollup();

    expect(rollup.score).toBe(0);
    expect(rollup.riskLevel).toBe('OUT_OF_SERVICE');
    expect(rollup.worstObjectId).toBe(String(zeroed));
    expect(rollup.assessedCount).toBe(1);
    expect(rollup.unassessedCount).toBe(0);
  });

  it('does not swell the unassessed count beside a genuinely untouched panel', async () => {
    await scoredPanel({ score: 0, riskLevel: 'OUT_OF_SERVICE', status: 'INACTIVE' });
    await scoredPanel({ score: null });

    const rollup = await floorRollup();

    expect(rollup.assessedCount).toBe(1);
    expect(rollup.unassessedCount).toBe(1);
  });
});
