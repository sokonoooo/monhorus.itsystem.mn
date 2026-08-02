import {
  OBJECT_CATEGORIES,
  OBJECT_ICONS,
  OBJECT_STATUSES,
  RISK_LEVELS,
  type ObjectCategory,
  type ObjectIcon,
  type ObjectStatus,
  type RiskLevel,
} from '@monhorus/shared';
import { Schema, Types, model, type Model } from 'mongoose';

/**
 * Object master data (requirements 4.1 and 4.2).
 *
 * These live in their own module. A Floor references an Object; it never copies one, and
 * deleting a floor link leaves the Object intact in the master list.
 */

// -- Section 4.1 type registry ----------------------------------------------

export interface IObjectType {
  code: string;
  name: string;
  description: string | null;
  /**
   * Structural category the type belongs to. Section 4.1 does not list this field, but
   * without it a cable type could be attached to a panel and the per-category validation
   * in the shared schema would have nothing to key on.
   */
  category: ObjectCategory;
  showOnPlan: boolean;
  insidePanel: boolean;
  generatesConclusion: boolean;
  icon: ObjectIcon;
  isActive: boolean;
  createdBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const objectTypeSchema = new Schema<IObjectType>(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 32 },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: null, trim: true, maxlength: 500 },
    category: { type: String, enum: OBJECT_CATEGORIES, required: true, index: true },
    showOnPlan: { type: Boolean, default: false },
    insidePanel: { type: Boolean, default: false },
    generatesConclusion: { type: Boolean, default: true },
    icon: { type: String, enum: OBJECT_ICONS, default: 'OTHER' },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, versionKey: false },
);

objectTypeSchema.index({ category: 1, isActive: 1, name: 1 });

export const ObjectType: Model<IObjectType> = model<IObjectType>('ObjectType', objectTypeSchema);

// -- Object ------------------------------------------------------------------

/** Section 4.2 panel fields. */
export interface IPanelAttributes {
  capacityKw: number | null;
  location: string | null;
  protection: string | null;
}

/** Section 4.2 and 11.4 circuit fields. */
export interface ICircuitAttributes {
  panel: Types.ObjectId | null;
  startPointObject: Types.ObjectId | null;
  endPointObject: Types.ObjectId | null;
  breakerRating: string | null;
  cableType: string | null;
  cableSectionMm2: number | null;
  cableLengthM: number | null;
  permittedCapacityKw: number | null;
}

/** Section 4.2 equipment fields. */
export interface IEquipmentAttributes {
  circuit: Types.ObjectId | null;
  ratedPowerKw: number | null;
  quantity: number | null;
  usageCoefficient: number | null;
  installedAt: Date | null;
  warrantyUntil: Date | null;
}

/** Denormalised head of the append-only assessment history, for list rendering. */
export interface ILatestAssessment {
  assessment: Types.ObjectId;
  score: number;
  riskLevel: RiskLevel;
  assessedAt: Date;
  assessedByName: string | null;
  conclusion: string | null;
  recommendation: string | null;
  repairRequired: boolean;
  revisitRequired: boolean;
  revisitDate: Date | null;
}

export interface IObject {
  code: string;
  name: string;
  category: ObjectCategory;
  objectType: Types.ObjectId;
  /** Organisation isolation, requirements 16.2 and rule 17.2. */
  customer: Types.ObjectId;
  /**
   * The floor this object sits on. One floor per object: a physical panel or device is in
   * one place, and section 4.2 records a single байршил. Re-linking moves it and is
   * audited on both sides.
   */
  floor: Types.ObjectId | null;
  status: ObjectStatus;
  description: string | null;
  notes: string | null;
  photos: Types.ObjectId[];

  panel: IPanelAttributes | null;
  circuit: ICircuitAttributes | null;
  equipment: IEquipmentAttributes | null;

  latestAssessment: ILatestAssessment | null;
  /** Most recent measured reading, kept separate from the calculation (rule 17.16). */
  measuredLoadKw: number | null;

  createdBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const panelAttributesSchema = new Schema<IPanelAttributes>(
  {
    capacityKw: { type: Number, default: null, min: 0 },
    location: { type: String, default: null, trim: true, maxlength: 200 },
    protection: { type: String, default: null, trim: true, maxlength: 200 },
  },
  { _id: false },
);

const circuitAttributesSchema = new Schema<ICircuitAttributes>(
  {
    panel: { type: Schema.Types.ObjectId, ref: 'Object', default: null, index: true },
    startPointObject: { type: Schema.Types.ObjectId, ref: 'Object', default: null },
    endPointObject: { type: Schema.Types.ObjectId, ref: 'Object', default: null },
    breakerRating: { type: String, default: null, trim: true, maxlength: 60 },
    cableType: { type: String, default: null, trim: true, maxlength: 60 },
    cableSectionMm2: { type: Number, default: null, min: 0 },
    cableLengthM: { type: Number, default: null, min: 0 },
    permittedCapacityKw: { type: Number, default: null, min: 0 },
  },
  { _id: false },
);

const equipmentAttributesSchema = new Schema<IEquipmentAttributes>(
  {
    circuit: { type: Schema.Types.ObjectId, ref: 'Object', default: null, index: true },
    ratedPowerKw: { type: Number, default: null, min: 0 },
    quantity: { type: Number, default: null, min: 0 },
    usageCoefficient: { type: Number, default: null, min: 0, max: 1 },
    installedAt: { type: Date, default: null },
    warrantyUntil: { type: Date, default: null },
  },
  { _id: false },
);

const latestAssessmentSchema = new Schema<ILatestAssessment>(
  {
    assessment: { type: Schema.Types.ObjectId, ref: 'ObjectAssessment', required: true },
    score: { type: Number, required: true, min: 0, max: 100 },
    riskLevel: { type: String, enum: RISK_LEVELS, required: true },
    assessedAt: { type: Date, required: true },
    assessedByName: { type: String, default: null },
    conclusion: { type: String, default: null },
    recommendation: { type: String, default: null },
    repairRequired: { type: Boolean, default: false },
    revisitRequired: { type: Boolean, default: false },
    revisitDate: { type: Date, default: null },
  },
  { _id: false },
);

const objectSchema = new Schema<IObject>(
  {
    code: { type: String, required: true, uppercase: true, trim: true, maxlength: 64 },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    category: { type: String, enum: OBJECT_CATEGORIES, required: true, index: true },
    objectType: { type: Schema.Types.ObjectId, ref: 'ObjectType', required: true, index: true },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    floor: { type: Schema.Types.ObjectId, ref: 'ObjectNode', default: null, index: true },
    status: { type: String, enum: OBJECT_STATUSES, required: true, default: 'ACTIVE', index: true },
    description: { type: String, default: null, trim: true, maxlength: 2000 },
    notes: { type: String, default: null, trim: true, maxlength: 2000 },
    photos: { type: [{ type: Schema.Types.ObjectId, ref: 'StoredFile' }], default: [] },

    panel: { type: panelAttributesSchema, default: null },
    circuit: { type: circuitAttributesSchema, default: null },
    equipment: { type: equipmentAttributesSchema, default: null },

    latestAssessment: { type: latestAssessmentSchema, default: null },
    measuredLoadKw: { type: Number, default: null, min: 0 },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, versionKey: false },
);

// Codes are unique per customer, not globally: two customers may both have a DB-2A.
objectSchema.index({ customer: 1, code: 1 }, { unique: true });
// Floor detail: everything linked to one floor, grouped by category.
objectSchema.index({ floor: 1, category: 1, code: 1 });
// The linking picker: a customer's objects that are not on a floor yet.
objectSchema.index({ customer: 1, floor: 1, category: 1 });
objectSchema.index({ name: 'text', code: 'text' });

export const ObjectRecord: Model<IObject> = model<IObject>('Object', objectSchema);

// -- Assessment history ------------------------------------------------------

/**
 * Append-only assessment history (requirements 10.1 and 9.4).
 *
 * A previous assessment is never overwritten: section 10.1 requires the previous and the
 * new score, the assessor, the date, the photos and the conclusion to be kept, and rule
 * 17.15 forbids deleting log or status history. Every mutation path is blocked at the
 * model layer, exactly as the audit log and the material ledger are.
 */
export interface IObjectAssessment {
  object: Types.ObjectId;
  previousScore: number | null;
  newScore: number;
  riskLevel: RiskLevel;
  assessedBy: Types.ObjectId | null;
  assessedByName: string | null;
  assessedAt: Date;
  photos: Types.ObjectId[];
  conclusion: string | null;
  recommendation: string | null;
  actionTaken: string | null;
  measuredLoadKw: number | null;
  repairRequired: boolean;
  revisitRequired: boolean;
  revisitDate: Date | null;
  revisitOwner: Types.ObjectId | null;
  revisitOwnerName: string | null;
  /** Set when the assessment was raised from a request or a planned work. */
  sourceLabel: string | null;
  createdAt: Date;
}

const objectAssessmentSchema = new Schema<IObjectAssessment>(
  {
    object: { type: Schema.Types.ObjectId, ref: 'Object', required: true, index: true },
    previousScore: { type: Number, default: null, min: 0, max: 100 },
    newScore: { type: Number, required: true, min: 0, max: 100 },
    riskLevel: { type: String, enum: RISK_LEVELS, required: true, index: true },
    assessedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    assessedByName: { type: String, default: null },
    assessedAt: { type: Date, required: true },
    photos: { type: [{ type: Schema.Types.ObjectId, ref: 'StoredFile' }], default: [] },
    conclusion: { type: String, default: null, maxlength: 4000 },
    recommendation: { type: String, default: null, maxlength: 4000 },
    actionTaken: { type: String, default: null, maxlength: 2000 },
    measuredLoadKw: { type: Number, default: null, min: 0 },
    repairRequired: { type: Boolean, default: false },
    revisitRequired: { type: Boolean, default: false },
    revisitDate: { type: Date, default: null },
    revisitOwner: { type: Schema.Types.ObjectId, ref: 'Employee', default: null },
    revisitOwnerName: { type: String, default: null },
    sourceLabel: { type: String, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

objectAssessmentSchema.index({ object: 1, assessedAt: -1 });

const IMMUTABLE = new Error('Үнэлгээний бүртгэлийг өөрчлөх, устгах боломжгүй.');

for (const hook of [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
  'findOneAndReplace',
] as const) {
  objectAssessmentSchema.pre(hook, function block(next) {
    next(IMMUTABLE);
  });
}

objectAssessmentSchema.pre('save', function blockResave(next) {
  if (!this.isNew) return next(IMMUTABLE);
  return next();
});

export const ObjectAssessment: Model<IObjectAssessment> = model<IObjectAssessment>(
  'ObjectAssessment',
  objectAssessmentSchema,
);
