/**
 * Stages — the coarse workflow an operator actually thinks in.
 *
 * The engine keeps its fourteen internal statuses because they carry behaviour:
 * `ON_SITE` is what lets a technician write a conclusion, `UNASSIGNED` is what puts a
 * job back in the claim pool, `COMPLETED` is what stamps the finish time and issues the
 * satisfaction survey. Those are roles, not labels, and collapsing them in the database
 * would delete the distinctions the rules are made of.
 *
 * What an operator sees is a different question. Fourteen chips on a board is noise when
 * the business only recognises nine steps, so a stage groups one or more statuses under
 * one name and one colour. Grouping is presentation and control; it never changes what a
 * request *is*.
 *
 * Two consequences worth stating, because both are deliberate:
 *
 * - Moving a request to a stage means moving it to that stage's `entryStatus`, and the
 *   server walks the legal path to get there. Every hop is still written to the status
 *   history, so the audit trail records what actually happened rather than the summary.
 * - A stage that groups several statuses hides progress *within* itself. Grouping
 *   `REPORT_SUBMITTED`, `VERIFICATION` and `COMPLETED` means a customer reads "Дууссан"
 *   from the moment the technician files the conclusion, while the completion
 *   notification and the rating request still wait for the office to approve it. That is
 *   the administrator's call to make, and this file will not second-guess it.
 */

import { SERVICE_REQUEST_STATUSES, type ServiceRequestStatus } from './service-request';

/**
 * A closed palette rather than free hex.
 *
 * Every surface that paints a stage — Tailwind classes on the web, `Tone` values in the
 * two Flutter apps, fills in the portal charts — resolves a name to its own idea of that
 * colour. Tailwind in particular compiles its classes at build time and cannot construct
 * one from a runtime string, so an arbitrary hex simply would not render.
 */
export const STAGE_COLOURS = [
  'grey',
  'blue',
  'indigo',
  'amber',
  'orange',
  'green',
  'red',
] as const;

export type StageColour = (typeof STAGE_COLOURS)[number];

export interface ServiceRequestStage {
  /** Stable identifier. Survives renaming, so saved filters keep working. */
  readonly key: string;
  readonly label: string;
  readonly colour: StageColour;
  /**
   * The engine statuses this stage covers. Every status belongs to exactly one stage —
   * a request must always have somewhere to appear.
   */
  readonly statuses: readonly ServiceRequestStatus[];
  /**
   * The status a request is moved to when someone selects this stage. Must be one of
   * `statuses`. The rest of the group is reachable from inside — `VERIFICATION` and
   * `COMPLETED` are reached by approving the conclusion, not by picking them.
   */
  readonly entryStatus: ServiceRequestStatus;
  /** Hidden stages stay out of filters and pickers, but never out of history. */
  readonly hidden: boolean;
  /**
   * Whether the stage gets a column on the dispatch board.
   *
   * Separate from `hidden` because the two answer different questions. Cancelled work
   * should still be findable in a filter — that is a legitimate thing to look for — while
   * a column of dead jobs on a board about what to do next is only noise.
   */
  readonly onBoard: boolean;
}

/**
 * The shipped default: the nine steps the business recognises.
 *
 * `CANCELLED` stands alone at the end. It is not part of the working flow — it stops the
 * SLA clock, drops off the dispatch board and is excluded from customer reporting — so
 * folding it into another stage would make a cancelled job read as an active one.
 */
export const DEFAULT_SERVICE_REQUEST_STAGES: readonly ServiceRequestStage[] = [
  {
    key: 'OPEN',
    label: 'Нээлттэй',
    colour: 'grey',
    statuses: ['NEW', 'UNASSIGNED'],
    entryStatus: 'UNASSIGNED',
    hidden: false,
    onBoard: true,
  },
  {
    key: 'ASSIGNED',
    label: 'Хуваарилагдсан',
    colour: 'blue',
    statuses: ['ASSIGNED', 'ACCEPTED'],
    entryStatus: 'ASSIGNED',
    hidden: false,
    onBoard: true,
  },
  {
    key: 'ON_THE_WAY',
    label: 'Замдаа',
    colour: 'indigo',
    statuses: ['ON_THE_WAY'],
    entryStatus: 'ON_THE_WAY',
    hidden: false,
    onBoard: true,
  },
  {
    key: 'IN_PROGRESS',
    label: 'Гүйцэтгэж байна',
    colour: 'amber',
    statuses: ['ON_SITE', 'IN_PROGRESS'],
    entryStatus: 'ON_SITE',
    hidden: false,
    onBoard: true,
  },
  {
    key: 'WAITING',
    label: 'Түр хүлээгдсэн',
    colour: 'orange',
    statuses: ['WAITING'],
    entryStatus: 'WAITING',
    hidden: false,
    onBoard: true,
  },
  {
    key: 'COMPLETED',
    label: 'Дууссан',
    colour: 'green',
    statuses: ['REPORT_SUBMITTED', 'VERIFICATION', 'COMPLETED'],
    entryStatus: 'REPORT_SUBMITTED',
    hidden: false,
    onBoard: true,
  },
  {
    key: 'REVISIT',
    label: 'Дахин очих',
    colour: 'orange',
    statuses: ['REVISIT_REQUIRED'],
    entryStatus: 'REVISIT_REQUIRED',
    hidden: false,
    onBoard: true,
  },
  {
    key: 'RETURNED',
    label: 'Буцаасан',
    colour: 'red',
    statuses: ['RETURNED'],
    entryStatus: 'RETURNED',
    hidden: false,
    onBoard: true,
  },
  {
    key: 'CANCELLED',
    label: 'Цуцалсан',
    colour: 'grey',
    statuses: ['CANCELLED'],
    entryStatus: 'CANCELLED',
    hidden: false,
    onBoard: false,
  },
];

/** The stage a status belongs to, or null when the configuration does not cover it. */
export function stageOfStatus(
  status: ServiceRequestStatus,
  stages: readonly ServiceRequestStage[],
): ServiceRequestStage | null {
  return stages.find((stage) => stage.statuses.includes(status)) ?? null;
}

export function stageByKey(
  key: string,
  stages: readonly ServiceRequestStage[],
): ServiceRequestStage | null {
  return stages.find((stage) => stage.key === key) ?? null;
}

/**
 * Faults in a proposed configuration, as messages an administrator can act on.
 *
 * Returned rather than thrown so the settings form can mark every problem at once, which
 * is the convention `validateSettings` already follows.
 */
export function validateStages(stages: readonly ServiceRequestStage[]): string[] {
  const issues: string[] = [];

  if (stages.length === 0) {
    issues.push('Дор хаяж нэг үе шат тодорхойлно.');
    return issues;
  }

  const seenKeys = new Set<string>();
  for (const stage of stages) {
    if (!stage.key.trim()) issues.push('Үе шатны түлхүүр хоосон байна.');
    if (seenKeys.has(stage.key)) issues.push(`«${stage.key}» түлхүүр давхардсан байна.`);
    seenKeys.add(stage.key);

    if (!stage.label.trim()) issues.push(`«${stage.key}» үе шатны нэр хоосон байна.`);
    if (stage.statuses.length === 0) {
      issues.push(`«${stage.label || stage.key}» үе шатанд ямар ч төлөв хамаарахгүй байна.`);
    }
    if (!stage.statuses.includes(stage.entryStatus)) {
      issues.push(
        `«${stage.label || stage.key}» үе шатны эхлэх төлөв нь өөрийнх нь төлвүүдэд байхгүй байна.`,
      );
    }
  }

  // Every engine status must land in exactly one stage: none orphaned, none duplicated.
  const owner = new Map<ServiceRequestStatus, string>();
  for (const stage of stages) {
    for (const status of stage.statuses) {
      const existing = owner.get(status);
      if (existing) {
        issues.push(`«${status}» төлөв «${existing}» ба «${stage.key}» хоёуланд нь орсон байна.`);
        continue;
      }
      owner.set(status, stage.key);
    }
  }
  for (const status of SERVICE_REQUEST_STATUSES) {
    if (!owner.has(status)) {
      issues.push(`«${status}» төлөв ямар ч үе шатанд хамаарахгүй байна.`);
    }
  }

  return issues;
}
