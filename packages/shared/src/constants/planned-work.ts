import { PERMISSIONS, type PermissionKey } from './permissions';

/**
 * Planned work vocabulary (requirements section 7).
 *
 * Two distinct status concepts exist and must not be conflated:
 *
 *   - the LIFECYCLE status, which is persisted and only ever changed through the
 *     central transition service;
 *   - the EFFECTIVE status, which the backend derives on read and which additionally
 *     reports OVERDUE.
 *
 * OVERDUE is never persisted as a lifecycle state and is never selectable by a user.
 */
export const PLANNED_WORK_LIFECYCLE_STATUSES = [
  'DRAFT',
  /**
   * Submitted by its creator and waiting on an authorised approver.
   *
   * EVERY work passes through here now, whoever raised it. There is no longer a path from
   * DRAFT to PLANNED that skips an approver: PLAN means "submit for approval" for staff and
   * customers alike, which is what makes the two workflows genuinely the same one rather
   * than two that happen to look alike.
   *
   * Nothing is assigned while a work sits here. The crew is chosen by the approver as part
   * of APPROVE, so a work reaching PLANNED and a work having a crew are the same event.
   */
  'PENDING_APPROVAL',
  /**
   * Returned to its creator with a reason, to be corrected and submitted again.
   *
   * A real state rather than a bare trip back to DRAFT, because "never submitted" and
   * "submitted and sent back" are different things to the person looking at the list, and
   * only the second one owes them an explanation. `cancelReason` carries it.
   */
  'REJECTED',
  'PLANNED',
  'STARTED',
  'PAUSED',
  'COMPLETED',
  'ARCHIVED',
  'CANCELLED',
] as const;
export type PlannedWorkLifecycleStatus = (typeof PLANNED_WORK_LIFECYCLE_STATUSES)[number];

export const PLANNED_WORK_EFFECTIVE_STATUSES = [
  ...PLANNED_WORK_LIFECYCLE_STATUSES,
  'OVERDUE',
] as const;
export type PlannedWorkEffectiveStatus = (typeof PLANNED_WORK_EFFECTIVE_STATUSES)[number];

export const PLANNED_WORK_STATUS_LABELS: Record<PlannedWorkEffectiveStatus, string> = {
  DRAFT: 'Төсөл',
  PENDING_APPROVAL: 'Хүлээгдэж буй',
  REJECTED: 'Буцаагдсан',
  PLANNED: 'Төлөвлөгдсөн',
  STARTED: 'Хэрэгжиж байна',
  PAUSED: 'Түр зогссон',
  OVERDUE: 'Хугацаа хэтэрсэн',
  COMPLETED: 'Дууссан',
  ARCHIVED: 'Архивласан',
  CANCELLED: 'Цуцлагдсан',
};

/**
 * Lifecycle states that can additionally read as OVERDUE.
 *
 * DRAFT is excluded because it has not been formally planned. COMPLETED, ARCHIVED and
 * CANCELLED are excluded because the work is no longer outstanding.
 */
export const OVERDUE_ELIGIBLE_LIFECYCLE_STATUSES: readonly PlannedWorkLifecycleStatus[] = [
  'PLANNED',
  'STARTED',
  'PAUSED',
];

export function isOverdueEligible(status: PlannedWorkLifecycleStatus): boolean {
  return OVERDUE_ELIGIBLE_LIFECYCLE_STATUSES.includes(status);
}

/**
 * Derives the effective status.
 *
 * The backend is the sole authority: it calls this with server time and publishes the
 * result as `effectiveStatus` on every DTO. The web client renders that field and must
 * not recompute it, otherwise a client with a skewed clock would disagree with the
 * dashboard and the calendar.
 */
export function effectivePlannedWorkStatus(
  lifecycleStatus: PlannedWorkLifecycleStatus,
  plannedEndDate: Date | string,
  now: Date,
): PlannedWorkEffectiveStatus {
  if (!isOverdueEligible(lifecycleStatus)) return lifecycleStatus;

  const end = plannedEndDate instanceof Date ? plannedEndDate : new Date(plannedEndDate);
  if (Number.isNaN(end.getTime())) return lifecycleStatus;

  return end.getTime() < now.getTime() ? 'OVERDUE' : lifecycleStatus;
}

// -- Tasks -------------------------------------------------------------------

export const PLANNED_WORK_TASK_STATUSES = ['PENDING', 'IN_PROGRESS', 'DONE', 'SKIPPED'] as const;
export type PlannedWorkTaskStatus = (typeof PLANNED_WORK_TASK_STATUSES)[number];

export const PLANNED_WORK_TASK_STATUS_LABELS: Record<PlannedWorkTaskStatus, string> = {
  PENDING: 'Хүлээгдэж байна',
  IN_PROGRESS: 'Хийгдэж байна',
  DONE: 'Дууссан',
  SKIPPED: 'Хийгдээгүй',
};

/**
 * Evidence a task must carry before it may be considered DONE.
 *
 * A task never reaches DONE because a user picked the status: it reaches DONE only
 * when the recorded quantity is complete AND every piece of evidence exists.
 */
export interface TaskEvidenceState {
  hasBeforePhoto: boolean;
  hasAfterPhoto: boolean;
  /** The performer's Тайлбар. Дүгнэлт belongs to the consolidated report, not here. */
  hasNote: boolean;
  hasRecommendation: boolean;
  /**
   * The 0-100 үнэлгээ, required for a task to be MOVED into DONE.
   *
   * The gate applies to the transition, not to the record: a sub-task that reached DONE
   * before the score was required keeps its status, because pulling finished work back
   * out would stall planned works that are already in flight. The caller decides that,
   * which is why this is a flag rather than a score lookup.
   */
  hasScore: boolean;
}

export const TASK_EVIDENCE_LABELS: Record<keyof TaskEvidenceState, string> = {
  hasBeforePhoto: 'Ажлын өмнөх зураг',
  hasAfterPhoto: 'Ажлын дараах зураг',
  hasNote: 'Тайлбар',
  hasRecommendation: 'Зөвлөмж',
  hasScore: 'Үнэлгээ',
};

export function missingTaskEvidence(evidence: TaskEvidenceState): string[] {
  return (Object.keys(TASK_EVIDENCE_LABELS) as (keyof TaskEvidenceState)[])
    .filter((key) => !evidence[key])
    .map((key) => TASK_EVIDENCE_LABELS[key]);
}

export function taskEvidenceComplete(evidence: TaskEvidenceState): boolean {
  return missingTaskEvidence(evidence).length === 0;
}

export interface DeriveTaskStatusInput {
  totalQuantity: number;
  completedQuantity: number;
  evidence: TaskEvidenceState;
  /** True once work has been reported as begun even though no quantity is complete. */
  explicitlyStarted: boolean;
  /** A deliberately skipped task keeps its status regardless of quantity. */
  skipped: boolean;
}

export function deriveTaskStatus(input: DeriveTaskStatusInput): PlannedWorkTaskStatus {
  if (input.skipped) return 'SKIPPED';

  if (input.totalQuantity > 0 && input.completedQuantity >= input.totalQuantity) {
    // Quantity alone is not enough; the evidence gate decides DONE.
    return taskEvidenceComplete(input.evidence) ? 'DONE' : 'IN_PROGRESS';
  }

  if (input.completedQuantity > 0) return 'IN_PROGRESS';
  return input.explicitlyStarted ? 'IN_PROGRESS' : 'PENDING';
}

// -- Quantity-based progress -------------------------------------------------

export interface QuantityProgress {
  totalQuantity: number;
  completedQuantity: number;
}

export interface ProgressSummary {
  totalQuantity: number;
  completedQuantity: number;
  remainingQuantity: number;
  progressPercent: number;
}

/**
 * Percentage of one quantity pair.
 *
 * Capped below 100 until the quantity is genuinely complete, so a nearly finished task
 * never displays as 100 percent and mislead a reviewer into approving it.
 */
export function progressPercentOf(totalQuantity: number, completedQuantity: number): number {
  if (totalQuantity <= 0) return 0;
  if (completedQuantity >= totalQuantity) return 100;
  if (completedQuantity <= 0) return 0;

  const raw = (completedQuantity / totalQuantity) * 100;
  return Math.min(99.9, Math.round(raw * 10) / 10);
}

/**
 * Quantity-weighted aggregation.
 *
 * Progress is the ratio of summed completed quantity to summed total quantity, not the
 * proportion of tasks marked done, so a large task cannot be outweighed by several
 * trivial ones.
 */
export function aggregateProgress(items: readonly QuantityProgress[]): ProgressSummary {
  let totalQuantity = 0;
  let completedQuantity = 0;

  for (const item of items) {
    totalQuantity += item.totalQuantity;
    completedQuantity += item.completedQuantity;
  }

  const bounded = Math.min(completedQuantity, totalQuantity);

  return {
    totalQuantity,
    completedQuantity,
    remainingQuantity: Math.max(0, totalQuantity - bounded),
    progressPercent: progressPercentOf(totalQuantity, bounded),
  };
}

// -- Report workflow ---------------------------------------------------------

export const PLANNED_WORK_REPORT_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'RETURNED',
] as const;
export type PlannedWorkReportStatus = (typeof PLANNED_WORK_REPORT_STATUSES)[number];

export const PLANNED_WORK_REPORT_STATUS_LABELS: Record<PlannedWorkReportStatus, string> = {
  DRAFT: 'Ноорог',
  SUBMITTED: 'Хянуулахаар илгээсэн',
  APPROVED: 'Батлагдсан',
  RETURNED: 'Буцаагдсан',
};

/** A report may be submitted from DRAFT or after being returned for correction. */
export const REPORT_SUBMITTABLE_STATUSES: readonly PlannedWorkReportStatus[] = [
  'DRAFT',
  'RETURNED',
];

// -- Lifecycle transitions ---------------------------------------------------

/**
 * The complete catalogue of user-initiated lifecycle actions.
 *
 * ARCHIVE is deliberately absent: archiving is a consequence of report approval, never
 * a standalone user action. OVERDUE is absent because it is not a lifecycle state.
 */
export const PLANNED_WORK_ACTIONS = [
  'PLAN',
  'APPROVE',
  'REJECT',
  'START',
  'PAUSE',
  'RESUME',
  'COMPLETE',
  'CANCEL',
] as const;
export type PlannedWorkAction = (typeof PLANNED_WORK_ACTIONS)[number];

export interface PlannedWorkActionRule {
  label: string;
  from: readonly PlannedWorkLifecycleStatus[];
  /** Null when the target depends on record state, as it does for RESUME. */
  to: PlannedWorkLifecycleStatus | null;
  requiresReason: boolean;
  permission: PermissionKey;
  /**
   * A second key that also admits the action, for the portal.
   *
   * Only PLAN carries one. A customer submitting their own draft is doing the same thing a
   * planner does, but `planned_work.change_status` is a staff key held by DISPATCH and
   * TECHNICIAN, so it cannot simply be granted to them. Holding this key is not by itself
   * enough — `transitionPlannedWork` additionally bounds a customer to their own record.
   */
  customerPermission?: PermissionKey;
  /**
   * The action assigns the crew and refuses to run without one.
   *
   * Only APPROVE. Approval and assignment are one decision here: the approver is agreeing
   * to do the work AND saying who does it, so a work cannot reach PLANNED unstaffed.
   */
  assignsCrew?: boolean;
}

export const PLANNED_WORK_ACTION_RULES: Record<PlannedWorkAction, PlannedWorkActionRule> = {
  /**
   * Submit for approval — the single entry to the approval gate, for everybody.
   *
   * THIS USED TO GO STRAIGHT TO PLANNED. It no longer does, and that is the point of the
   * change: staff and customers now follow one workflow, so a planner's own work is
   * reviewed on the same terms as a customer's request. REJECTED is in the from-list
   * because correcting a returned work and sending it back is the same act as sending it
   * the first time, and giving it a second action would only be a second name for one.
   */
  PLAN: {
    label: 'Төлөвлөх',
    from: ['DRAFT', 'REJECTED'],
    to: 'PENDING_APPROVAL',
    requiresReason: false,
    permission: PERMISSIONS.PLANNED_WORK_CHANGE_STATUS,
    customerPermission: PERMISSIONS.PORTAL_PLANNED_WORK_CREATE,
  },
  /**
   * Accept the request AND staff it, in one decision.
   *
   * The approver names the employees as part of approving, and the action is refused
   * without at least one. That is why PLANNED and "has a crew" are the same event: there
   * is no window in which work is approved but nobody is on it, and therefore no approved
   * work that quietly fails to reach anybody's list.
   *
   * `planned_work.approve` is a key of its own, deliberately not `change_status` — which
   * DISPATCH and TECHNICIAN both hold — and not `approve_report`, which means "sign off a
   * finished job's write-up". Committing the company to the work is a third thing.
   */
  APPROVE: {
    label: 'Батлах',
    from: ['PENDING_APPROVAL'],
    to: 'PLANNED',
    requiresReason: false,
    permission: PERMISSIONS.PLANNED_WORK_APPROVE,
    assignsCrew: true,
  },
  /**
   * Send it back to its creator with a reason, to be corrected and submitted again.
   *
   * IT USED TO LAND ON CANCELLED, justified at the time by "a customer cannot edit a
   * draft". They can now, so the reason that forced a dead end no longer holds and the
   * work returns to a state its author can actually act on. Refusing something outright is
   * still possible — CANCEL now reaches PENDING_APPROVAL and REJECTED — so nothing is lost
   * by making the ordinary case a return rather than a refusal.
   */
  REJECT: {
    label: 'Буцаах',
    from: ['PENDING_APPROVAL'],
    to: 'REJECTED',
    requiresReason: true,
    permission: PERMISSIONS.PLANNED_WORK_APPROVE,
  },
  START: {
    label: 'Ажил эхлүүлэх',
    from: ['PLANNED'],
    to: 'STARTED',
    requiresReason: false,
    permission: PERMISSIONS.PLANNED_WORK_CHANGE_STATUS,
  },
  PAUSE: {
    label: 'Түр зогсоох',
    from: ['PLANNED', 'STARTED'],
    to: 'PAUSED',
    requiresReason: true,
    permission: PERMISSIONS.PLANNED_WORK_CHANGE_STATUS,
  },
  RESUME: {
    label: 'Үргэлжлүүлэх',
    from: ['PAUSED'],
    // PLANNED when the work never actually started, STARTED when it did.
    to: null,
    requiresReason: false,
    permission: PERMISSIONS.PLANNED_WORK_CHANGE_STATUS,
  },
  COMPLETE: {
    label: 'Дуусгах',
    from: ['STARTED'],
    to: 'COMPLETED',
    requiresReason: false,
    permission: PERMISSIONS.PLANNED_WORK_CHANGE_STATUS,
  },
  CANCEL: {
    label: 'Цуцлах',
    from: ['DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'PLANNED', 'STARTED', 'PAUSED'],
    to: 'CANCELLED',
    requiresReason: true,
    permission: PERMISSIONS.PLANNED_WORK_CANCEL,
  },
};

/**
 * Resume target. Pausing never rewrites the schedule, so resuming only restores the
 * lifecycle state the work would have been in.
 */
export function resumeTargetStatus(hasActualStartDate: boolean): PlannedWorkLifecycleStatus {
  return hasActualStartDate ? 'STARTED' : 'PLANNED';
}

export function isTerminalLifecycleStatus(status: PlannedWorkLifecycleStatus): boolean {
  return status === 'ARCHIVED' || status === 'CANCELLED';
}
