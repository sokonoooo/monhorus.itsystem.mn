import { MATERIAL_CATEGORIES, MATERIAL_UNITS, type MaterialCategory, type MaterialUnit } from '@monhorus/shared';
import { Schema, Types, model, type Model } from 'mongoose';

/**
 * The material catalogue, and what each sub-task consumed from it.
 *
 * Requirements 19.2 fixed V1 at "нэр/тоо" — a material was a name typed freehand onto the
 * parent planned work. That could never be reported on: the same item typed six ways is
 * six materials, and a total across jobs was impossible. A catalogue sits behind the name
 * now, and usage is recorded per SUB-TASK rather than per work, because "which job used
 * the cable" is the question maintenance asks and a work-level total cannot answer it.
 *
 * There are still no stock balances. Nothing here models quantity on hand, and no usage
 * row is ever refused for want of it: without a warehouse system behind it a balance would
 * be a number nobody maintains, and an availability check against it would be theatre.
 * Warehouse integration remains the later phase 19.2 describes.
 */

// -- Catalogue ---------------------------------------------------------------

export interface IMaterialItem {
  code: string;
  name: string;
  category: MaterialCategory;
  /** What a usage row defaults to. A row may still record a different unit. */
  defaultUnit: MaterialUnit;
  description: string | null;
  /** Retired items stay readable so historic usage resolves, but stop being offered. */
  isActive: boolean;
  createdBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Staff master data, with no customer field — deliberately.
 *
 * The company stocks one list of cable and breakers and issues it to whichever customer's
 * site the work is on, exactly as ObjectType is one catalogue for every tenant. Tenancy is
 * enforced where a material is USED: a usage row belongs to a sub-task, and that sub-task's
 * planned work names the customer.
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

// -- Usage -------------------------------------------------------------------

export interface ITaskMaterialUsage {
  task: Types.ObjectId;
  /**
   * Denormalised from the sub-task.
   *
   * Carried so the work's total, and the tenant predicate, are one query rather than a
   * join through every sub-task. It is written from the loaded sub-task and never accepted
   * from a caller, so it cannot disagree with the parent.
   */
  plannedWork: Types.ObjectId;
  customer: Types.ObjectId | null;

  materialItem: Types.ObjectId;
  /** Snapshotted so a list renders without joining, and history survives a rename. */
  materialCode: string;
  materialName: string;

  quantity: number;
  unit: MaterialUnit;
  note: string | null;

  usedByEmployee: Types.ObjectId | null;
  usedByName: string | null;
  usedAt: Date;

  recordedBy: Types.ObjectId | null;
  recordedByName: string | null;

  createdAt: Date;
  updatedAt: Date;
}

const taskMaterialUsageSchema = new Schema<ITaskMaterialUsage>(
  {
    task: { type: Schema.Types.ObjectId, ref: 'PlannedWorkTask', required: true, index: true },
    plannedWork: { type: Schema.Types.ObjectId, ref: 'PlannedWork', required: true, index: true },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', default: null, index: true },

    materialItem: { type: Schema.Types.ObjectId, ref: 'MaterialItem', required: true, index: true },
    materialCode: { type: String, required: true },
    materialName: { type: String, required: true },

    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, enum: MATERIAL_UNITS, required: true, default: 'PIECE' },
    note: { type: String, default: null, trim: true, maxlength: 1000 },

    usedByEmployee: { type: Schema.Types.ObjectId, ref: 'Employee', default: null, index: true },
    usedByName: { type: String, default: null },
    usedAt: { type: Date, required: true, index: true },

    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    recordedByName: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);

/**
 * DELIBERATELY NOT UNIQUE on `{task, materialItem}`.
 *
 * The same material legitimately appears twice on one sub-task — two spools used on
 * different days, or by different people — and each is its own row with its own date and
 * user. Collapsing them would lose that, and it is not the duplicate protection this
 * feature needs: a report item is one per object because a finding is a statement, while a
 * usage row is an event.
 */
taskMaterialUsageSchema.index({ task: 1, createdAt: 1 });
// The work-level roll-up, which sums every sub-task's rows.
taskMaterialUsageSchema.index({ plannedWork: 1, materialItem: 1 });

export const TaskMaterialUsage: Model<ITaskMaterialUsage> = model<ITaskMaterialUsage>(
  'TaskMaterialUsage',
  taskMaterialUsageSchema,
);
