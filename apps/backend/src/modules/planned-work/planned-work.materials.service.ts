import type { PlannedWorkMaterialDto } from '@monhorus/shared';

import type { IPlannedWork } from './planned-work.models';

/**
 * The materials planned for a work.
 *
 * Requirements 19.2 fixes the V1 scope at "нэр/тоо": a material is a name, a quantity and
 * a unit typed on the work itself. There is no catalogue to join against and no stock
 * ledger to sum, so this is a projection of the embedded list rather than a query, and
 * planned-versus-actual is deliberately absent — nothing in V1 records an actual.
 */
export function plannedWorkMaterialsOf(
  work: Pick<IPlannedWork, 'plannedMaterials'>,
): PlannedWorkMaterialDto[] {
  return work.plannedMaterials
    .map((entry) => ({ name: entry.name, quantity: entry.quantity, unit: entry.unit }))
    .sort((left, right) => left.name.localeCompare(right.name, 'mn'));
}
