import {
  DEFAULT_USAGE_COEFFICIENT,
  equipmentLoadKw,
  loadPercent,
  loadVarianceKw,
  reserveKw,
  sumLoads,
} from '@monhorus/shared';
import { describe, expect, it } from 'vitest';

/**
 * Section 11.5 formulas, exercised as pure functions.
 *
 * Nothing here asserts an electrical safety rule: section 11.6 and the standard tables it
 * depends on are unapproved (section 19.2), so only the four defined formulas plus the
 * completeness and exclusion rules are covered.
 */
describe('equipment load', () => {
  it('multiplies rated power, quantity and coefficient', () => {
    const result = equipmentLoadKw({
      ratedPowerKw: 1.5,
      quantity: 4,
      usageCoefficient: 0.8,
      status: 'ACTIVE',
    });

    expect(result.valueKw).toBe(4.8);
    expect(result.complete).toBe(true);
  });

  it('defaults the coefficient to 1.0 when none is recorded', () => {
    const result = equipmentLoadKw({
      ratedPowerKw: 2,
      quantity: 3,
      usageCoefficient: null,
      status: 'ACTIVE',
    });

    expect(DEFAULT_USAGE_COEFFICIENT).toBe(1);
    expect(result.valueKw).toBe(6);
  });

  it('excludes a decommissioned object rather than treating it as incomplete', () => {
    const result = equipmentLoadKw({
      ratedPowerKw: null,
      quantity: null,
      usageCoefficient: null,
      status: 'DECOMMISSIONED',
    });

    expect(result.valueKw).toBe(0);
    expect(result.complete).toBe(true);
  });

  it('reports incomplete with a reason when rated power is missing', () => {
    const result = equipmentLoadKw({
      ratedPowerKw: null,
      quantity: 2,
      usageCoefficient: 1,
      status: 'ACTIVE',
    });

    expect(result.valueKw).toBeNull();
    expect(result.complete).toBe(false);
    expect(result.reasons).toContain('MISSING_RATED_POWER');
  });

  it('reports incomplete when quantity is missing', () => {
    const result = equipmentLoadKw({
      ratedPowerKw: 2,
      quantity: null,
      usageCoefficient: 1,
      status: 'ACTIVE',
    });

    expect(result.reasons).toContain('MISSING_QUANTITY');
  });
});

describe('aggregation', () => {
  const complete = { valueKw: 5, complete: true, reasons: [] as const };
  const incomplete = { valueKw: null, complete: false, reasons: ['MISSING_QUANTITY'] as const };

  it('sums complete parts', () => {
    expect(sumLoads([complete, complete]).valueKw).toBe(10);
  });

  /** A missing figure must never be silently treated as zero (rule 17.18). */
  it('propagates incompleteness rather than dropping the part', () => {
    const result = sumLoads([complete, incomplete]);

    expect(result.valueKw).toBeNull();
    expect(result.complete).toBe(false);
    expect(result.reasons).toContain('MISSING_QUANTITY');
  });

  it('returns zero for an empty set', () => {
    expect(sumLoads([]).valueKw).toBe(0);
  });
});

describe('percent, reserve and variance', () => {
  const load = { valueKw: 18.4, complete: true, reasons: [] as const };

  it('computes load as a percentage of capacity', () => {
    expect(loadPercent(load, 25).valueKw).toBe(73.6);
  });

  it('reports over one hundred percent rather than clamping', () => {
    // Section 11.5 defines the ratio; it never caps it, and an overload must stay visible.
    expect(loadPercent({ valueKw: 21.6, complete: true, reasons: [] }, 20).valueKw).toBe(108);
  });

  it('is incomplete when capacity is missing', () => {
    const result = loadPercent(load, null);
    expect(result.complete).toBe(false);
    expect(result.reasons).toContain('MISSING_CAPACITY');
  });

  it('refuses to divide by a zero capacity', () => {
    expect(loadPercent(load, 0).complete).toBe(false);
  });

  it('computes reserve as capacity minus load', () => {
    expect(reserveKw(load, 25).valueKw).toBe(6.6);
  });

  it('reports a negative reserve for an overloaded panel', () => {
    expect(reserveKw({ valueKw: 21.6, complete: true, reasons: [] }, 20).valueKw).toBe(-1.6);
  });

  it('derives variance as measured minus calculated', () => {
    expect(loadVarianceKw(load, 20).valueKw).toBe(1.6);
  });

  it('has no variance when nothing was measured', () => {
    const result = loadVarianceKw(load, null);
    expect(result.valueKw).toBeNull();
    expect(result.complete).toBe(false);
  });

  it('has no variance when the calculation itself is incomplete', () => {
    const result = loadVarianceKw({ valueKw: null, complete: false, reasons: [] }, 20);
    expect(result.valueKw).toBeNull();
  });
});
