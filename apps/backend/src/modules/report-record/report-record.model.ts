import {
  REPORT_SOURCE_TYPES,
  REPORT_STATUSES,
  REPORT_TYPES,
  RISK_LEVELS,
  type ReportSourceType,
  type ReportStatus,
  type ReportType,
  type RiskLevel,
} from '@monhorus/shared';
import { Schema, Types, model, type Model } from 'mongoose';

import { nextSequenceValue } from '../../common/models/counter.model';

/**
 * One report, whatever produced it.
 *
 * Every assessment and conclusion lands here: raised by hand against equipment, produced
 * by a completed planned work, written on a service request, or consolidated from several
 * of those. The narrative, the hierarchy and the approval live on this document; what was
 * found on each piece of equipment lives on its ReportItem. That split is the point — a
 * report is stored once and linked to its objects, never copied onto each of them.
 *
 * The hierarchy is stored rather than walked. It is resolved server-side from the
 * equipment the items name, so the central module can filter a hundred thousand rows by
 * building without a lookup per row, and a report keeps saying where the work happened
 * even after the equipment is moved or retired.
 */
export interface IReport {
  reportNumber: string;
  type: ReportType;
  status: ReportStatus;
  title: string;

  customer: Types.ObjectId | null;
  project: Types.ObjectId | null;
  building: Types.ObjectId | null;

  sourceType: ReportSourceType;
  /** The record that raised it. Null for a manual assessment or a consolidation. */
  sourceId: Types.ObjectId | null;
  /** The source's own human reference, kept so a list can show it without a join. */
  sourceReference: string | null;

  conclusion: string | null;
  recommendation: string | null;
  /** Derived from the items: the worst score among them. */
  overallScore: number | null;
  riskLevel: RiskLevel | null;

  /** Set on a consolidated report. */
  sourceReportIds: Types.ObjectId[];
  sourceReportItemIds: Types.ObjectId[];

  createdBy: Types.ObjectId | null;
  createdByName: string | null;
  submittedBy: Types.ObjectId | null;
  submittedByName: string | null;
  submittedAt: Date | null;
  approvedBy: Types.ObjectId | null;
  approvedByName: string | null;
  approvedAt: Date | null;
  publishedBy: Types.ObjectId | null;
  publishedByName: string | null;
  publishedAt: Date | null;
  returnedBy: Types.ObjectId | null;
  returnedByName: string | null;
  returnedAt: Date | null;
  returnReason: string | null;

  /** When the work described happened, which is not when the row was written. */
  occurredAt: Date;
  /** The pre-unification record this row was carried from. Set only by the migration. */
  legacySourceId: Types.ObjectId | null;
  legacySourceModel: string | null;

  createdAt: Date;
  updatedAt: Date;
}

const reportSchema = new Schema<IReport>(
  {
    reportNumber: { type: String, required: true, unique: true },
    type: { type: String, enum: REPORT_TYPES, required: true, index: true },
    status: { type: String, enum: REPORT_STATUSES, required: true, default: 'DRAFT', index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },

    customer: { type: Schema.Types.ObjectId, ref: 'Customer', default: null, index: true },
    project: { type: Schema.Types.ObjectId, ref: 'ObjectNode', default: null, index: true },
    building: { type: Schema.Types.ObjectId, ref: 'ObjectNode', default: null, index: true },

    sourceType: { type: String, enum: REPORT_SOURCE_TYPES, required: true },
    sourceId: { type: Schema.Types.ObjectId, default: null },
    sourceReference: { type: String, default: null },

    conclusion: { type: String, default: null, maxlength: 8000 },
    recommendation: { type: String, default: null, maxlength: 8000 },
    overallScore: { type: Number, default: null, min: 0, max: 100 },
    riskLevel: { type: String, enum: [...RISK_LEVELS, null], default: null, index: true },

    sourceReportIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Report' }], default: [] },
    sourceReportItemIds: {
      type: [{ type: Schema.Types.ObjectId, ref: 'ReportItem' }],
      default: [],
    },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    createdByName: { type: String, default: null },
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    submittedByName: { type: String, default: null },
    submittedAt: { type: Date, default: null },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedByName: { type: String, default: null },
    approvedAt: { type: Date, default: null },
    publishedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    publishedByName: { type: String, default: null },
    publishedAt: { type: Date, default: null },
    returnedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    returnedByName: { type: String, default: null },
    returnedAt: { type: Date, default: null },
    returnReason: { type: String, default: null, maxlength: 2000 },

    occurredAt: { type: Date, required: true, index: true },
    legacySourceId: { type: Schema.Types.ObjectId, default: null, index: true },
    legacySourceModel: { type: String, default: null },
  },
  { timestamps: true },
);

/**
 * One report per source record — the duplicate-storage guarantee.
 *
 * Completing a planned work twice must correct its one report rather than write a second,
 * and the same holds for a service request re-approved after a returned conclusion.
 * Enforcing it in the database rather than by looking first is what makes it hold under
 * two concurrent completions; a check-then-write loses that race.
 *
 * Partial, because the pair is only meaningful when a source record exists: manual
 * assessments and consolidations carry none and would otherwise all collide on null.
 * Customer is included because it is this system's tenant boundary.
 */
reportSchema.index(
  { customer: 1, sourceType: 1, sourceId: 1 },
  {
    unique: true,
    partialFilterExpression: { sourceId: { $type: 'objectId' } },
  },
);

// The central module's default view: newest first, narrowed by where the work happened.
reportSchema.index({ occurredAt: -1 });
reportSchema.index({ customer: 1, occurredAt: -1 });
reportSchema.index({ building: 1, occurredAt: -1 });
reportSchema.index({ type: 1, status: 1, occurredAt: -1 });
reportSchema.index({ title: 'text', reportNumber: 'text' });

export const Report: Model<IReport> = model<IReport>('Report', reportSchema);

/**
 * What was found on one piece of equipment.
 *
 * Its own collection rather than a subdocument array, because the object history and the
 * per-object report list both query items directly — `{ object }` has to be an index, not
 * a scan through every report's array.
 */
export interface IReportItem {
  report: Types.ObjectId;
  /** Denormalised from the report so an item query can be tenant-scoped on its own. */
  customer: Types.ObjectId | null;
  object: Types.ObjectId;
  floor: Types.ObjectId | null;

  score: number | null;
  riskLevel: RiskLevel | null;
  observation: string | null;
  conclusion: string | null;
  recommendation: string | null;
  /** Measured load for this piece of equipment, when the visit took one. */
  measuredLoadKw: number | null;
  evidenceAttachments: Types.ObjectId[];

  /**
   * Who wrote THIS item's Дүгнэлт, when the producer knows per equipment.
   *
   * Distinct from the report's `createdBy` (who raised the report) and its `approvedBy`
   * (who signed it off): one planned work can carry sub-tasks concluded by different
   * technicians, and the equipment's history is entitled to name the one who judged it.
   * Null where the producer has no per-item author — a service-request conclusion, a
   * consolidation of items that carried none — and never backfilled from the report-level
   * actor, because that would make the field mean two things at once.
   */
  judgedBy: Types.ObjectId | null;
  judgedByName: string | null;

  /** Set on a consolidated report's items: where the finding was carried from. */
  sourceReport: Types.ObjectId | null;
  sourceReportItem: Types.ObjectId | null;

  createdAt: Date;
  updatedAt: Date;
}

const reportItemSchema = new Schema<IReportItem>(
  {
    report: { type: Schema.Types.ObjectId, ref: 'Report', required: true, index: true },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', default: null, index: true },
    object: { type: Schema.Types.ObjectId, ref: 'Object', required: true, index: true },
    floor: { type: Schema.Types.ObjectId, ref: 'ObjectNode', default: null, index: true },

    score: { type: Number, default: null, min: 0, max: 100 },
    riskLevel: { type: String, enum: [...RISK_LEVELS, null], default: null },
    observation: { type: String, default: null, maxlength: 4000 },
    conclusion: { type: String, default: null, maxlength: 8000 },
    recommendation: { type: String, default: null, maxlength: 8000 },
    measuredLoadKw: { type: Number, default: null, min: 0 },
    evidenceAttachments: {
      type: [{ type: Schema.Types.ObjectId, ref: 'StoredFile' }],
      default: [],
    },

    judgedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    judgedByName: { type: String, default: null },

    sourceReport: { type: Schema.Types.ObjectId, ref: 'Report', default: null },
    sourceReportItem: { type: Schema.Types.ObjectId, ref: 'ReportItem', default: null },
  },
  { timestamps: true },
);

/**
 * One item per object per report.
 *
 * A retried completion rewrites the finding for each object rather than appending a second
 * row for the same one, and a consolidation cannot pull the same finding in twice.
 */
reportItemSchema.index({ report: 1, object: 1 }, { unique: true });

// The object history and `GET /objects/:objectId/reports` both read this way round.
reportItemSchema.index({ object: 1, createdAt: -1 });

export const ReportItem: Model<IReportItem> = model<IReportItem>('ReportItem', reportItemSchema);

/**
 * `RPT-YYYYMM-NNNN`, from an atomic counter.
 *
 * Counting existing rows to find the next number hands the same one to two concurrent
 * writers and relies on the unique index plus a retry; a counter document does not.
 */
export async function nextReportNumber(now: Date = new Date()): Promise<string> {
  const period = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const sequence = await nextSequenceValue(`report:${period}`);
  return `RPT-${period}-${String(sequence).padStart(4, '0')}`;
}
