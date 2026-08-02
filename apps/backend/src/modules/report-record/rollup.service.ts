import { riskLevelFor, type ReportRollupDto, type RiskLevel } from '@monhorus/shared';
import { Types } from 'mongoose';

import { ObjectRecord } from '../object-master/object-master.models';
import { ObjectNode } from '../objects/object.models';
import { getRiskBands } from '../settings/settings.service';

/**
 * Worst-case rollup up the hierarchy.
 *
 * A floor, building or project carries the score of the worst assessed piece of equipment
 * beneath it, and the band that score falls into. Averaging was the alternative and is
 * exactly what would let one dead panel disappear behind nine sound ones: a floor with a
 * critical fault is not ninety percent healthy. Requirements 19.2 left the method open —
 * this is the choice, and it is stated once here rather than reinvented per screen.
 *
 * The counts travel with the figure because "42, and eleven of the fourteen panels have
 * never been looked at" is a different statement from "42", and one number cannot say
 * both. A node with nothing assessed beneath it gets null, never zero: unassessed is not
 * the same as bad, and scoring it zero would put every empty floor at the top of a
 * critical-risk queue.
 */

/** Equipment hangs off a floor, so a floor is the only level that reads equipment directly. */
interface FloorFigures {
  score: number | null;
  worstObject: Types.ObjectId | null;
  assessedCount: number;
  unassessedCount: number;
}

async function floorFiguresFor(floorIds: readonly Types.ObjectId[]): Promise<Map<string, FloorFigures>> {
  const figures = new Map<string, FloorFigures>();
  if (floorIds.length === 0) return figures;

  const rows = await ObjectRecord.aggregate<{
    _id: Types.ObjectId;
    score: number | null;
    worstObject: Types.ObjectId | null;
    assessedCount: number;
    total: number;
  }>([
    { $match: { floor: { $in: [...floorIds] } } },
    // Worst first, so the head of each group is the equipment that decides the floor.
    // Unassessed rows sort last rather than being dropped: they are still counted. That
    // needs a computed rank, because ascending Mongo puts a missing score AHEAD of every
    // number and an untouched panel would masquerade as the worst on the floor.
    { $addFields: { sortScore: { $ifNull: ['$latestAssessment.score', 101] } } },
    { $sort: { sortScore: 1 } },
    {
      $group: {
        _id: '$floor',
        score: { $first: '$latestAssessment.score' },
        worstObject: { $first: '$_id' },
        assessedCount: {
          $sum: { $cond: [{ $ifNull: ['$latestAssessment.score', false] }, 1, 0] },
        },
        total: { $sum: 1 },
      },
    },
  ]);

  for (const row of rows) {
    const assessed = row.assessedCount;
    figures.set(String(row._id), {
      // `$first` only names the worst equipment when something was actually assessed;
      // with none, the head of the group is simply the first unassessed row.
      score: assessed > 0 ? (row.score ?? null) : null,
      worstObject: assessed > 0 ? row.worstObject : null,
      assessedCount: assessed,
      unassessedCount: row.total - assessed,
    });
  }

  return figures;
}

/**
 * Recomputes a node and every ancestor above it.
 *
 * A score is stored and a band never is: the thresholds are a configurable setting, so a
 * stored band would go on describing a score by rules that no longer apply. Banding
 * happens on read, in `rollupOf`.
 *
 * Walking up from the floor rather than recomputing the whole tree: an assessment changes
 * exactly one chain, and rebuilding every project on every assessment would make a routine
 * write cost the size of the installation. Each level is derived from the floors beneath
 * it rather than from the level below, so a missed intermediate write cannot compound into
 * a wrong figure further up.
 */
export async function recalculateFrom(floorId: Types.ObjectId | null): Promise<void> {
  if (!floorId) return;

  const floor = await ObjectNode.findById(floorId).select('_id ancestors');
  if (!floor) return;

  const now = new Date();

  // The chain to refresh: the floor itself and every ancestor, which for a floor is its
  // building, project and customer node.
  const chain = [floor._id, ...floor.ancestors];

  for (const nodeId of chain) {
    const isFloor = String(nodeId) === String(floor._id);

    const floorIds = isFloor
      ? [nodeId]
      : (
          await ObjectNode.find({ kind: 'FLOOR', ancestors: nodeId }).select('_id')
        ).map((node) => node._id);

    const figures = await floorFiguresFor(floorIds);

    let score: number | null = null;
    let worstObject: Types.ObjectId | null = null;
    let assessedCount = 0;
    let unassessedCount = 0;

    for (const entry of figures.values()) {
      assessedCount += entry.assessedCount;
      unassessedCount += entry.unassessedCount;
      if (entry.score === null) continue;
      if (score === null || entry.score < score) {
        score = entry.score;
        worstObject = entry.worstObject;
      }
    }

    await ObjectNode.updateOne(
      { _id: nodeId },
      {
        $set: {
          rollup:
            score !== null && worstObject
              ? { score, worstObject, assessedCount, unassessedCount, calculatedAt: now }
              : null,
        },
      },
    );
  }
}

/** The stored figure, banded against the thresholds in force right now. */
export async function rollupOf(nodeId: Types.ObjectId): Promise<ReportRollupDto> {
  const node = await ObjectNode.findById(nodeId)
    .select('rollup')
    .populate({ path: 'rollup.worstObject', select: 'name' });

  const rollup = node?.rollup ?? null;
  if (!rollup) {
    return {
      score: null,
      riskLevel: null,
      assessedCount: 0,
      unassessedCount: 0,
      worstObjectId: null,
      worstObjectName: null,
      calculatedAt: null,
    };
  }

  const bands = await getRiskBands();
  const worst = rollup.worstObject as unknown as { _id: Types.ObjectId; name?: string } | null;

  return {
    score: rollup.score,
    // Banded on read, never stored: the thresholds are a setting, so a stored band would
    // keep describing a score by rules that no longer apply.
    riskLevel: riskLevelFor(rollup.score, bands) as RiskLevel,
    assessedCount: rollup.assessedCount,
    unassessedCount: rollup.unassessedCount,
    worstObjectId: worst ? String(worst._id) : null,
    worstObjectName: worst?.name ?? null,
    calculatedAt: rollup.calculatedAt.toISOString(),
  };
}
