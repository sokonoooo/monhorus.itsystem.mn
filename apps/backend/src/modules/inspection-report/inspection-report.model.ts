import {
  INSPECTION_REPORT_STATUSES,
  type InspectionReportStatus,
} from '@monhorus/shared';
import { Schema, Types, model, type Model } from 'mongoose';

/**
 * The consolidated inspection report (Үзлэгийн нэгдсэн тайлан), requirements 7-11.
 *
 * One document per planned work, enforced by a unique index: a planned work has exactly
 * one report, and reopening a finalised one advances `version` on the same document
 * rather than inserting a second.
 *
 * Only AUTHORED and TRANSITIONAL state is stored. The heading, the sub-task sections,
 * the derived зөрчил list and the overall safety level are all recomputed from the
 * planned work and its sub-tasks every time the report is read, so a report can never
 * disagree with the data it is a report of. Persisting a computed band would let the
 * printed verdict drift the moment a sub-task score changed.
 */
export interface IInspectionReport {
  plannedWork: Types.ObjectId;
  status: InspectionReportStatus;
  /** Advances each time a finalised report is reopened. Not a version archive. */
  version: number;

  // The narrative. Auto-composed on generation, then owned by the administrator.
  inspectedScope: string | null;
  issueSummary: string | null;
  conclusion: string | null;
  recommendation: string | null;
  replacementPanels: string[];
  replacementConnections: string[];
  /**
   * True while every narrative field is still exactly as the system composed it. Once an
   * administrator edits one, this turns false and regeneration must never overwrite the
   * text again.
   */
  isAutoDraft: boolean;

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

  finalisedBy: Types.ObjectId | null;
  finalisedByName: string | null;
  finalisedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

const inspectionReportSchema = new Schema<IInspectionReport>(
  {
    plannedWork: {
      type: Schema.Types.ObjectId,
      ref: 'PlannedWork',
      required: true,
      unique: true,
    },
    status: {
      type: String,
      enum: INSPECTION_REPORT_STATUSES,
      required: true,
      default: 'DRAFT',
      index: true,
    },
    version: { type: Number, required: true, default: 1, min: 1 },

    inspectedScope: { type: String, default: null, trim: true, maxlength: 2000 },
    issueSummary: { type: String, default: null, trim: true, maxlength: 20000 },
    conclusion: { type: String, default: null, trim: true, maxlength: 20000 },
    recommendation: { type: String, default: null, trim: true, maxlength: 20000 },
    replacementPanels: { type: [{ type: String, maxlength: 500 }], default: [] },
    replacementConnections: { type: [{ type: String, maxlength: 500 }], default: [] },
    isAutoDraft: { type: Boolean, required: true, default: true },

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
    returnReason: { type: String, default: null, maxlength: 2000 },

    finalisedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    finalisedByName: { type: String, default: null },
    finalisedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

export const InspectionReport: Model<IInspectionReport> = model<IInspectionReport>(
  'InspectionReport',
  inspectionReportSchema,
);
