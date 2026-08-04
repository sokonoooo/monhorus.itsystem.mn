import type {
  PlannedWorkAction,
  PlannedWorkEffectiveStatus,
  PlannedWorkLifecycleStatus,
  PlannedWorkReportStatus,
  PlannedWorkTaskStatus,
} from '../constants/planned-work';
import type { MaterialUnit } from '../constants/material';
import type { RiskLevel } from '../constants/service-request';

export interface NamedRefDto {
  id: string;
  name: string;
}

export interface ActorStampDto {
  id: string | null;
  name: string | null;
  at: string | null;
}

/** One pause episode. Kept as history so the paused duration is auditable. */
export interface PlannedWorkPauseDto {
  pausedAt: string;
  pausedById: string | null;
  pausedByName: string | null;
  reason: string;
  resumedAt: string | null;
  resumedById: string | null;
  resumedByName: string | null;
  /** Minutes between pause and resume; null while the pause is still open. */
  durationMinutes: number | null;
}

/** One authorised schedule change. Only this path may clear an overdue state. */
export interface PlannedWorkScheduleChangeDto {
  changedAt: string;
  changedById: string | null;
  changedByName: string | null;
  previousPlannedEndDate: string;
  newPlannedEndDate: string;
  reason: string;
  /** True when the change lifted an active OVERDUE state. */
  clearedOverdue: boolean;
}

export interface PlannedWorkTaskDto {
  id: string;
  plannedWorkId: string;
  floorId: string | null;
  floorName: string | null;
  title: string;
  description: string | null;
  unit: MaterialUnit;
  totalQuantity: number;
  completedQuantity: number;
  /** Backend-derived: totalQuantity - completedQuantity. */
  remainingQuantity: number;
  /** Backend-derived: completedQuantity / totalQuantity * 100. */
  progressPercent: number;
  /** Backend-derived from quantity plus evidence; never written by the client. */
  status: PlannedWorkTaskStatus;
  plannedStartDate: string;
  plannedEndDate: string;
  assignedEmployeeId: string | null;
  assignedEmployeeName: string | null;
  /** Equipment this sub-task covers; its result lands on each of them on approval. */
  relatedObjects: readonly NamedRefDto[];
  /** The performer's Тайлбар — the observation each related object's ReportItem carries. */
  note: string | null;
  /**
   * The performer's Дүгнэлт. Copied onto the ReportItem of every related object, which is
   * what fills the Дүгнэлт column of Үзлэг ба дүгнэлт for a planned-work row. The
   * consolidated report keeps its own, separate conclusion.
   */
  conclusion: string | null;
  /**
   * Who wrote the `conclusion` above, and when.
   *
   * Stamped only when the Дүгнэлт TEXT changes, never on an unrelated progress write. Any
   * team member may record progress on any sub-task and each write overwrites the last, so
   * stamping on every write would credit the verdict to whoever last nudged the quantity.
   */
  conclusionById: string | null;
  conclusionByName: string | null;
  conclusionAt: string | null;
  /**
   * Wall-clock minutes from the first reported start to the instant the quantity was
   * completed. Null while the sub-task is unfinished, and null for a skipped one.
   *
   * The clock stops at QUANTITY completion, not at DONE: DONE additionally needs the five
   * evidence items, so a job finished on Monday and photographed on Wednesday must not
   * read as two days. Paused time is not netted out — nothing in this system is.
   */
  durationMinutes: number | null;
  /** 0-100 evaluation the performer records when finishing the sub-task. */
  score: number | null;
  /** Backend-derived band for `score` against the thresholds in Тохиргоо. */
  riskLevel: RiskLevel | null;
  recommendation: string | null;
  beforePhotos: readonly PlannedWorkPhotoDto[];
  afterPhotos: readonly PlannedWorkPhotoDto[];
  /** Mongolian labels of the evidence still missing before the task may be DONE. */
  missingEvidence: readonly string[];
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlannedWorkPhotoDto {
  id: string;
  name: string;
  downloadUrl: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByName: string | null;
  uploadedAt: string;
}

/**
 * A material planned for the work: a typed name, a quantity and a unit.
 *
 * Requirements 19.2 keeps V1 at "нэр/тоо". There is no catalogue behind the name and no
 * stock ledger to compare against, so nothing here is planned-versus-actual.
 */
export interface PlannedWorkMaterialDto {
  name: string;
  quantity: number;
  unit: MaterialUnit;
}

export interface PlannedWorkFloorProgressDto {
  floorId: string;
  floorName: string;
  taskCount: number;
  totalQuantity: number;
  completedQuantity: number;
  remainingQuantity: number;
  progressPercent: number;
}

/** One lifecycle action the calling user may perform right now. */
export interface PlannedWorkAvailableActionDto {
  action: PlannedWorkAction;
  label: string;
  requiresReason: boolean;
  targetStatus: PlannedWorkLifecycleStatus;
}

export interface PlannedWorkReportDto {
  id: string;
  plannedWorkId: string;
  status: PlannedWorkReportStatus;
  conclusion: string | null;
  recommendation: string | null;
  createdBy: ActorStampDto;
  submittedBy: ActorStampDto;
  approvedBy: ActorStampDto;
  returnedBy: ActorStampDto;
  returnReason: string | null;
  /** Reasons the report cannot be submitted yet. Empty when submission is allowed. */
  submissionBlockers: readonly string[];
  /** True when the calling user may approve this report right now. */
  canApprove: boolean;
  /** Why approval is unavailable, when it is. */
  approvalBlockers: readonly string[];
  /** Requirements: a customer may only ever see an approved report. */
  visibleToCustomer: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PlannedWorkReportTaskLineDto {
  id: string;
  title: string;
  floorName: string;
  unit: MaterialUnit;
  totalQuantity: number;
  completedQuantity: number;
  progressPercent: number;
  status: PlannedWorkTaskStatus;
  note: string | null;
  score: number | null;
  riskLevel: RiskLevel | null;
  recommendation: string | null;
  beforePhotoCount: number;
  afterPhotoCount: number;
}

/**
 * Fully assembled report content.
 *
 * Generating this successfully is itself a submission requirement: a report that cannot
 * be rendered must not be sent for approval.
 */
export interface PlannedWorkReportPreviewDto {
  plannedWorkId: string;
  workNumber: string;
  title: string;
  customerName: string;
  /** Null for work not tied to a project. */
  projectName: string | null;
  buildingName: string;
  status: PlannedWorkReportStatus;
  plannedStartDate: string;
  plannedEndDate: string;
  originalPlannedEndDate: string;
  actualStartDate: string | null;
  actualEndDate: string | null;
  completedLate: boolean;
  delayMinutes: number | null;
  totalPausedMinutes: number;
  totalQuantity: number;
  completedQuantity: number;
  remainingQuantity: number;
  progressPercent: number;
  floorProgress: readonly PlannedWorkFloorProgressDto[];
  tasks: readonly PlannedWorkReportTaskLineDto[];
  materials: readonly PlannedWorkMaterialDto[];
  conclusion: string | null;
  recommendation: string | null;
  generatedAt: string;
}

export interface PlannedWorkListItemDto {
  id: string;
  workNumber: string;
  title: string;
  customer: NamedRefDto;
  /** Null for work not tied to a project (internal maintenance, ad hoc jobs). */
  project: NamedRefDto | null;
  building: NamedRefDto;
  lifecycleStatus: PlannedWorkLifecycleStatus;
  /** Authoritative status for display, filtering and dashboard counts. */
  effectiveStatus: PlannedWorkEffectiveStatus;
  plannedStartDate: string;
  plannedEndDate: string;
  actualStartDate: string | null;
  actualEndDate: string | null;
  overdueAt: string | null;
  completedLate: boolean;
  delayMinutes: number | null;
  totalQuantity: number;
  completedQuantity: number;
  remainingQuantity: number;
  progressPercent: number;
  taskCount: number;
  assignedEmployees: readonly NamedRefDto[];
  assignedTeam: NamedRefDto | null;
  reportStatus: PlannedWorkReportStatus | null;
  createdAt: string;
}

export interface PlannedWorkDto extends PlannedWorkListItemDto {
  description: string | null;
  updatedAt: string;
  /** Original deadline before any authorised reschedule. */
  originalPlannedEndDate: string;
  currentPauseStartedAt: string | null;
  totalPausedMinutes: number;
  pauseHistory: readonly PlannedWorkPauseDto[];
  scheduleHistory: readonly PlannedWorkScheduleChangeDto[];
  cancelReason: string | null;
  cancelledBy: ActorStampDto;
  archivedBy: ActorStampDto;
  tasks: readonly PlannedWorkTaskDto[];
  floorProgress: readonly PlannedWorkFloorProgressDto[];
  materials: readonly PlannedWorkMaterialDto[];
  report: PlannedWorkReportDto | null;
  /** Server-computed action list; the UI renders buttons only from this. */
  availableActions: readonly PlannedWorkAvailableActionDto[];
  /** Reasons COMPLETE is unavailable, when it is. */
  completionBlockers: readonly string[];
}

export interface PlannedWorkListQuery {
  page?: number;
  limit?: number;
  search?: string;
  customerId?: string;
  projectId?: string;
  buildingId?: string;
  employeeId?: string;
  teamId?: string;
  /** Filters on effective status, so OVERDUE is a selectable value here. */
  status?: PlannedWorkEffectiveStatus;
  reportStatus?: PlannedWorkReportStatus;
  from?: string;
  to?: string;
  /**
   * Includes ARCHIVED records, which the endpoint otherwise omits.
   *
   * The flag has always existed on the request schema; it was missing from this type,
   * so no client could ask for archived work without casting. A work is archived the
   * moment its report is approved, which made finished work unreachable from any list
   * that only knew about this interface.
   */
  includeArchived?: boolean;
  sortBy?: 'plannedStartDate' | 'plannedEndDate' | 'workNumber' | 'createdAt';
  sortDir?: 'asc' | 'desc';
}
