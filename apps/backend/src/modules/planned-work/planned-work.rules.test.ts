import {
  PLANNED_WORK_ACTION_RULES,
  aggregateProgress,
  deriveTaskStatus,
  effectivePlannedWorkStatus,
  isOverdueEligible,
  missingTaskEvidence,
  progressPercentOf,
  resumeTargetStatus,
  taskEvidenceComplete,
  type TaskEvidenceState,
} from '@monhorus/shared';
import { describe, expect, it } from 'vitest';

const COMPLETE_EVIDENCE: TaskEvidenceState = {
  hasBeforePhoto: true,
  hasAfterPhoto: true,
  hasNote: true,
  hasRecommendation: true,
  hasScore: true,
};

describe('effective planned work status', () => {
  const past = new Date('2026-07-01T00:00:00.000Z');
  const now = new Date('2026-07-15T00:00:00.000Z');
  const future = new Date('2026-08-01T00:00:00.000Z');

  it('reports OVERDUE for an outstanding work past its deadline', () => {
    expect(effectivePlannedWorkStatus('PLANNED', past, now)).toBe('OVERDUE');
    expect(effectivePlannedWorkStatus('STARTED', past, now)).toBe('OVERDUE');
  });

  it('reports OVERDUE for a paused work, because pausing does not move the deadline', () => {
    expect(effectivePlannedWorkStatus('PAUSED', past, now)).toBe('OVERDUE');
  });

  it('leaves DRAFT alone, because it has not been formally planned', () => {
    expect(effectivePlannedWorkStatus('DRAFT', past, now)).toBe('DRAFT');
  });

  it('never reports OVERDUE for a settled work', () => {
    expect(effectivePlannedWorkStatus('COMPLETED', past, now)).toBe('COMPLETED');
    expect(effectivePlannedWorkStatus('ARCHIVED', past, now)).toBe('ARCHIVED');
    expect(effectivePlannedWorkStatus('CANCELLED', past, now)).toBe('CANCELLED');
  });

  it('returns the lifecycle status while the deadline is still ahead', () => {
    expect(effectivePlannedWorkStatus('STARTED', future, now)).toBe('STARTED');
  });

  it('marks exactly the three outstanding statuses as overdue eligible', () => {
    expect(isOverdueEligible('PLANNED')).toBe(true);
    expect(isOverdueEligible('STARTED')).toBe(true);
    expect(isOverdueEligible('PAUSED')).toBe(true);
    expect(isOverdueEligible('DRAFT')).toBe(false);
    expect(isOverdueEligible('COMPLETED')).toBe(false);
    expect(isOverdueEligible('ARCHIVED')).toBe(false);
    expect(isOverdueEligible('CANCELLED')).toBe(false);
  });
});

describe('quantity based progress', () => {
  it('computes a task percentage from quantity, not from task count', () => {
    expect(progressPercentOf(200, 50)).toBe(25);
    expect(progressPercentOf(3, 1)).toBe(33.3);
  });

  it('reports 100 only when the quantity is genuinely complete', () => {
    expect(progressPercentOf(1000, 999)).toBe(99.9);
    expect(progressPercentOf(1000, 1000)).toBe(100);
  });

  it('treats a zero total as zero progress rather than dividing by zero', () => {
    expect(progressPercentOf(0, 0)).toBe(0);
  });

  it('weights the rollup by quantity so a large task is not outvoted', () => {
    // One large untouched task plus two small finished ones: two of three tasks are
    // done, but only a tenth of the actual quantity is.
    const summary = aggregateProgress([
      { totalQuantity: 180, completedQuantity: 0 },
      { totalQuantity: 10, completedQuantity: 10 },
      { totalQuantity: 10, completedQuantity: 10 },
    ]);

    expect(summary.totalQuantity).toBe(200);
    expect(summary.completedQuantity).toBe(20);
    expect(summary.remainingQuantity).toBe(180);
    expect(summary.progressPercent).toBe(10);
  });

  it('derives remaining quantity rather than trusting a stored value', () => {
    const summary = aggregateProgress([{ totalQuantity: 40, completedQuantity: 15 }]);
    expect(summary.remainingQuantity).toBe(25);
  });

  it('returns zero for an empty task set', () => {
    expect(aggregateProgress([])).toEqual({
      totalQuantity: 0,
      completedQuantity: 0,
      remainingQuantity: 0,
      progressPercent: 0,
    });
  });
});

describe('task status derivation', () => {
  it('is PENDING when nothing is complete and nothing was started', () => {
    expect(
      deriveTaskStatus({
        totalQuantity: 10,
        completedQuantity: 0,
        evidence: COMPLETE_EVIDENCE,
        explicitlyStarted: false,
        skipped: false,
      }),
    ).toBe('PENDING');
  });

  it('is IN_PROGRESS when explicitly started with no quantity yet', () => {
    expect(
      deriveTaskStatus({
        totalQuantity: 10,
        completedQuantity: 0,
        evidence: COMPLETE_EVIDENCE,
        explicitlyStarted: true,
        skipped: false,
      }),
    ).toBe('IN_PROGRESS');
  });

  it('is IN_PROGRESS for a partial quantity', () => {
    expect(
      deriveTaskStatus({
        totalQuantity: 10,
        completedQuantity: 4,
        evidence: COMPLETE_EVIDENCE,
        explicitlyStarted: false,
        skipped: false,
      }),
    ).toBe('IN_PROGRESS');
  });

  it('is DONE at full quantity with complete evidence', () => {
    expect(
      deriveTaskStatus({
        totalQuantity: 10,
        completedQuantity: 10,
        evidence: COMPLETE_EVIDENCE,
        explicitlyStarted: true,
        skipped: false,
      }),
    ).toBe('DONE');
  });

  it('refuses DONE at full quantity when evidence is missing', () => {
    expect(
      deriveTaskStatus({
        totalQuantity: 10,
        completedQuantity: 10,
        evidence: { ...COMPLETE_EVIDENCE, hasAfterPhoto: false },
        explicitlyStarted: true,
        skipped: false,
      }),
    ).toBe('IN_PROGRESS');

    expect(
      deriveTaskStatus({
        totalQuantity: 10,
        completedQuantity: 10,
        evidence: { ...COMPLETE_EVIDENCE, hasRecommendation: false },
        explicitlyStarted: true,
        skipped: false,
      }),
    ).toBe('IN_PROGRESS');
  });

  it('refuses DONE at full quantity when the үнэлгээ is missing', () => {
    expect(
      deriveTaskStatus({
        totalQuantity: 10,
        completedQuantity: 10,
        evidence: { ...COMPLETE_EVIDENCE, hasScore: false },
        explicitlyStarted: true,
        skipped: false,
      }),
    ).toBe('IN_PROGRESS');
  });

  it('keeps SKIPPED regardless of quantity', () => {
    expect(
      deriveTaskStatus({
        totalQuantity: 10,
        completedQuantity: 10,
        evidence: COMPLETE_EVIDENCE,
        explicitlyStarted: true,
        skipped: true,
      }),
    ).toBe('SKIPPED');
  });
});

describe('task evidence', () => {
  it('names every missing item in Mongolian', () => {
    const missing = missingTaskEvidence({
      hasBeforePhoto: false,
      hasAfterPhoto: false,
      hasNote: false,
      hasRecommendation: false,
      hasScore: false,
    });

    expect(missing).toEqual([
      'Ажлын өмнөх зураг',
      'Ажлын дараах зураг',
      'Тайлбар',
      'Зөвлөмж',
      'Үнэлгээ',
    ]);
  });

  it('is complete only when all five items exist', () => {
    expect(taskEvidenceComplete(COMPLETE_EVIDENCE)).toBe(true);
    expect(taskEvidenceComplete({ ...COMPLETE_EVIDENCE, hasNote: false })).toBe(false);
    expect(taskEvidenceComplete({ ...COMPLETE_EVIDENCE, hasScore: false })).toBe(false);
  });
});

describe('lifecycle transition matrix', () => {
  it('allows only the documented source statuses per action', () => {
    expect(PLANNED_WORK_ACTION_RULES.PLAN.from).toEqual(['DRAFT', 'REJECTED']);
    expect(PLANNED_WORK_ACTION_RULES.APPROVE.from).toEqual(['PENDING_APPROVAL']);
    expect(PLANNED_WORK_ACTION_RULES.REJECT.from).toEqual(['PENDING_APPROVAL']);
    expect(PLANNED_WORK_ACTION_RULES.START.from).toEqual(['PLANNED']);
    expect(PLANNED_WORK_ACTION_RULES.PAUSE.from).toEqual(['PLANNED', 'STARTED']);
    expect(PLANNED_WORK_ACTION_RULES.RESUME.from).toEqual(['PAUSED']);
    expect(PLANNED_WORK_ACTION_RULES.COMPLETE.from).toEqual(['STARTED']);
    expect(PLANNED_WORK_ACTION_RULES.CANCEL.from).toEqual([
      'DRAFT',
      'PENDING_APPROVAL',
      'REJECTED',
      'PLANNED',
      'STARTED',
      'PAUSED',
    ]);
  });

  /**
   * The shape of the workflow, asserted as a chain rather than as three separate facts.
   * Nothing reaches PLANNED without passing an approver: PLAN stops at PENDING_APPROVAL and
   * only APPROVE goes further. A gap here would be a way to skip review entirely.
   */
  it('routes everything to PLANNED through an approver', () => {
    expect(PLANNED_WORK_ACTION_RULES.PLAN.to).toBe('PENDING_APPROVAL');
    expect(PLANNED_WORK_ACTION_RULES.APPROVE.to).toBe('PLANNED');

    const toPlanned = Object.entries(PLANNED_WORK_ACTION_RULES)
      .filter(([, rule]) => rule.to === 'PLANNED')
      .map(([action]) => action);
    expect(toPlanned).toEqual(['APPROVE']);
  });

  /** A refusal hands the work back to its creator; it no longer ends the record. */
  it('returns a rejected work to its creator rather than cancelling it', () => {
    expect(PLANNED_WORK_ACTION_RULES.REJECT.to).toBe('REJECTED');
    expect(PLANNED_WORK_ACTION_RULES.REJECT.requiresReason).toBe(true);
    // ...and a returned work can be sent back for approval by the same action that first
    // submitted it, so there is no state a creator can be stranded in.
    expect(PLANNED_WORK_ACTION_RULES.PLAN.from).toContain('REJECTED');
  });

  /** Approval and staffing are one decision — see `assignsCrew`. */
  it('assigns the crew on approval and on no other action', () => {
    const assigning = Object.entries(PLANNED_WORK_ACTION_RULES)
      .filter(([, rule]) => rule.assignsCrew)
      .map(([action]) => action);
    expect(assigning).toEqual(['APPROVE']);
  });

  it('requires a reason for pausing and cancelling only', () => {
    expect(PLANNED_WORK_ACTION_RULES.PAUSE.requiresReason).toBe(true);
    expect(PLANNED_WORK_ACTION_RULES.CANCEL.requiresReason).toBe(true);
    expect(PLANNED_WORK_ACTION_RULES.START.requiresReason).toBe(false);
    expect(PLANNED_WORK_ACTION_RULES.RESUME.requiresReason).toBe(false);
  });

  it('offers no action that can produce an ARCHIVED or OVERDUE state', () => {
    const targets = Object.values(PLANNED_WORK_ACTION_RULES).map((rule) => rule.to);
    expect(targets).not.toContain('ARCHIVED');
    expect(targets).not.toContain('OVERDUE');
  });

  it('resumes to STARTED when the work had actually begun, PLANNED when it had not', () => {
    expect(resumeTargetStatus(true)).toBe('STARTED');
    expect(resumeTargetStatus(false)).toBe('PLANNED');
  });
});
