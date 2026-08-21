import { OBJECT_NODE_KINDS, type ObjectNodeKind } from '@monhorus/shared';
import { Schema, Types, model, type Model } from 'mongoose';

/**
 * Customer organisation. Requirements rule 17.2: in V1 a customer is always an
 * organisation, never an individual.
 */
export interface ICustomer {
  code: string;
  name: string;
  /** РД, requirements 4.2. */
  registrationNumber: string | null;
  /** ТТД, requirements 4.2. */
  taxNumber: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  contactPerson: string | null;
  /** Хариуцсан хүн, requirements 4.2. References an internal Employee. */
  responsibleEmployee: Types.ObjectId | null;
  notes: string | null;
  isActive: boolean;
  /**
   * Who registered this customer.
   *
   * Nullable and will stay null on every row that existed before the field did — the
   * information was never captured, and inventing it from `updatedAt` or an audit row would
   * be a guess presented as a fact. New records carry it.
   */
  createdBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const customerSchema = new Schema<ICustomer>(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 32 },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    registrationNumber: { type: String, default: null, trim: true, maxlength: 32 },
    taxNumber: { type: String, default: null, trim: true, maxlength: 32 },
    phone: { type: String, default: null, trim: true, maxlength: 24 },
    email: { type: String, default: null, lowercase: true, trim: true, maxlength: 254 },
    address: { type: String, default: null, trim: true, maxlength: 500 },
    contactPerson: { type: String, default: null, trim: true, maxlength: 200 },
    responsibleEmployee: {
      type: Schema.Types.ObjectId,
      ref: 'Employee',
      default: null,
      index: true,
    },
    notes: { type: String, default: null, trim: true, maxlength: 2000 },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, versionKey: false },
);

customerSchema.index({ name: 'text', code: 'text' });

export const Customer: Model<ICustomer> = model<ICustomer>('Customer', customerSchema);

/**
 * Single polymorphic collection for the whole object hierarchy:
 * Төсөл -> Барилга -> Давхар -> Өрөө/Бүс -> Самбар -> Хэлхээ -> Төхөөрөмж
 *
 * One collection rather than seven because every level shares the same shape and the
 * UI walks the tree generically. `kind` discriminates, `parent` links upward, and
 * `customer` is denormalised onto every node so a tenant-scoped query never needs to
 * walk to the root.
 *
 * Requirements 11.3 requires plan objects to reference a real master record; that is
 * exactly what this collection provides.
 */
/**
 * Kind-specific fields from requirements 4.2.
 *
 * Held in one sub-document rather than eight collections so the drill-down, the breadcrumb
 * and the dependent selectors stay written once. Only the block matching `kind` is ever
 * populated; the shared Zod schemas enforce which fields a given kind accepts.
 */
export interface IObjectNodeAttributes {
  // PROJECT
  contractNumber?: string | null;
  responsibleEmployee?: Types.ObjectId | null;
  startDate?: Date | null;
  endDate?: Date | null;

  // BUILDING
  address?: string | null;
  gpsLatitude?: number | null;
  gpsLongitude?: number | null;

  // FLOOR
  floorNumber?: number | null;
  areaSqm?: number | null;
  purpose?: string | null;
}

export interface IObjectNodeRollup {
  score: number;
  /** The equipment the score came from, so a reader can go straight to the cause. */
  worstObject: Types.ObjectId;
  assessedCount: number;
  unassessedCount: number;
  calculatedAt: Date;
}

const rollupSchema = new Schema<IObjectNodeRollup>(
  {
    score: { type: Number, required: true, min: 0, max: 100 },
    worstObject: { type: Schema.Types.ObjectId, ref: 'Object', required: true },
    assessedCount: { type: Number, required: true, min: 0 },
    unassessedCount: { type: Number, required: true, min: 0 },
    calculatedAt: { type: Date, required: true },
  },
  { _id: false },
);

export interface IObjectNode {
  kind: ObjectNodeKind;
  code: string;
  name: string;
  parent: Types.ObjectId | null;
  customer: Types.ObjectId;
  /** Materialised ancestor chain, root first. Enables one-query breadcrumbs. */
  ancestors: Types.ObjectId[];
  /** Latest valid assessment score, requirements section 10. Null when unassessed. */
  riskScore: number | null;
  /**
   * The node's standing, recomputed from the equipment beneath it.
   *
   * Separate from `riskScore`, which is a figure an administrator types in by hand and
   * which nothing derives. Folding the two together would mean an automatic recalculation
   * silently overwriting a human's entry, or a human's entry silently surviving a
   * reassessment that contradicted it. `score` here is the worst assessed equipment's
   * score; null means nothing beneath the node has been assessed at all, which is a
   * different statement from a bad score.
   */
  rollup: IObjectNodeRollup | null;
  description: string | null;
  attributes: IObjectNodeAttributes;
  isActive: boolean;
  /**
   * Who registered this node — a project, a building or a floor, all three being kinds of
   * `ObjectNode`. Null on every row that predates the field; see the note on `ICustomer`.
   */
  createdBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const objectNodeAttributesSchema = new Schema<IObjectNodeAttributes>(
  {
    contractNumber: { type: String, default: null, trim: true, maxlength: 64 },
    responsibleEmployee: { type: Schema.Types.ObjectId, ref: 'Employee', default: null },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },

    address: { type: String, default: null, trim: true, maxlength: 500 },
    gpsLatitude: { type: Number, default: null, min: -90, max: 90 },
    gpsLongitude: { type: Number, default: null, min: -180, max: 180 },

    floorNumber: { type: Number, default: null },
    areaSqm: { type: Number, default: null, min: 0 },
    purpose: { type: String, default: null, trim: true, maxlength: 200 },
  },
  { _id: false },
);

const objectNodeSchema = new Schema<IObjectNode>(
  {
    kind: { type: String, enum: OBJECT_NODE_KINDS, required: true, index: true },
    code: { type: String, required: true, trim: true, maxlength: 64 },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    parent: { type: Schema.Types.ObjectId, ref: 'ObjectNode', default: null, index: true },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    ancestors: { type: [{ type: Schema.Types.ObjectId, ref: 'ObjectNode' }], default: [] },
    riskScore: { type: Number, default: null, min: 0, max: 100 },
    rollup: { type: rollupSchema, default: null },
    description: { type: String, default: null, trim: true, maxlength: 4000 },
    attributes: { type: objectNodeAttributesSchema, default: () => ({}) },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, versionKey: false },
);

// Children-of-parent lookup, the hot path for the dependent selector.
objectNodeSchema.index({ parent: 1, kind: 1, name: 1 });
// Tenant-scoped browsing by level.
objectNodeSchema.index({ customer: 1, kind: 1, name: 1 });
// Codes are unique per customer, not globally.
objectNodeSchema.index({ customer: 1, code: 1 }, { unique: true });

export const ObjectNode: Model<IObjectNode> = model<IObjectNode>('ObjectNode', objectNodeSchema);


/**
 * The single current plan image for a floor (requirements 11.1, rule 17.3).
 *
 * Deliberately not versioned. Section 19.2 leaves the plan editor format, scale,
 * coordinate system and version migration unapproved, so this stores one image per floor
 * and every upload, replacement, metadata edit and removal is written to the audit log
 * instead of to a version chain. There is no supersededBy and no version number.
 */
export interface IFloorPlan {
  floor: Types.ObjectId;
  file: Types.ObjectId;
  title: string | null;
  description: string | null;
  uploadedBy: Types.ObjectId | null;
  uploadedByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const floorPlanSchema = new Schema<IFloorPlan>(
  {
    // Unique: one current plan per floor, enforced by the database rather than by a check.
    floor: { type: Schema.Types.ObjectId, ref: 'ObjectNode', required: true, unique: true },
    file: { type: Schema.Types.ObjectId, ref: 'StoredFile', required: true },
    title: { type: String, default: null, trim: true, maxlength: 200 },
    description: { type: String, default: null, trim: true, maxlength: 2000 },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    uploadedByName: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);

export const FloorPlan: Model<IFloorPlan> = model<IFloorPlan>('FloorPlan', floorPlanSchema);
