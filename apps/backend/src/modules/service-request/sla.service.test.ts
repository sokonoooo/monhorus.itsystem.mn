import { describe, expect, it } from 'vitest';

import { computeSlaDueAt, evaluateSla, slaWindowHours } from './sla.service';

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
