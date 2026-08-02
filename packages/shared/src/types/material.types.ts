import type { MaterialCategory, MaterialUnit } from '../constants/material';

/**
 * One row of the material catalogue.
 *
 * Staff master data, not tenant data: the company stocks one list of cable and breakers
 * and issues it to whichever customer's site the work is on, so a catalogue item has no
 * customer of its own. Tenancy is enforced where the material is USED — a usage row
 * belongs to a sub-task, and that sub-task's planned work names the customer.
 *
 * There is deliberately no quantity on hand. See the note in `constants/material.ts`:
 * without a warehouse system behind it, a balance here would be a number nobody maintains
 * and every availability check would be theatre.
 */
export interface MaterialItemDto {
  id: string;
  /** Short human reference, unique and upper-cased, e.g. `CBL-3X2.5`. */
  code: string;
  name: string;
  category: MaterialCategory;
  /** The unit a usage row defaults to. A row may still record a different one. */
  defaultUnit: MaterialUnit;
  description: string | null;
  /** Retired items stay readable so historic usage still resolves, but stop being offered. */
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * What was consumed doing one sub-task.
 *
 * Attached to the sub-task rather than to the parent planned work, because "which job
 * used the cable" is the question maintenance asks and a work-level total cannot answer
 * it. Kept strictly separate from the equipment a sub-task assesses: the objects are what
 * the visit was ABOUT, these are what it spent.
 */
export interface TaskMaterialUsageDto {
  id: string;
  taskId: string;
  plannedWorkId: string;
  materialItemId: string;
  /** Denormalised so a list renders without joining the catalogue. */
  materialCode: string;
  materialName: string;
  quantity: number;
  unit: MaterialUnit;
  note: string | null;
  usedByEmployeeId: string | null;
  usedByName: string | null;
  usedAt: string;
  recordedByName: string | null;
  createdAt: string;
  updatedAt: string;
}
