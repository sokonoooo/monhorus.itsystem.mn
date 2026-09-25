import { logger } from '../config/logger';
import { runUnclaimedSweep } from '../modules/service-request/unclaimed.service';

/**
 * The unclaimed-work sweep.
 *
 * Runs every five minutes rather than every thirty: a reminder is due when the request
 * reaches its threshold, not when the job happens to look, so an interval matching the
 * reminder gap would delay each one by up to a full gap and let the schedule drift. Five
 * minutes bounds the lateness at five minutes while keeping the sweep cheap — it reads only
 * rows that are open, past the first threshold, and not yet capped.
 *
 * NOT the thing that decides how often a request is chased. The sweep sends at most one
 * reminder per request per pass and works out due times from the request's own open stamp,
 * so this interval can be retuned without changing anyone's notification cadence.
 *
 * Deliberately the same plain-interval mechanism as the overdue reconciliation, for the
 * same reasons: the sweep is idempotent, a missed tick is corrected by the next one, and a
 * scheduler dependency would buy nothing. Rerun-safety lives in the sweep itself, which
 * stakes each reminder with an atomic write before sending it, so overlapping ticks — or
 * two server instances — cannot produce a duplicate notification.
 */
export const UNCLAIMED_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;

export function startUnclaimedWorkJob(): void {
  if (timer) return;

  // Run once at boot so a server that was down across a threshold catches up immediately
  // rather than leaving the backlog unreported for another interval.
  void tick();

  timer = setInterval(() => void tick(), UNCLAIMED_SWEEP_INTERVAL_MS);
  // Must not keep the process alive during shutdown.
  timer.unref();
}

export function stopUnclaimedWorkJob(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

async function tick(): Promise<void> {
  try {
    const result = await runUnclaimedSweep();
    logger.debug(result, 'Unclaimed work sweep completed');
  } catch (error) {
    // A failed sweep must not take the process down; the next tick retries.
    logger.error({ err: error }, 'Unclaimed work sweep failed');
  }
}
