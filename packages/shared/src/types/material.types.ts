import type { MaterialCategory, MaterialUnit } from '../constants/material';

/**
 * One row of the material catalogue.
 *
 * Staff master data, not tenant data: the company stocks one list of cable and breakers
 * and issues it to whichever customer's site the work is on, so a catalogue item has no
 * customer of its own.
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
  /** The unit a picker starts on, so a metre of cable is not entered as pieces. */
  defaultUnit: MaterialUnit;
  description: string | null;
  /** Retired items stay readable so historic references resolve, but stop being offered. */
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
