import {
  slaConfigOf,
  defaultSettings,
  type ServiceRequestStatus,
  type SlaConfig,
  type SlaState,
} from '@monhorus/shared';

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

export function slaWindowHours(isUrgent: boolean, config: SlaConfig = defaultSlaConfig()): number {
  return isUrgent ? config.urgentHours : config.standardHours;
}

export function computeSlaDueAt(
  startedAt: Date,
  isUrgent: boolean,
  extensionMinutes = 0,
  config: SlaConfig = defaultSlaConfig(),
): Date {
  const windowMs = slaWindowHours(isUrgent, config) * 60 * 60 * 1000;
  return new Date(startedAt.getTime() + windowMs + extensionMinutes * 60 * 1000);
}

const TERMINAL_STATUSES: readonly ServiceRequestStatus[] = ['COMPLETED', 'CANCELLED'];

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

  if (TERMINAL_STATUSES.includes(status)) {
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
