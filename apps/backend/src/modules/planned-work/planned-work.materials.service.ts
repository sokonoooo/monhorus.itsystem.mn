import type { PlannedWorkMaterialDto } from '@monhorus/shared';

import type { IPlannedWork } from './planned-work.models';

/**
 * The materials registered on a work, with what its sub-tasks have drawn against them.
 *
 * Still a projection rather than a query: the running totals live on the work's own
 * embedded rows, because that is where the over-consumption guard has to be able to move
 * them atomically. Summing the usage ledger here instead would be a second opinion about
 * a figure the guard already owns, and the two could disagree.
 *
 * `remainingQuantity` is passed through rather than recomputed as `quantity - consumed`
 * for the same reason — one authority per number.
 */
export function plannedWorkMaterialsOf(
  work: Pick<IPlannedWork, 'plannedMaterials'>,
): PlannedWorkMaterialDto[] {
  return work.plannedMaterials
    .map((entry) => ({
      materialItemId: String(entry.materialItem),
      name: entry.name,
      quantity: entry.quantity,
      consumedQuantity: entry.consumedQuantity,
      remainingQuantity: entry.remainingQuantity,
      unit: entry.unit,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'mn'));
}
