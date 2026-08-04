import {
  LOAD_MEASUREMENT_KINDS,
  LOAD_MEASUREMENT_PHASES,
  LOAD_MEASUREMENT_UNITS,
  OBJECT_CATEGORIES,
  OBJECT_ICONS,
  OBJECT_STATUSES,
  RISK_LEVELS,
  type LoadMeasurementKind,
  type LoadMeasurementPhase,
  type LoadMeasurementUnit,
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
  /**
   * The panel enclosure the device is mounted inside.
   *
   * The second object→panel edge in the schema, beside `circuit.panel`. Without it a
   * circuit-less device — an RCD, a busbar, a meter, a surge arrester — could only be
   * registered onto the floor and would never appear under the panel it physically lives
   * in.
   *
   * NOT MUTUALLY EXCLUSIVE WITH `circuit`: a sub-panel's main breaker is genuinely both
   * mounted in one panel and fed by a circuit out of another, and forcing a choice would
   * make one of those two true facts unrecordable.
   *
   * LOAD NEVER FLOWS ALONG THIS EDGE. The section 11.5 walk descends panel → circuit →
   * equipment and reads `equipment.circuit` only, so a device with both edges is counted
   * exactly once (via its circuit) and a device with only this one contributes nothing.
   */
  panel: Types.ObjectId | null;
  ratedPowerKw: number | null;
  quantity: number | null;
  usageCoefficient: number | null;
  installedAt: Date | null;
  warrantyUntil: Date | null;
}

/**
 * Placement on the floor plan image (section 11.2).
 *
 * Stored normalised to 0..1 of the plan's width and height rather than in pixels. The plan
 * is one replaceable file that may be PNG, JPG, WEBP or PDF at any resolution, so a pixel
 * pair would point at a different part of the drawing the moment the image is swapped.
 */
export interface IPlanPosition {
  x: number;
  y: number;
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
  /**
   * Where the object was pinned on that floor's plan, or null when it was never placed.
   * Meaningless without `floor`, so the service clears it whenever the floor link goes.
   */
  planPosition: IPlanPosition | null;
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
    // Indexed exactly like `circuit` above and `circuit.panel`: the panel detail page
    // reads every device by this key, and the delete guard counts them.
    panel: { type: Schema.Types.ObjectId, ref: 'Object', default: null, index: true },
    ratedPowerKw: { type: Number, default: null, min: 0 },
    quantity: { type: Number, default: null, min: 0 },
    usageCoefficient: { type: Number, default: null, min: 0, max: 1 },
    installedAt: { type: Date, default: null },
    warrantyUntil: { type: Date, default: null },
  },
  { _id: false },
);

const planPositionSchema = new Schema<IPlanPosition>(
  {
    // 0..1, enforced here as well as in the shared schema: the service is not the only
    // writer of an object document, and a coordinate outside the plan is unusable.
    x: { type: Number, required: true, min: 0, max: 1 },
    y: { type: Number, required: true, min: 0, max: 1 },
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
    planPosition: { type: planPositionSchema, default: null },
    status:{ type: String, enum: OBJECT_STATUSES, required: true, default: 'ACTIVE', index: true },
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
/**
 * One reading in the unit it was taken in — "Multiple Load Units".
 *
 * Embedded rather than referenced: a reading has no life outside the assessment that took
 * it, and the assessment collection is append-only, so the sub-document inherits that
 * immutability for free. `_id: false` because nothing ever addresses a single reading.
 *
 * NOT summable. The kW head above (`measuredLoadKw`) is the only quantity any roll-up
 * touches; these are observations shown beside the assessment. See
 * `constants/load-measurement.ts`.
 */
export interface ILoadMeasurement {
  kind: LoadMeasurementKind;
  value: number;
  unit: LoadMeasurementUnit;
  phase: LoadMeasurementPhase | null;
}

const loadMeasurementSubSchema = new Schema<ILoadMeasurement>(
  {
    kind: { type: String, enum: LOAD_MEASUREMENT_KINDS, required: true },
    value: { type: Number, required: true, min: 0 },
    unit: { type: String, enum: LOAD_MEASUREMENT_UNITS, required: true },
    // The null is an enum member here, not an absence: a non-phase-specific reading is a
    // valid reading, and mongoose would otherwise refuse the stored default.
    phase: { type: String, enum: [...LOAD_MEASUREMENT_PHASES, null], default: null },
  },
  { _id: false },
);

export interface IObjectAssessment {
  object: Types.ObjectId;
  previousScore: number | null;
  newScore: number;
  riskLevel: RiskLevel;
  /**
   * WHO SIGNED THIS FINDING OFF — never who wrote it.
   *
   * The approver of the report the finding arrived on, falling back to whoever raised it
   * when the path has no separate approval step, and the recorder themselves on the manual
   * assessment screen where the two are one person. It answers "on whose authority does
   * this equipment now carry this score", which is what an audit record is asked.
   */
  assessedBy: Types.ObjectId | null;
  assessedByName: string | null;
  /**
   * WHO ACTUALLY MADE THE JUDGEMENT — the technician who wrote the Дүгнэлт this row
   * carries, where the producer recorded one per piece of equipment.
   *
   * Separate from `assessedBy` because the two are genuinely different people and merging
   * them would leave one field meaning "the judge, or else the signer" — a value nobody
   * could read without knowing which of the two it happened to be. Null means no
   * per-equipment author was recorded, NOT that the approver wrote it; a reader that wants
   * a name falls back to `assessedBy` and says which it is showing.
   *
   * Populated today only from a planned-work sub-task's `conclusionBy`. The
   * service-request conclusion and the consolidation carry no per-object author of their
   * own (a consolidated item inherits whatever its source item carried).
   */
  judgedBy: Types.ObjectId | null;
  judgedByName: string | null;
  assessedAt: Date;
  photos: Types.ObjectId[];
  conclusion: string | null;
  recommendation: string | null;
  actionTaken: string | null;
  /**
   * The authoritative, summable kW figure. Unchanged by the readings list below: the floor
   * roll-up sums this and only this, and an ACTIVE_POWER reading is required to agree with
   * it rather than replace it.
   */
  measuredLoadKw: number | null;
  /** Amps, volts and kW as read on site. Empty when only the kW box was filled in. */
  measurements: ILoadMeasurement[];
  repairRequired: boolean;
  revisitRequired: boolean;
  revisitDate: Date | null;
  revisitOwner: Types.ObjectId | null;
  revisitOwnerName: string | null;
  /** Set when the assessment was raised from a request or a planned work. */
  sourceLabel: string | null;
  /**
   * The report finding this row was raised from, when it did not come from the manual
   * assessment screen.
   *
   * `sourceReportItem` is the idempotency key of the whole history write: `syncItems`
   * upserts one item per (report, object), so the item's id survives every re-approval and
   * re-publish of the same report and identifies the finding rather than the attempt to
   * apply it. Null for a manual assessment, which is an event with no correctable record
   * behind it and so deduplicates against nothing.
   */
  sourceReport: Types.ObjectId | null;
  sourceReportItem: Types.ObjectId | null;
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
    judgedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    judgedByName: { type: String, default: null },
    assessedAt: { type: Date, required: true },
    photos: { type: [{ type: Schema.Types.ObjectId, ref: 'StoredFile' }], default: [] },
    conclusion: { type: String, default: null, maxlength: 4000 },
    recommendation: { type: String, default: null, maxlength: 4000 },
    actionTaken: { type: String, default: null, maxlength: 2000 },
    measuredLoadKw: { type: Number, default: null, min: 0 },
    measurements: { type: [loadMeasurementSubSchema], default: [] },
    repairRequired: { type: Boolean, default: false },
    revisitRequired: { type: Boolean, default: false },
    revisitDate: { type: Date, default: null },
    revisitOwner: { type: Schema.Types.ObjectId, ref: 'Employee', default: null },
    revisitOwnerName: { type: String, default: null },
    sourceLabel: { type: String, default: null },
    sourceReport: { type: Schema.Types.ObjectId, ref: 'Report', default: null },
    sourceReportItem: { type: Schema.Types.ObjectId, ref: 'ReportItem', default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

objectAssessmentSchema.index({ object: 1, assessedAt: -1 });
/**
 * The lookup behind the idempotency guard, sparse because only report-raised rows carry
 * the key and a manual assessment must not collide with the many other manual ones.
 */
objectAssessmentSchema.index({ sourceReportItem: 1, newScore: 1 }, { sparse: true });

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
