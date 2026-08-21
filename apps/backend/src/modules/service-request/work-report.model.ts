import {
  MATERIAL_UNITS,
  RISK_LEVELS,
  WORK_REPORT_STATUSES,
  type MaterialUnit,
  type RiskLevel,
  type WorkReportStatus,
} from '@monhorus/shared';
import { Schema, Types, model, type Model } from 'mongoose';

/**
 * The section 9.2 work conclusion for a service request.
 *
 * A separate document rather than fields on the request, for the same reason the
 * planned-work report is separate: it has its own approval chain, its own author and its
 * own timestamps, and folding four workflow states into the request would make the
 * request's own status ambiguous.
 *
 * `riskLevel` is stored alongside the score because it is resolved against the thresholds
 * in force at the time. Recomputing it on read would silently re-band conclusions that
 * were written under different settings.
 */
export interface IWorkReport {
  serviceRequest: Types.ObjectId;
  status: WorkReportStatus;

  score: number | null;
  riskLevel: RiskLevel | null;
  conclusion: string | null;
  recommendation: string | null;
  actionTaken: string | null;
  repairRequired: boolean;
  revisitRequired: boolean;
  revisitDate: Date | null;

  beforePhotos: Types.ObjectId[];
  afterPhotos: Types.ObjectId[];

  /**
   * What was used on the job. Requirements 19.2 keeps V1 at "нэр/тоо", so this is typed
   * text embedded on the conclusion rather than a reference into a warehouse.
   */
  materials: IWorkReportMaterial[];

  /**
   * The registered equipment the technician recorded as inspected. The request itself
   * references only the location tree, so this list is the sole link from a service
   * result to the object master — recorded here rather than on the request because what
   * actually gets looked at is discovered on site, not known when the request is raised.
   */
  objects: Types.ObjectId[];

  /**
   * What was found on EACH piece of equipment.
   *
   * The conclusion used to be written once for the whole visit and copied onto every
   * object it named, which produced a report claiming the same score for a healthy panel
   * and a failing one. A visit that inspects three objects has three findings, so each
   * carries its own score and narrative and becomes its own ReportItem.
   *
   * `objects` is kept alongside as the flat membership list — naming equipment before
   * assessing it is a real state while a draft is being filled in — and the two are
   * reconciled on save so an object in either reaches the report.
   */
  objectAssessments: IWorkReportObjectAssessment[];

  createdBy: Types.ObjectId | null;
  createdByName: string | null;

  submittedBy: Types.ObjectId | null;
  submittedByName: string | null;
  submittedAt: Date | null;

  approvedBy: Types.ObjectId | null;
  approvedByName: string | null;
  approvedAt: Date | null;

  returnedBy: Types.ObjectId | null;
  returnedByName: string | null;
  returnedAt: Date | null;
  returnReason: string | null;

  createdAt: Date;
  updatedAt: Date;
}

/**
 * One object's finding. The risk band is absent by design: section 10.1 derives it from
 * the score, so it is computed when the ReportItem is written rather than stored twice.
 */
export interface IWorkReportObjectAssessment {
  object: Types.ObjectId;
  score: number | null;
  observation: string | null;
  conclusion: string | null;
  recommendation: string | null;
  photos: Types.ObjectId[];
}

export interface IWorkReportMaterial {
  name: string;
  quantity: number;
  unit: MaterialUnit;
}

const workReportObjectAssessmentSchema = new Schema<IWorkReportObjectAssessment>(
  {
    object: { type: Schema.Types.ObjectId, ref: 'Object', required: true },
    score: { type: Number, default: null, min: 0, max: 100 },
    observation: { type: String, default: null, maxlength: 4000 },
    conclusion: { type: String, default: null, maxlength: 4000 },
    recommendation: { type: String, default: null, maxlength: 4000 },
    photos: { type: [{ type: Schema.Types.ObjectId, ref: 'StoredFile' }], default: [] },
  },
  { _id: false },
);

const workReportMaterialSchema = new Schema<IWorkReportMaterial>(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, enum: MATERIAL_UNITS, required: true, default: 'PIECE' },
  },
  { _id: false },
);

const workReportSchema = new Schema<IWorkReport>(
  {
    serviceRequest: {
      type: Schema.Types.ObjectId,
      ref: 'ServiceRequest',
      required: true,
      unique: true,
    },
    status: { type: String, enum: WORK_REPORT_STATUSES, required: true, default: 'DRAFT' },

    score: { type: Number, default: null, min: 0, max: 100 },
    riskLevel: { type: String, enum: [...RISK_LEVELS, null], default: null },
    conclusion: { type: String, default: null, maxlength: 4000 },
    recommendation: { type: String, default: null, maxlength: 4000 },
    actionTaken: { type: String, default: null, maxlength: 2000 },
    repairRequired: { type: Boolean, default: false },
    revisitRequired: { type: Boolean, default: false },
    revisitDate: { type: Date, default: null },

    beforePhotos: { type: [{ type: Schema.Types.ObjectId, ref: 'StoredFile' }], default: [] },
    afterPhotos: { type: [{ type: Schema.Types.ObjectId, ref: 'StoredFile' }], default: [] },

    materials: { type: [workReportMaterialSchema], default: [] },

    objects: { type: [{ type: Schema.Types.ObjectId, ref: 'Object' }], default: [] },
    objectAssessments: { type: [workReportObjectAssessmentSchema], default: [] },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    createdByName: { type: String, default: null },

    submittedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    submittedByName: { type: String, default: null },
    submittedAt: { type: Date, default: null },

    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedByName: { type: String, default: null },
    approvedAt: { type: Date, default: null },

    returnedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    returnedByName: { type: String, default: null },
    returnedAt: { type: Date, default: null },
    returnReason: { type: String, default: null, maxlength: 1000 },
  },
  { timestamps: true },
);

// The equipment-history join: which conclusions touched this object. Without it every
// object history page would scan the whole collection.
workReportSchema.index({ objects: 1 });

// The reverse lookup from an evidence photo to the conclusion that references it.
// `assertFileInCustomerScope` runs it on every portal download of a conclusion photo,
// because those files are parked on the uploading technician and never re-owned onto the
// request — so without these each image on the customer's screen would scan the collection.
workReportSchema.index({ beforePhotos: 1 });
workReportSchema.index({ afterPhotos: 1 });

export const WorkReport: Model<IWorkReport> = model<IWorkReport>('WorkReport', workReportSchema);
