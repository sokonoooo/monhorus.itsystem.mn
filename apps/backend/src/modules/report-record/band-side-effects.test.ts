import { DEFAULT_RISK_BANDS, SETTING_KEYS, type RiskBandConfig } from '@monhorus/shared';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createObjectFixture,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
  type ObjectFixture,
} from '../../test/helpers';
import { AuditLog } from '../audit/audit-log.model';
import { ObjectRecord, ObjectType } from '../object-master/object-master.models';
import { Setting } from '../settings/setting.model';
import { invalidateSettingsCache } from '../settings/settings.service';
import { applyReportToEquipment, writeReport } from './report-record.service';

/**
 * Rule 17.9, on the door it was never fitted to.
 *
 * A score reaches a piece of equipment through one of four producers. The manual
 * assessment screen retired a black-band object; `applyReportToEquipment` — where the
 * planned-work report, the service-request work report and a consolidated review all land
 * — wrote the identical `score` and `riskLevel` and never touched `status`. So the same
 * finding, entered on a job sheet instead of on the assessment drawer, left the panel
 * ACTIVE: its kW still in the floor total, its reserve still reading as headroom, still
 * offered as a panel to wire new circuits to, and never listed under «Ашиглалтаас гарсан».
 *
 * These go through `writeReport` + `applyReportToEquipment` directly rather than through a
 * planned-work HTTP flow, because that pair IS the shared path — `planned-work.report.
 * service`, `planned-work.transition.service`, `work-report.service` and
 * `consolidation.service` all reach equipment through no other route.
 */

let objects: ObjectFixture;

async function storeBands(bands: readonly RiskBandConfig[]): Promise<void> {
  await Setting.updateOne(
    { key: SETTING_KEYS.EVAL_RISK_BANDS },
    { $set: { value: bands, updatedBy: null, updatedByName: 'test' } },
    { upsert: true },
  );
  invalidateSettingsCache();
}

let objectSequence = 0;

async function panel(status: 'ACTIVE' | 'INACTIVE' | 'DECOMMISSIONED' = 'ACTIVE') {
  objectSequence += 1;
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

  return ObjectRecord.create({
    code: `DB-${objectSequence}`,
    name: `Түгээх самбар ${objectSequence}`,
    category: 'PANEL',
    objectType: type._id,
    customer: new Types.ObjectId(objects.customerId),
    floor: new Types.ObjectId(objects.floorId),
    status,
    panel: { capacityKw: 25, location: null, protection: null },
  });
}

/** A planned-work report carrying one scored finding, published and applied. */
async function applyPlannedWorkScore(
  objectId: Types.ObjectId,
  score: number,
): Promise<void> {
  const report = await writeReport({
    type: 'PLANNED_WORK',
    status: 'APPROVED',
    title: 'Төлөвлөгөөт ажлын тайлан',
    sourceType: 'PLANNED_WORK',
    sourceId: new Types.ObjectId(),
    sourceReference: 'PW-0001',
    items: [{ object: objectId, score, observation: 'Тусгаарлагч шатсан.' }],
    actor: { id: null, name: 'Б. Энхтөр' },
    occurredAt: new Date('2026-08-01T00:00:00.000Z'),
  });
  await applyReportToEquipment(report._id);
}

beforeAll(async () => {
  await startTestApp();
}, 60_000);

afterAll(async () => {
  await stopTestApp();
});

beforeEach(async () => {
  await resetDomainCollections();
  invalidateSettingsCache();
  objects = await createObjectFixture();
});

describe('band side effects on the shared report write path', () => {
  it('decommissions a panel scored into the black band through a planned-work report', async () => {
    const object = await panel();

    await applyPlannedWorkScore(object._id, 5);

    const reloaded = await ObjectRecord.findById(object._id);
    expect(reloaded?.latestAssessment?.score).toBe(5);
    expect(reloaded?.latestAssessment?.riskLevel).toBe('OUT_OF_SERVICE');
    // The head moved before this fix; the status did not.
    expect(reloaded?.status).toBe('DECOMMISSIONED');
  });

  it('leaves a panel in service when the band does not decommission', async () => {
    const object = await panel();

    // Red, not black: `decommissions` is false on the shipped CRITICAL band.
    await applyPlannedWorkScore(object._id, 30);

    const reloaded = await ObjectRecord.findById(object._id);
    expect(reloaded?.latestAssessment?.riskLevel).toBe('CRITICAL');
    expect(reloaded?.status).toBe('ACTIVE');
  });

  /**
   * The flag, not the name — the same rule `object-master.service` and `project.service`
   * already follow. An operator who reorganised the ladder around three bands gets the
   * retirement on the band they marked, not on the band that happens to be called
   * OUT_OF_SERVICE.
   */
  it('follows the band flag rather than the band name', async () => {
    await storeBands([
      { ...DEFAULT_RISK_BANDS[0]!, key: 'SCHEDULE_REPAIR', minScore: 0, decommissions: true },
      { ...DEFAULT_RISK_BANDS[4]!, key: 'NORMAL', minScore: 41, decommissions: false },
    ]);
    const object = await panel();

    await applyPlannedWorkScore(object._id, 5);

    const reloaded = await ObjectRecord.findById(object._id);
    expect(reloaded?.latestAssessment?.riskLevel).toBe('SCHEDULE_REPAIR');
    expect(reloaded?.status).toBe('DECOMMISSIONED');
  });

  /**
   * Only ACTIVE → DECOMMISSIONED, exactly as the manual path has always behaved. A device
   * somebody deliberately parked as «Түр идэвхгүй» is a decision, not a default, and a
   * score arriving from a job sheet should not quietly convert it into a retirement.
   */
  it('does not retire an object that was already out of active use', async () => {
    const object = await panel('INACTIVE');

    await applyPlannedWorkScore(object._id, 5);

    expect((await ObjectRecord.findById(object._id))?.status).toBe('INACTIVE');
  });

  it('is idempotent when a corrected report is re-applied', async () => {
    const object = await panel();

    await applyPlannedWorkScore(object._id, 5);
    await applyPlannedWorkScore(object._id, 5);

    expect((await ObjectRecord.findById(object._id))?.status).toBe('DECOMMISSIONED');
    expect(
      await AuditLog.countDocuments({ entityId: object._id, action: 'StatusChanged' }),
    ).toBe(1);
  });

  it('records the retirement in the audit log with the report that caused it', async () => {
    const object = await panel();

    await applyPlannedWorkScore(object._id, 5);

    const entry = await AuditLog.findOne({ entityId: object._id, action: 'StatusChanged' });
    expect(entry).not.toBeNull();
    expect(entry?.reason).toContain('decommissions');
    expect(entry?.oldValue).toMatchObject({ status: 'ACTIVE' });
    expect(entry?.newValue).toMatchObject({ status: 'DECOMMISSIONED' });
  });
});
