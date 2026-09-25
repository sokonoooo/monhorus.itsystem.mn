import { describe, expect, it } from 'vitest';

import { SERVICE_REQUEST_STATUSES } from '@monhorus/shared';

import { computeSlaDueAt, evaluateSla, isSlaBreached, slaWindowHours } from './sla.service';

const START = new Date('2026-01-01T00:00:00.000Z');

function hoursAfterStart(hours: number): Date {
  return new Date(START.getTime() + hours * 60 * 60 * 1000);
}

describe('SLA windows', () => {
  it('gives an urgent call six hours', () => {
    expect(slaWindowHours(true)).toBe(6);
    expect(computeSlaDueAt(START, true).toISOString()).toBe('2026-01-01T06:00:00.000Z');
  });

  it('gives a standard call twenty four hours', () => {
    expect(slaWindowHours(false)).toBe(24);
    expect(computeSlaDueAt(START, false).toISOString()).toBe('2026-01-02T00:00:00.000Z');
  });

  it('adds an extension to the deadline', () => {
    expect(computeSlaDueAt(START, true, 120).toISOString()).toBe('2026-01-01T08:00:00.000Z');
  });
});

describe('SLA state evaluation', () => {
  const base = {
    status: 'IN_PROGRESS' as const,
    isUrgent: true,
    slaStartedAt: START,
    slaDueAt: computeSlaDueAt(START, true),
    completedAt: null,
  };

  it('reports STARTED early in the window', () => {
    // One hour into a six hour window is 17 per cent consumed.
    const result = evaluateSla({ ...base, now: hoursAfterStart(1) });
    expect(result.state).toBe('STARTED');
    expect(result.remainingMinutes).toBe(300);
  });

  it('reports NEAR_BREACH once three quarters is consumed', () => {
    const result = evaluateSla({ ...base, now: hoursAfterStart(4.6) });
    expect(result.state).toBe('NEAR_BREACH');
  });

  it('reports AT_RISK once ninety per cent is consumed', () => {
    const result = evaluateSla({ ...base, now: hoursAfterStart(5.5) });
    expect(result.state).toBe('AT_RISK');
  });

  it('reports BREACHED past the deadline with a negative remainder', () => {
    const result = evaluateSla({ ...base, now: hoursAfterStart(7) });
    expect(result.state).toBe('BREACHED');
    expect(result.remainingMinutes).toBe(-60);
  });

  it('reports WITHIN_SLA when completed before the deadline', () => {
    const result = evaluateSla({
      ...base,
      status: 'COMPLETED',
      completedAt: hoursAfterStart(3),
      now: hoursAfterStart(10),
    });
    expect(result.state).toBe('WITHIN_SLA');
  });

  it('reports LATE when completed after the deadline', () => {
    const result = evaluateSla({
      ...base,
      status: 'COMPLETED',
      completedAt: hoursAfterStart(9),
      now: hoursAfterStart(10),
    });
    expect(result.state).toBe('LATE');
  });

  it('does not report a breach for a cancelled request', () => {
    const result = evaluateSla({ ...base, status: 'CANCELLED', now: hoursAfterStart(50) });
    expect(result.state).toBe('STARTED');
    expect(result.remainingMinutes).toBeNull();
  });
});


/**
 * [isSlaBreached] is the single definition the KPI tile, the 15.2 SLA report and the
 * dashboard counter all run. Its job is to agree with [evaluateSla], which was already the
 * authority on SLA state, so the tie between them is asserted directly rather than left as
 * two rules that happen to line up today.
 */
describe('SLA breach, defined once', () => {
  const DUE = hoursAfterStart(6);
  const base = { slaDueAt: DUE, completedAt: null };

  it('breaches an open request the moment the deadline arrives, and not before', () => {
    const open = { status: 'IN_PROGRESS' as const, ...base };
    expect(isSlaBreached(open, new Date(DUE.getTime() - 1))).toBe(false);
    expect(isSlaBreached(open, DUE)).toBe(true);
    expect(isSlaBreached(open, new Date(DUE.getTime() + 1))).toBe(true);
  });

  it('lets a request completed exactly on the deadline through', () => {
    // The deliberate asymmetry: delivering on the dot is delivering on time, while a live
    // clock that has run out has run out. Both readings come from `evaluateSla`.
    const onTheDot = { status: 'COMPLETED' as const, slaDueAt: DUE, completedAt: DUE };
    expect(isSlaBreached(onTheDot, hoursAfterStart(99))).toBe(false);
    expect(
      isSlaBreached(
        { status: 'COMPLETED', slaDueAt: DUE, completedAt: new Date(DUE.getTime() + 1) },
        hoursAfterStart(99),
      ),
    ).toBe(true);
  });

  it('keeps a completed breach a breach however long ago it was closed', () => {
    const late = { status: 'COMPLETED' as const, slaDueAt: DUE, completedAt: hoursAfterStart(8) };
    expect(isSlaBreached(late, hoursAfterStart(9))).toBe(true);
    expect(isSlaBreached(late, hoursAfterStart(9_000))).toBe(true);
  });

  it('never breaches a cancelled request, whatever the deadline says', () => {
    const cancelled = { status: 'CANCELLED' as const, slaDueAt: DUE, completedAt: null };
    expect(isSlaBreached(cancelled, hoursAfterStart(9_000))).toBe(false);
  });

  it('reads settlement from the status, not from completedAt', () => {
    // A settled request with no stamp falls back to `now`, exactly as `evaluateSla` does.
    expect(
      isSlaBreached({ status: 'COMPLETED', slaDueAt: DUE, completedAt: null }, hoursAfterStart(7)),
    ).toBe(true);
    expect(
      isSlaBreached({ status: 'COMPLETED', slaDueAt: DUE, completedAt: null }, hoursAfterStart(5)),
    ).toBe(false);
  });

  it('treats RETURNED and REVISIT_REQUIRED as open work with a live clock', () => {
    for (const status of ['RETURNED', 'REVISIT_REQUIRED'] as const) {
      expect(isSlaBreached({ status, ...base }, hoursAfterStart(7))).toBe(true);
      expect(isSlaBreached({ status, ...base }, hoursAfterStart(5))).toBe(false);
    }
  });

  it('does not breach a request with no deadline', () => {
    expect(
      isSlaBreached({ status: 'IN_PROGRESS', slaDueAt: null, completedAt: null }, hoursAfterStart(9)),
    ).toBe(false);
  });

  it('agrees with evaluateSla for every status and every position of the clock', () => {
    const completions = [null, hoursAfterStart(5), DUE, hoursAfterStart(8)];
    const clocks = [hoursAfterStart(1), DUE, hoursAfterStart(7)];

    for (const status of SERVICE_REQUEST_STATUSES) {
      for (const completedAt of completions) {
        for (const now of clocks) {
          const subject = { status, slaDueAt: DUE, completedAt };
          const { state } = evaluateSla({
            status,
            isUrgent: true,
            slaStartedAt: START,
            slaDueAt: DUE,
            completedAt,
            now,
          });
          expect({ status, completedAt, now, breached: isSlaBreached(subject, now) }).toEqual({
            status,
            completedAt,
            now,
            breached: state === 'LATE' || state === 'BREACHED',
          });
        }
      }
    }
  });
});
