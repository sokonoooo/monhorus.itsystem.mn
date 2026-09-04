import { DEFAULT_RISK_BANDS, SETTING_KEYS, type RiskBandConfig, type RiskLevel } from '@monhorus/shared';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createObjectFixture,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
  type ObjectFixture,
} from '../../test/helpers';
import { ObjectRecord } from '../object-master/object-master.models';
import { Setting } from '../settings/setting.model';
import { invalidateSettingsCache } from '../settings/settings.service';
import { riskSummariesFor } from './project.service';

/**
 * The danger marker on a risk roll-up.
 *
 * `hasCritical` used to be `counts.get('CRITICAL') || counts.get('OUT_OF_SERVICE')` — two
 * band NAMES, in a module whose configuration exists precisely so a band can be renamed.
 * These exercise the roll-up against a reconfigured ladder, which is the only way to tell
 * a rule that follows the meaning from one that follows the word.
 */

let objects: ObjectFixture;

/** Writes a ladder straight into the collection, as an administrator's saved edit would. */
async function storeBands(bands: readonly RiskBandConfig[]): Promise<void> {
  await Setting.updateOne(
    { key: SETTING_KEYS.EVAL_RISK_BANDS },
    { $set: { value: bands, updatedBy: null, updatedByName: 'test' } },
    { upsert: true },
  );
  invalidateSettingsCache();
}

let objectSequence = 0;

async function assessedObject(
  level: RiskLevel,
  score: number,
  status: 'ACTIVE' | 'INACTIVE' | 'DECOMMISSIONED' = 'ACTIVE',
): Promise<void> {
  objectSequence += 1;
  await ObjectRecord.create({
    code: `OBJ-${objectSequence}`,
    name: `Самбар ${objectSequence}`,
    category: 'PANEL',
    objectType: new Types.ObjectId(),
    customer: objects.customerId,
    floor: objects.floorId,
    status,
    latestAssessment: {
      assessment: new Types.ObjectId(),
      score,
      riskLevel: level,
      assessedAt: new Date('2026-08-01T00:00:00.000Z'),
    },
  });
}

async function summaryOfProject(): Promise<{ hasCritical: boolean; unassessedCount: number }> {
  const summaries = await riskSummariesFor([new Types.ObjectId(objects.projectId)], 'SUBTREE');
  const summary = summaries.get(objects.projectId);
  expect(summary).toBeDefined();
  return summary!;
}

beforeAll(async () => {
  await startTestApp();
}, 60_000);

afterAll(async () => {
  await stopTestApp();
});

beforeEach(async () => {
  await resetDomainCollections();
  // The resolved settings map is cached in process; wiping the collection behind it would
  // leave the previous case's ladder in force.
  invalidateSettingsCache();
  objects = await createObjectFixture();
});

describe('the danger marker on a risk roll-up', () => {
  it('is unchanged on an installation that has configured nothing', async () => {
    await assessedObject('NORMAL', 95);
    await assessedObject('ATTENTION', 70);
    expect((await summaryOfProject()).hasCritical).toBe(false);

    await assessedObject('CRITICAL', 30);
    expect((await summaryOfProject()).hasCritical).toBe(true);
  });

  it('still fires for the band that takes equipment out of service', async () => {
    await assessedObject('OUT_OF_SERVICE', 5);
    expect((await summaryOfProject()).hasCritical).toBe(true);
  });

  it('counts an unassessed object without raising the marker', async () => {
    objectSequence += 1;
    await ObjectRecord.create({
      code: `OBJ-${objectSequence}`,
      name: 'Үнэлгээгүй',
      category: 'PANEL',
      objectType: new Types.ObjectId(),
      customer: objects.customerId,
      floor: objects.floorId,
    });

    const summary = await summaryOfProject();
    expect(summary.unassessedCount).toBe(1);
    expect(summary.hasCritical).toBe(false);
  });

  /**
   * The P1. The ladder here drops `CRITICAL` and `OUT_OF_SERVICE` entirely and makes
   * `SCHEDULE_REPAIR` the band that demands a conclusion and decommissions — an operator
   * who reorganised their ladder around three bands. The name-matching version answers
   * false here, so the marker goes silent across web, both apps, and the sorting and
   * filtering built on it, for equipment that is being taken out of service.
   */
  it('follows the band FLAGS, not the two band names it used to match on', async () => {
    await storeBands([
      {
        key: 'SCHEDULE_REPAIR',
        label: 'Ашиглахыг хориглоно',
        colour: 'black',
        minScore: 0,
        requiresConclusion: true,
        requiresRecommendation: true,
        decommissions: true,
        notifies: true,
      },
      {
        key: 'ATTENTION',
        label: 'Анхаарах',
        colour: 'yellow',
        minScore: 41,
        requiresConclusion: false,
        requiresRecommendation: true,
        decommissions: false,
        notifies: true,
      },
      {
        key: 'NORMAL',
        label: 'Хэвийн',
        colour: 'green',
        minScore: 81,
        requiresConclusion: false,
        requiresRecommendation: false,
        decommissions: false,
        notifies: false,
      },
    ]);

    await assessedObject('ATTENTION', 60);
    expect((await summaryOfProject()).hasCritical).toBe(false);

    await assessedObject('SCHEDULE_REPAIR', 10);
    expect((await summaryOfProject()).hasCritical).toBe(true);
  });

  /**
   * The mirror image: a band NAMED `CRITICAL` that the administrator has demoted to a
   * routine one must stop raising the marker, or the name is still what decides.
   */
  it('stops firing for a band the administrator demoted', async () => {
    await storeBands(
      DEFAULT_RISK_BANDS.filter((band) => band.key !== 'OUT_OF_SERVICE').map((band) =>
        band.key === 'CRITICAL'
          ? {
              ...band,
              minScore: 0,
              requiresConclusion: false,
              requiresRecommendation: true,
              decommissions: false,
            }
          : band,
      ),
    );

    await assessedObject('CRITICAL', 10);
    expect((await summaryOfProject()).hasCritical).toBe(false);
  });
});

/**
 * Retired equipment on the same roll-up.
 *
 * `countsTowardLoad` has kept a decommissioned object out of the capacity arithmetic since
 * rule 17.17; this reader kept it in. Rule 17.9 retires an object BECAUSE it scored worst,
 * so the marker it raised was raised by the retirement itself — permanently, since the
 * immutable assessment rows mean the object can never be deleted to clear it.
 */
describe('decommissioned equipment on a risk roll-up', () => {
  it('neither raises the danger marker nor appears in the band counts', async () => {
    await assessedObject('NORMAL', 95);
    await assessedObject('OUT_OF_SERVICE', 5, 'DECOMMISSIONED');

    const summaries = await riskSummariesFor([new Types.ObjectId(objects.projectId)], 'SUBTREE');
    const summary = summaries.get(objects.projectId)!;

    expect(summary.hasCritical).toBe(false);
    expect(summary.counts).toEqual([{ level: 'NORMAL', count: 1 }]);
  });

  /**
   * Excluded outright, not reclassified. Counting it as «үнэлгээ хийгээгүй» would say
   * "never assessed" about the one object on the floor that was.
   */
  it('is not folded into the unassessed count', async () => {
    await assessedObject('OUT_OF_SERVICE', 5, 'DECOMMISSIONED');

    const summary = await summaryOfProject();

    expect(summary.unassessedCount).toBe(0);
    expect(summary.hasCritical).toBe(false);
  });

  /**
   * INACTIVE stays. «Түр идэвхгүй» is temporary, so the fault is still a live question
   * even though the device draws no power — which is why this predicate is deliberately
   * wider than `countsTowardLoad`. See `object-master/risk-scope.ts`.
   */
  it('still counts a temporarily inactive object', async () => {
    await assessedObject('CRITICAL', 30, 'INACTIVE');

    expect((await summaryOfProject()).hasCritical).toBe(true);
  });
});
