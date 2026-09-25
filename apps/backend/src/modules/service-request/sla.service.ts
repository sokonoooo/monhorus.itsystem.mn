import {
  slaConfigOf,
  defaultSettings,
  type ServiceRequestStatus,
  type SlaConfig,
  type SlaState,
} from '@monhorus/shared';
import type { FilterQuery } from 'mongoose';

import {
  TERMINAL_SERVICE_REQUEST_STATUS_LIST,
  isTerminalServiceRequestStatus,
} from './service-request.terminality';

/**
 * SLA engine. The backend is the sole authority for deadlines and states; the web
 * client only renders a countdown from the deadline this module produces.
 *
 * Requirements section 8.1 and rule 17.10 fix the defaults at 6 hours for an urgent call
 * and 24 for a standard one, and section 16.1 makes both configurable. The configuration
 * is passed in rather than read here, so these functions stay pure: a test can exercise a
 * non-default window without a database, and one request resolves the settings once
 * instead of per computation.
 */

/** Falls back to the catalogue defaults, for callers with no settings context. */
export function defaultSlaConfig(): SlaConfig {
  return slaConfigOf(defaultSettings());
}

/**
 * The window a call gets, in hours.
 *
 * `equipmentSlaHours` is the equipment type's own figure and wins outright when present: a
 * light is a day, an automatic socket six hours, and urgency does NOT shorten either. That
 * is the rule as specified - the urgent flag orders the queue, it does not move the
 * deadline - and it is why `isUrgent` is consulted only in its absence.
 *
 * The absence case is not a fallback for new work. Every new call names an equipment type,
 * so a null here means a call raised before types carried hours, and those keep the
 * urgent/standard window they were created under.
 */
export function slaWindowHours(
  isUrgent: boolean,
  config: SlaConfig = defaultSlaConfig(),
  equipmentSlaHours: number | null = null,
): number {
  if (equipmentSlaHours !== null) return equipmentSlaHours;
  return isUrgent ? config.urgentHours : config.standardHours;
}

export function computeSlaDueAt(
  startedAt: Date,
  isUrgent: boolean,
  extensionMinutes = 0,
  config: SlaConfig = defaultSlaConfig(),
  equipmentSlaHours: number | null = null,
): Date {
  const windowMs = slaWindowHours(isUrgent, config, equipmentSlaHours) * 60 * 60 * 1000;
  return new Date(startedAt.getTime() + windowMs + extensionMinutes * 60 * 1000);
}

export interface SlaEvaluation {
  state: SlaState;
  remainingMinutes: number | null;
}

/**
 * Evaluates the SLA position of a request.
 *
 * For a finished request the outcome is historical: WITHIN_SLA when it completed
 * before the deadline, LATE when it did not. For a live request the state escalates
 * STARTED -> NEAR_BREACH -> AT_RISK -> BREACHED as the window is consumed.
 */
export function evaluateSla(params: {
  status: ServiceRequestStatus;
  isUrgent: boolean;
  slaStartedAt: Date | null;
  slaDueAt: Date | null;
  completedAt: Date | null;
  now?: Date;
  config?: SlaConfig;
}): SlaEvaluation {
  const { status, slaStartedAt, slaDueAt, completedAt } = params;
  const now = params.now ?? new Date();
  const config = params.config ?? defaultSlaConfig();

  if (!slaStartedAt || !slaDueAt) {
    return { state: 'STARTED', remainingMinutes: null };
  }

  if (isTerminalServiceRequestStatus(status)) {
    if (status === 'CANCELLED') {
      return { state: 'STARTED', remainingMinutes: null };
    }
    const finishedAt = completedAt ?? now;
    return {
      state: finishedAt.getTime() <= slaDueAt.getTime() ? 'WITHIN_SLA' : 'LATE',
      remainingMinutes: Math.round((slaDueAt.getTime() - finishedAt.getTime()) / 60000),
    };
  }

  const remainingMs = slaDueAt.getTime() - now.getTime();
  const remainingMinutes = Math.round(remainingMs / 60000);

  if (remainingMs <= 0) {
    return { state: 'BREACHED', remainingMinutes };
  }

  const totalMs = slaDueAt.getTime() - slaStartedAt.getTime();
  const consumedRatio = totalMs > 0 ? (totalMs - remainingMs) / totalMs : 0;

  if (consumedRatio >= config.atRiskRatio) {
    return { state: 'AT_RISK', remainingMinutes };
  }
  if (consumedRatio >= config.nearBreachRatio) {
    return { state: 'NEAR_BREACH', remainingMinutes };
  }

  return { state: 'STARTED', remainingMinutes };
}

// -- "SLA зөрчил", answered once -----------------------------------------------

/**
 * The statuses whose SLA verdict is VOID rather than met or missed.
 *
 * Only CANCELLED, and it is named rather than derived because the reason is not
 * "it cannot move any more" — COMPLETED cannot move either — but "nobody ever owed this
 * work". A withdrawn call has no delivery to be late for, so it is neither within SLA nor
 * in breach. [evaluateSla] already takes this position by returning STARTED for CANCELLED
 * instead of a verdict, and this list is that decision written where a count can read it.
 */
const SLA_VOID_STATUSES: readonly ServiceRequestStatus[] = ['CANCELLED'];

/** Terminal minus void: the request finished, so its SLA has a final historical verdict. */
const SLA_SETTLED_STATUS_LIST: ServiceRequestStatus[] = TERMINAL_SERVICE_REQUEST_STATUS_LIST.filter(
  (status) => !SLA_VOID_STATUSES.includes(status),
);

/** The fields a breach verdict is drawn from, and the only ones. */
export interface SlaBreachSubject {
  status: ServiceRequestStatus;
  slaDueAt: Date | null;
  completedAt: Date | null;
}

/**
 * ONE DEFINITION OF "SLA зөрчил", FOR THREE SCREENS.
 *
 * The KPI tile, the 15.2 SLA report and the dashboard counter each carried their own
 * version of this test and each returned a different number for the same database. The KPI
 * and the report called every cancelled request a permanent breach — a cancellation never
 * writes `completedAt`, so `completedAt == null && slaDueAt < now` stayed true forever —
 * while the dashboard counted only work that is open and past due and forgot every breach
 * that had since been completed. The rule below is the single answer all three now use.
 *
 * WHAT COUNTS AS OPEN. Any status that is not terminal, i.e. one the lifecycle matrix
 * still gives somewhere to go: NEW through VERIFICATION, and also RETURNED and
 * REVISIT_REQUIRED, which look finished on a board but are live work with a live clock.
 * Openness is read from [isTerminalServiceRequestStatus] rather than from a hand-written
 * list, so a status that becomes terminal later is picked up without anybody remembering.
 *
 * WHAT COUNTS AS COMPLETED. Terminal and not void — today exactly COMPLETED. Its verdict
 * is historical and permanent: it does not change again as the clock moves.
 *
 * WHAT `completedAt` DOES. It supplies the settlement instant, and only for a settled
 * request; it is never what decides whether the request is settled. That inversion is the
 * old bug. When a settled request somehow carries no `completedAt`, `now` stands in for it,
 * exactly as [evaluateSla] does with `completedAt ?? now`. For an open request `completedAt`
 * is ignored outright — COMPLETED has no outgoing transition, so an open request with a
 * settlement stamp is not a state this lifecycle can produce.
 *
 * CANCELLED, REJECTED, ARCHIVED. CANCELLED is void: never a breach, whatever the deadline
 * says. There is no REJECTED status in this lifecycle; the nearest is RETURNED, which is a
 * write-up sent back for rework and therefore still open, and still accruing breach.
 * There is no archived service request either — archival in this codebase is an `isActive`
 * flag on objects and projects, not a request state — so a request under an archived
 * project keeps counting exactly like any other.
 *
 * NOW OR SETTLEMENT TIME. Both, each where it belongs. A settled request is judged against
 * the moment it actually settled, so its verdict is stable history. An open one is judged
 * against `now`, so it becomes a breach the instant the deadline passes.
 *
 * NULL `slaDueAt` IS NOT A BREACH, AND IS NOT REACHABLE. `slaDueAt` is `required: true` on
 * the model, so no stored request lacks one. The guard is kept because the field is
 * nullable in the DTO types the report rows are built from, and because a silent BSON rule
 * would otherwise decide the answer: in an aggregation `$lt: ['$slaDueAt', now]` is TRUE
 * for a missing field, since a missing path sorts below every date. The guard has to fold
 * missing and null together with `$ifNull` to hold — a plain `$ne: ['$slaDueAt', null]`
 * lets a missing field through, which it did, and the pipeline then counted a request the
 * predicate did not: exactly the kind of divergence this file exists to end.
 *
 * THE ASYMMETRY AT THE DEADLINE IS DELIBERATE AND PRESERVED. A request completed at
 * precisely `slaDueAt` is WITHIN_SLA (`finishedAt <= slaDueAt`), while an open one due at
 * precisely `now` is BREACHED (`remainingMs <= 0`). Both readings come straight from
 * [evaluateSla]: delivering on the dot is delivering on time, but a live clock that has run
 * out has run out. The three call sites all used a strict `>` on the live side, which
 * disagreed with `evaluateSla` for exactly one instant; they now agree.
 *
 * [slaBreachExpr] and [slaBreachFilter] are the Mongo restatements of this function. They
 * live directly below it and must be changed with it — `slaBreachAgreement` in the tests
 * runs the same table of cases through all three.
 */
export function isSlaBreached(subject: SlaBreachSubject, now: Date = new Date()): boolean {
  const { status, slaDueAt, completedAt } = subject;
  if (!slaDueAt) return false;
  if (SLA_VOID_STATUSES.includes(status)) return false;
  if (isTerminalServiceRequestStatus(status)) {
    return (completedAt ?? now).getTime() > slaDueAt.getTime();
  }
  return slaDueAt.getTime() <= now.getTime();
}

/**
 * [isSlaBreached] as an aggregation expression, for a `$cond` inside a `$group`.
 *
 * The null guard leads, because a missing `slaDueAt` would otherwise compare below `now`
 * and be counted as breached — see the null note on [isSlaBreached]. `$not` is written in
 * its array form, which every server version accepts.
 */
export function slaBreachExpr(now: Date): Record<string, unknown> {
  // `$ifNull` rather than a bare `$slaDueAt`: it is the one operator that folds a MISSING
  // field and an explicit null into the same value. `{ $ne: ['$slaDueAt', null] }` does
  // not — a missing path sorts below null, so the guard passed and the deadline-less
  // request then compared below `now` and was counted. Normalising once, at the top, is
  // what makes the guard below actually hold.
  const dueAt = { $ifNull: ['$slaDueAt', null] };
  return {
    $and: [
      { $ne: [dueAt, null] },
      {
        $or: [
          {
            $and: [
              { $in: ['$status', SLA_SETTLED_STATUS_LIST] },
              { $gt: [{ $ifNull: ['$completedAt', now] }, dueAt] },
            ],
          },
          {
            $and: [
              { $not: [{ $in: ['$status', TERMINAL_SERVICE_REQUEST_STATUS_LIST] }] },
              { $lte: [dueAt, now] },
            ],
          },
        ],
      },
    ],
  };
}

/**
 * [isSlaBreached] as a find/count filter.
 *
 * Deliberately not `{ $expr: slaBreachExpr(now) }`: the open branch is by far the larger
 * one and written this way it still uses the `{ slaDueAt: 1, status: 1 }` index, where a
 * whole-document `$expr` would scan the collection. `slaDueAt: { $lte: now }` needs no null
 * guard of its own — a range query on a Date is type-bracketed and cannot match a missing
 * or null field, which is the one place the query language and the aggregation language
 * disagree and the reason these two forms are written side by side.
 *
 * The result is an `$or`, so a caller combining it with a scope must use `$and` rather than
 * a spread. `withScope` in the dashboard already does.
 */
export function slaBreachFilter<T>(now: Date): FilterQuery<T> {
  return {
    $or: [
      { status: { $nin: TERMINAL_SERVICE_REQUEST_STATUS_LIST }, slaDueAt: { $lte: now } },
      {
        status: { $in: SLA_SETTLED_STATUS_LIST },
        slaDueAt: { $ne: null },
        $expr: { $gt: [{ $ifNull: ['$completedAt', now] }, '$slaDueAt'] },
      },
    ],
  } as FilterQuery<T>;
}
