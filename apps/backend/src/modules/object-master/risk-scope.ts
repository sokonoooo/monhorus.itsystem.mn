import { OBJECT_STATUSES, type ObjectStatus } from '@monhorus/shared';

/**
 * Which objects a RISK figure is allowed to speak for.
 *
 * The load side of this question already had an answer — `countsTowardLoad`, rule 17.17 —
 * and the risk readers had none, so a piece of equipment could be out of the capacity
 * arithmetic and still be the thing deciding a floor's band. That is not a rounding
 * difference: rule 17.9 retires an object BECAUSE it scored worst, so the retirement
 * guaranteed that the worst score on the floor belonged to something no longer in use, and
 * pinned the floor, the building and the project at that band permanently. The assessment
 * rows are immutable, so the object cannot be deleted to clear it. `floorLoadSummary`
 * printed the contradiction inside a single response: `totalKw` excluded the retired panel
 * while the `riskCounts` beside it counted it.
 *
 * DELIBERATELY NOT `countsTowardLoad`. That predicate is `status === 'ACTIVE'`, which drops
 * `INACTIVE` as well, and the two questions genuinely differ:
 *
 *   - DECOMMISSIONED is a permanent retirement. The equipment is gone; the score is a fact
 *     about something that no longer exists in the estate, and a live risk figure that
 *     keeps reporting it is describing a building that is not there. Excluded.
 *   - INACTIVE is «Түр идэвхгүй» — temporarily out of use, coming back. It draws no power
 *     today, which is why the LOAD excludes it, but a critical fault on a panel that is
 *     about to be re-energised is exactly the finding an operator must not lose. Its
 *     condition is still a live question, so it is counted.
 *
 * Excluded OUTRIGHT rather than moved into a separate bucket, because there is nowhere
 * honest to put it: the DTOs carry per-band counts plus `unassessedCount`, and folding a
 * retired object into `unassessedCount` would say «үнэлгээ хийгээгүй» about the one thing
 * on the floor that WAS assessed. A floor whose only panel is retired therefore reports no
 * bands, nothing unassessed and no rollup — "there is nothing in service here", which is
 * true — rather than either "never assessed" or "critical".
 */
export function countsTowardRisk(status: ObjectStatus): boolean {
  return status !== 'DECOMMISSIONED';
}

/** The statuses the predicate above rejects, derived from it rather than restated. */
export const RISK_EXCLUDED_STATUSES: readonly ObjectStatus[] = OBJECT_STATUSES.filter(
  (status) => !countsTowardRisk(status),
);

/**
 * The same predicate as a query fragment, for the aggregations and counts that cannot run
 * a function per document.
 *
 * `$nin` rather than `$in`, so a document written before `status` existed — or by a fixture
 * that leaves it to the schema default — is INCLUDED. An `$in` list would silently drop
 * every such row from the risk figures, which is the failure mode this module exists to
 * remove rather than to reproduce.
 */
export const riskScopeFilter = {
  status: { $nin: [...RISK_EXCLUDED_STATUSES] },
} as const;
