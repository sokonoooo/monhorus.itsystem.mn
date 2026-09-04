import type { ObjectStatus, RiskBand, RiskLevel } from '@monhorus/shared';

/**
 * What reaching a band DOES to the equipment, in one place, for every door.
 *
 * Rule 17.9 — a device in the band that takes equipment out of service must not remain in
 * active use — was enforced on exactly one of the four paths that write a score onto an
 * object. `recordAssessment` did it; `applyReportToEquipment`, which is where the
 * planned-work report, the service-request work report and a consolidated review all land,
 * wrote the identical denormalised head (`score`, `riskLevel`) and never touched `status`.
 *
 * So a panel scored into the black band through a planned-work report stayed ACTIVE. Its
 * kW went on counting toward the floor total, its reserve went on reading as headroom,
 * `assertRelatedObject` went on letting new circuits be wired to it, and the «Ашиглалтаас
 * гарсан» filter never listed it — while the SAME score entered on the manual assessment
 * screen retired it. Two doors, one rule, one of them locked.
 *
 * This module is the rule, extracted rather than copied: a second implementation of an
 * irreversible status write is a second place for it to drift, and the drift is what the
 * finding was. It depends on nothing but the band shape, so both `object-master.service`
 * (which imports the report store) and `report-record.service` (which imports the object
 * models) can call it without closing a cycle — the same constraint that put
 * `appendAssessmentHistory` in its own module.
 */

/** What the band ladder says about one resolved level. Null when nothing was banded. */
export function bandFor(
  riskLevel: RiskLevel | null,
  bands: readonly RiskBand[],
): RiskBand | null {
  if (!riskLevel) return null;
  return bands.find((entry) => entry.level === riskLevel) ?? null;
}

/** The status transition a band forced, for the caller's audit record. Null when none. */
export interface BandStatusChange {
  from: ObjectStatus;
  to: ObjectStatus;
}

/**
 * Applies the band's side effects to an object in memory. The caller saves.
 *
 * Only ACTIVE → DECOMMISSIONED, exactly as the manual path has always done. An object that
 * is already retired is left alone (the write is idempotent, so re-applying a report is
 * safe), and an INACTIVE one is not retired behind the operator's back: rule 17.9 speaks
 * about equipment "in active use", and a device already withdrawn from service is a
 * decision somebody made that a score should not silently overwrite.
 */
export function applyBandSideEffects(
  object: { status: ObjectStatus },
  band: RiskBand | null,
): BandStatusChange | null {
  if (!band?.decommissions) return null;
  if (object.status !== 'ACTIVE') return null;

  const from = object.status;
  object.status = 'DECOMMISSIONED';
  return { from, to: 'DECOMMISSIONED' };
}
