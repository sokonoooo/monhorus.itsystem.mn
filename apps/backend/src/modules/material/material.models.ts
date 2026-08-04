import { MATERIAL_CATEGORIES, MATERIAL_UNITS, type MaterialCategory, type MaterialUnit } from '@monhorus/shared';
import { Schema, Types, model, type Model } from 'mongoose';

/**
 * The material catalogue.
 *
 * Requirements 19.2 fixed V1 at "нэр/тоо" — a material planned for a work is a name and a
 * quantity typed onto the work itself (`PlannedWork.plannedMaterials`). This catalogue is
 * the reference list behind those names, so the same item is not spelled six ways.
 *
 * There are no stock balances. Nothing here models quantity on hand: without a warehouse
 * system behind it a balance would be a number nobody maintains, and an availability check
 * against it would be theatre. Warehouse integration remains the later phase 19.2
 * describes.
 */

export interface IMaterialItem {
  code: string;
  name: string;
  category: MaterialCategory;
  /** What a picker starts a quantity on, so a metre of cable is not entered as pieces. */
  defaultUnit: MaterialUnit;
  description: string | null;
  /** Retired items stay readable so historic references resolve, but stop being offered. */
  isActive: boolean;
  createdBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Staff master data, with no customer field — deliberately.
 *
 * The company stocks one list of cable and breakers and issues it to whichever customer's
 * site the work is on, exactly as ObjectType is one catalogue for every tenant.
 */
const materialItemSchema = new Schema<IMaterialItem>(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      maxlength: 32,
    },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    category: { type: String, enum: MATERIAL_CATEGORIES, required: true, index: true },
    defaultUnit: { type: String, enum: MATERIAL_UNITS, required: true, default: 'PIECE' },
    description: { type: String, default: null, trim: true, maxlength: 1000 },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, versionKey: false },
);

// The picker's default read: what is still offered, grouped, alphabetical.
materialItemSchema.index({ isActive: 1, category: 1, code: 1 });
materialItemSchema.index({ name: 'text', code: 'text' });

export const MaterialItem: Model<IMaterialItem> = model<IMaterialItem>(
  'MaterialItem',
  materialItemSchema,
);
