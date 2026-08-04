import {
  MATERIAL_UNITS,
  PLANNED_WORK_LIFECYCLE_STATUSES,
  PLANNED_WORK_REPORT_STATUSES,
  PLANNED_WORK_TASK_STATUSES,
  RISK_LEVELS,
  type MaterialUnit,
  type PlannedWorkLifecycleStatus,
  type PlannedWorkReportStatus,
  type PlannedWorkTaskStatus,
  type RiskLevel,
} from '@monhorus/shared';
import { Schema, Types, model, type Model } from 'mongoose';

import { nextSequenceValue } from '../../common/models/counter.model';

/**
 * Planned work (requirements section 7).
 *
 * A planned work belongs to exactly one project and one building. A project may own
 * any number of planned works simultaneously, across different buildings, periods,
 * employees and teams, so nothing here constrains a project to a single active record.
 *
 * `status` holds the persisted LIFECYCLE state only. OVERDUE is never stored here: it
 * is derived on read from plannedEndDate against server time. `overdueAt` records the
 * instant the work was first observed to be overdue, which is what the audit trail and
 * the late-completion figures are built from.
 */

export interface IPlannedWorkPause {
  pausedAt: Date;
  pausedBy: Types.ObjectId | null;
  pausedByName: string | null;
  reason: string;
  resumedAt: Date | null;
  resumedBy: Types.ObjectId | null;
  resumedByName: string | null;
}

const pauseSchema = new Schema<IPlannedWorkPause>(
  {
    pausedAt: { type: Date, required: true },
    pausedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    pausedByName: { type: String, default: null },
    reason: { type: String, required: true, maxlength: 1000 },
    resumedAt: { type: Date, default: null },
    resumedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    resumedByName: { type: String, default: null },
  },
  { _id: false },
);

export interface IPlannedWorkScheduleChange {
  changedAt: Date;
  changedBy: Types.ObjectId | null;
  changedByName: string | null;
  previousPlannedEndDate: Date;
  newPlannedEndDate: Date;
  reason: string;
  clearedOverdue: boolean;
}

const scheduleChangeSchema = new Schema<IPlannedWorkScheduleChange>(
  {
    changedAt: { type: Date, required: true },
    changedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    changedByName: { type: String, default: null },
    previousPlannedEndDate: { type: Date, required: true },
    newPlannedEndDate: { type: Date, required: true },
    reason: { type: String, required: true, maxlength: 1000 },
    clearedOverdue: { type: Boolean, default: false },
  },
  { _id: false },
);

/** Requirements 19.2 keeps V1 at "нэр/тоо": free text, no catalogue behind it. */
export interface IPlannedWorkMaterial {
  name: string;
  quantity: number;
  unit: MaterialUnit;
}

const plannedMaterialSchema = new Schema<IPlannedWorkMaterial>(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, enum: MATERIAL_UNITS, required: true, default: 'PIECE' },
  },
  { _id: false },
);

export interface IPlannedWork {
  workNumber: string;
  /** Null for work not tied to a project: internal maintenance, ad hoc jobs. */
  project: Types.ObjectId | null;
  building: Types.ObjectId;
  /**
   * Denormalised from the project — or from the building when there is no project — so
   * tenant-scoped queries never walk the tree.
   */
  customer: Types.ObjectId;
  title: string;
  description: string | null;

  plannedStartDate: Date;
  plannedEndDate: Date;
  /** Deadline as first planned, preserved across every authorised reschedule. */
  originalPlannedEndDate: Date;
  actualStartDate: Date | null;
  actualEndDate: Date | null;

  status: PlannedWorkLifecycleStatus;

  /** First instant the work was observed past its deadline. Null when not overdue. */
  overdueAt: Date | null;
  /** Set by the notification pipeline; kept so a breach is announced only once. */
  overdueNotificationSentAt: Date | null;
  /** True when the work completed after its deadline. Preserved in reporting. */
  completedLate: boolean;
  /** Minutes between plannedEndDate and actualEndDate when completedLate. */
  delayMinutes: number | null;

  currentPauseStartedAt: Date | null;
  totalPausedMinutes: number;
  pauseHistory: IPlannedWorkPause[];
  scheduleHistory: IPlannedWorkScheduleChange[];

  assignedEmployees: Types.ObjectId[];
  assignedTeam: Types.ObjectId | null;

  plannedMaterials: IPlannedWorkMaterial[];

  /** Quantity-weighted rollup, recalculated by the service on every task change. */
  totalQuantity: number;
  completedQuantity: number;
  progressPercent: number;
  taskCount: number;

  cancelReason: string | null;
  cancelledBy: Types.ObjectId | null;
  cancelledByName: string | null;
  cancelledAt: Date | null;

  archivedBy: Types.ObjectId | null;
  archivedByName: string | null;
  archivedAt: Date | null;

  createdBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const plannedWorkSchema = new Schema<IPlannedWork>(
  {
    workNumber: { type: String, required: true, unique: true },
    project: { type: Schema.Types.ObjectId, ref: 'ObjectNode', default: null, index: true },
    building: { type: Schema.Types.ObjectId, ref: 'ObjectNode', required: true, index: true },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: null, trim: true, maxlength: 4000 },

    plannedStartDate: { type: Date, required: true },
    plannedEndDate: { type: Date, required: true },
    originalPlannedEndDate: { type: Date, required: true },
    actualStartDate: { type: Date, default: null },
    actualEndDate: { type: Date, default: null },

    status: {
      type: String,
      enum: PLANNED_WORK_LIFECYCLE_STATUSES,
      required: true,
      default: 'DRAFT',
      index: true,
    },

    overdueAt: { type: Date, default: null, index: true },
    overdueNotificationSentAt: { type: Date, default: null },
    completedLate: { type: Boolean, default: false },
    delayMinutes: { type: Number, default: null },

    currentPauseStartedAt: { type: Date, default: null },
    totalPausedMinutes: { type: Number, default: 0, min: 0 },
    pauseHistory: { type: [pauseSchema], default: [] },
    scheduleHistory: { type: [scheduleChangeSchema], default: [] },

    assignedEmployees: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Employee' }],
      default: [],
      index: true,
    },
    assignedTeam: { type: Schema.Types.ObjectId, ref: 'Team', default: null, index: true },

    plannedMaterials: { type: [plannedMaterialSchema], default: [] },

    totalQuantity: { type: Number, default: 0, min: 0 },
    completedQuantity: { type: Number, default: 0, min: 0 },
    progressPercent: { type: Number, default: 0, min: 0, max: 100 },
    taskCount: { type: Number, default: 0, min: 0 },

    cancelReason: { type: String, default: null, maxlength: 1000 },
    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    cancelledByName: { type: String, default: null },
    cancelledAt: { type: Date, default: null },

    archivedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    archivedByName: { type: String, default: null },
    archivedAt: { type: Date, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, versionKey: false },
);

// Overdue reconciliation: outstanding work whose deadline has passed.
plannedWorkSchema.index({ status: 1, plannedEndDate: 1, overdueAt: 1 });
// Calendar and list windows.
plannedWorkSchema.index({ plannedStartDate: 1, plannedEndDate: 1 });
plannedWorkSchema.index({ customer: 1, status: 1, plannedStartDate: -1 });
plannedWorkSchema.index({ title: 'text', workNumber: 'text' });

export const PlannedWork: Model<IPlannedWork> = model<IPlannedWork>(
  'PlannedWork',
  plannedWorkSchema,
);

/**
 * Concurrency-safe work number in the form PW-YYYYMM-NNNN.
 *
 * The sequence comes from an atomic counter document, so two simultaneous creations
 * cannot be handed the same number.
 */
export async function nextWorkNumber(now: Date = new Date()): Promise<string> {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const period = `${year}${month}`;
  const sequence = await nextSequenceValue(`planned-work:${period}`);
  return `PW-${period}-${String(sequence).padStart(4, '0')}`;
}

// -- Tasks -------------------------------------------------------------------

/**
 * A sub-task carries the quantity that drives all progress figures.
 *
 * `status` is stored, but only ever written by the derivation in the shared vocabulary;
 * no route accepts it as input. `completedQuantity` plus the evidence fields are the
 * real inputs.
 */
export interface IPlannedWorkTask {
  plannedWork: Types.ObjectId;
  floor: Types.ObjectId | null;
  title: string;
  description: string | null;
  unit: MaterialUnit;
  totalQuantity: number;
  completedQuantity: number;
  status: PlannedWorkTaskStatus;
  /** Reported as begun although no quantity is complete yet. */
  explicitlyStarted: boolean;
  skipped: boolean;
  plannedStartDate: Date;
  plannedEndDate: Date;
  assignedEmployee: Types.ObjectId | null;
  /**
   * Master-data objects this sub-task worked on. Populates the planned-work section of an
   * object's history without duplicating any object data onto the task.
   */
  relatedObjects: Types.ObjectId[];
  /** The performer's Тайлбар — the observation on each related object's ReportItem. */
  note: string | null;
  /**
   * The performer's `Дүгнэлт`, copied onto the ReportItem of every related object.
   *
   * A sub-task used to be barred from carrying one, on the rule that `Дүгнэлт` belonged
   * to the consolidated report alone. That left the Дүгнэлт column of Үзлэг ба дүгнэлт
   * empty for every planned-work row, since those rows ARE the per-object items fanned
   * out from a sub-task. The consolidated report still has its own conclusion; this is an
   * addition to it, not a replacement.
   */
  conclusion: string | null;
  /**
   * Who wrote the `conclusion` currently stored, and when.
   *
   * Written only when the Дүгнэлт TEXT changes. Any assigned team member may record
   * progress on any sub-task and each write overwrites the last, so stamping this on every
   * progress write would attribute the verdict to whoever last adjusted the quantity.
   * Clearing the conclusion clears the whole triple.
   */
  conclusionBy: Types.ObjectId | null;
  conclusionByName: string | null;
  conclusionAt: Date | null;
  /**
   * First instant this sub-task was reported begun — `started: true` or any completed
   * quantity. STICKY: set once and never moved or cleared, because it records when the
   * physical work started.
   */
  startedAt: Date | null;
  /**
   * First instant `completedQuantity` reached `totalQuantity`. STICKY, and deliberately
   * NOT the same field as `completedAt`.
   *
   * `completedAt` tracks the DONE derivation, which nulls itself whenever a task drops out
   * of DONE and re-stamps a fresh instant later — deleting one evidence photo is enough to
   * move it. That is right for "is it currently done"; it is wrong for "when did the work
   * finish". This one is written once and never rewritten, so the duration it anchors
   * cannot travel backwards or be erased by a re-derivation.
   */
  quantityCompletedAt: Date | null;
  /** 0-100 evaluation recorded when the sub-task is finished. */
  score: number | null;
  /**
   * Band for `score`. Section 10.1 makes this a function of the score against the
   * thresholds in force, so it is always derived and never accepted from a caller.
   */
  riskLevel: RiskLevel | null;
  recommendation: string | null;
  beforePhotos: Types.ObjectId[];
  afterPhotos: Types.ObjectId[];
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const plannedWorkTaskSchema = new Schema<IPlannedWorkTask>(
  {
    plannedWork: { type: Schema.Types.ObjectId, ref: 'PlannedWork', required: true, index: true },
    floor: { type: Schema.Types.ObjectId, ref: 'ObjectNode', default: null, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: null, trim: true, maxlength: 2000 },
    unit: { type: String, enum: MATERIAL_UNITS, required: true, default: 'PIECE' },
    totalQuantity: { type: Number, required: true, min: 0 },
    completedQuantity: { type: Number, required: true, default: 0, min: 0 },
    status: {
      type: String,
      enum: PLANNED_WORK_TASK_STATUSES,
      required: true,
      default: 'PENDING',
      index: true,
    },
    explicitlyStarted: { type: Boolean, default: false },
    skipped: { type: Boolean, default: false },
    plannedStartDate: { type: Date, required: true },
    plannedEndDate: { type: Date, required: true },
    assignedEmployee: { type: Schema.Types.ObjectId, ref: 'Employee', default: null, index: true },
    relatedObjects: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Object' }],
      default: [],
      index: true,
    },
    note: { type: String, default: null, trim: true, maxlength: 4000 },
    conclusion: { type: String, default: null, trim: true, maxlength: 4000 },
    conclusionBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    conclusionByName: { type: String, default: null },
    conclusionAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    quantityCompletedAt: { type: Date, default: null },
    score: { type: Number, default: null, min: 0, max: 100 },
    riskLevel: { type: String, enum: [...RISK_LEVELS, null], default: null },
    recommendation: { type: String, default: null, trim: true, maxlength: 4000 },
    beforePhotos: { type: [{ type: Schema.Types.ObjectId, ref: 'StoredFile' }], default: [] },
    afterPhotos: { type: [{ type: Schema.Types.ObjectId, ref: 'StoredFile' }], default: [] },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true, versionKey: false },
);

plannedWorkTaskSchema.index({ plannedWork: 1, floor: 1, plannedStartDate: 1 });

export const PlannedWorkTask: Model<IPlannedWorkTask> = model<IPlannedWorkTask>(
  'PlannedWorkTask',
  plannedWorkTaskSchema,
);

// -- Report ------------------------------------------------------------------

/**
 * Consolidated report, tracked as its own workflow rather than as extra planned-work
 * statuses. A report that is returned for correction leaves the planned work COMPLETED;
 * operational work does not reopen.
 */
export interface IPlannedWorkReport {
  plannedWork: Types.ObjectId;
  status: PlannedWorkReportStatus;
  conclusion: string | null;
  recommendation: string | null;

  createdBy: Types.ObjectId | null;
  createdByName: string | null;

  submittedBy: Types.ObjectId | null;
  submittedByName: string | null;
  submittedAt: Date | null;

  approvedBy: Types.ObjectId | null;
  approvedByName: string | null;
  approvedAt: Date | null;
  /** True when approval was performed as a head_admin override. */
  approvalWasOverride: boolean;

  returnedBy: Types.ObjectId | null;
  returnedByName: string | null;
  returnedAt: Date | null;
  returnReason: string | null;

  createdAt: Date;
  updatedAt: Date;
}

const plannedWorkReportSchema = new Schema<IPlannedWorkReport>(
  {
    plannedWork: {
      type: Schema.Types.ObjectId,
      ref: 'PlannedWork',
      required: true,
      unique: true,
    },
    status: {
      type: String,
      enum: PLANNED_WORK_REPORT_STATUSES,
      required: true,
      default: 'DRAFT',
      index: true,
    },
    conclusion: { type: String, default: null, trim: true, maxlength: 8000 },
    recommendation: { type: String, default: null, trim: true, maxlength: 8000 },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    createdByName: { type: String, default: null },

    submittedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    submittedByName: { type: String, default: null },
    submittedAt: { type: Date, default: null },

    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedByName: { type: String, default: null },
    approvedAt: { type: Date, default: null },
    approvalWasOverride: { type: Boolean, default: false },

    returnedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    returnedByName: { type: String, default: null },
    returnedAt: { type: Date, default: null },
    returnReason: { type: String, default: null, maxlength: 2000 },
  },
  { timestamps: true, versionKey: false },
);

export const PlannedWorkReport: Model<IPlannedWorkReport> = model<IPlannedWorkReport>(
  'PlannedWorkReport',
  plannedWorkReportSchema,
);
