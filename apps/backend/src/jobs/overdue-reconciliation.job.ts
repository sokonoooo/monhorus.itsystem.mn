import { logger } from '../config/logger';
import { runOverdueReconciliation } from '../modules/planned-work/planned-work.overdue.service';

/**
 * Hourly overdue reconciliation.
 *
 * The reads and mutations that touch a planned work already stamp `overdueAt` as a
 * fallback, but a work nobody opens would otherwise sit unstamped and its breach audit
 * event would never be written. This job closes that gap.
 *
 * Deliberately a plain interval rather than a scheduler dependency: there is exactly one
 * job, it is idempotent, and a missed tick is corrected by the next one.
 */
export const RECONCILIATION_INTERVAL_MS = 60 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;

export function startOverdueReconciliationJob(): void {
  if (timer) return;

  // Run once at boot so a server that was down over a deadline catches up immediately.
  void tick();

  timer = setInterval(() => void tick(), RECONCILIATION_INTERVAL_MS);
  // Must not keep the process alive during shutdown.
  timer.unref();
}

export function stopOverdueReconciliationJob(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

async function tick(): Promise<void> {
  try {
    const result = await runOverdueReconciliation();
    logger.debug(result, 'Overdue reconciliation completed');
  } catch (error) {
    // A failed sweep must not take the process down; the next tick retries.
    logger.error({ err: error }, 'Overdue reconciliation failed');
  }
}
