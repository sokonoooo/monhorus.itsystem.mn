import { logger } from '../config/logger';
import { runReminderSweep } from '../modules/notification/reminder.service';

/**
 * Deadline reminder sweep.
 *
 * Fifteen minutes, for the reason the unclaimed sweep documents: a threshold is crossed
 * when the deadline arrives, not when the job happens to look, so the interval is the
 * worst-case lateness of every notification it sends. An SLA warning that arrives an hour
 * after the window opened has spent that hour being useless.
 *
 * It is not shorter because none of these deadlines are minute-accurate — the tightest is
 * an SLA ratio over a window measured in hours — and each pass is several collection scans
 * on a host shared with four other tenants.
 */
export const REMINDER_SWEEP_INTERVAL_MS = 15 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;

export function startReminderJob(): void {
  if (timer) return;

  // Run once at boot so a server that was down across a deadline catches up immediately
  // rather than leaving it unannounced for another interval.
  void tick();

  timer = setInterval(() => void tick(), REMINDER_SWEEP_INTERVAL_MS);
  // Must not keep the process alive during shutdown.
  timer.unref();
}

export function stopReminderJob(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

async function tick(): Promise<void> {
  try {
    const result = await runReminderSweep();
    logger.debug(result, 'Reminder sweep completed');
  } catch (error) {
    // A failed sweep must not take the process down; the next tick retries.
    logger.error({ err: error }, 'Reminder sweep failed');
  }
}
