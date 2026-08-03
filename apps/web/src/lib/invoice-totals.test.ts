import { describe, expect, it } from 'vitest';

import { invoiceTotals } from './invoice-totals';

/**
 * The contract these defend is cross-process: `invoiceTotals` must agree with `totalsOf`
 * in the backend's invoice.service.ts, because the drawer shows the operator a total
 * before the server computes the one it stores. The expectations below are the backend's
 * arithmetic worked through by hand, not this implementation's own output.
 */
describe('invoiceTotals', () => {
  it('rounds each line before summing, matching what the server stores', () => {
    // Three lines of 0.5 × 1001 at 10% tax. Rounding per line gives 501 each, so the
    // subtotal is 1503. Summing the raw 500.5s first would give 1501.5 and a total of
    // 1651.5 — the figure the drawer used to display against a stored 1653.
    const lines = [
      { quantity: 0.5, unitPrice: 1001 },
      { quantity: 0.5, unitPrice: 1001 },
      { quantity: 0.5, unitPrice: 1001 },
    ];

    expect(invoiceTotals(lines, 10)).toEqual({ subtotal: 1503, taxAmount: 150, total: 1653 });
  });

  it('is exact for whole quantities and prices', () => {
    const lines = [
      { quantity: 2, unitPrice: 15_000 },
      { quantity: 1, unitPrice: 40_000 },
    ];

    expect(invoiceTotals(lines, 10)).toEqual({
      subtotal: 70_000,
      taxAmount: 7_000,
      total: 77_000,
    });
  });

  it('handles a fractional quantity of hours', () => {
    // 2.5 hours at 33,333 is 83,332.5, which rounds to 83,333.
    expect(invoiceTotals([{ quantity: 2.5, unitPrice: 33_333 }], 10)).toEqual({
      subtotal: 83_333,
      taxAmount: 8_333,
      total: 91_666,
    });
  });

  it('treats a half-typed line as zero rather than propagating NaN', () => {
    const lines = [
      { quantity: 2, unitPrice: 10_000 },
      { quantity: Number.NaN, unitPrice: Number.NaN },
    ];

    expect(invoiceTotals(lines, 10)).toEqual({ subtotal: 20_000, taxAmount: 2_000, total: 22_000 });
  });

  it('applies a zero tax rate without inventing an amount', () => {
    expect(invoiceTotals([{ quantity: 1, unitPrice: 5_000 }], 0)).toEqual({
      subtotal: 5_000,
      taxAmount: 0,
      total: 5_000,
    });
  });

  it('returns zeroes for an empty line set', () => {
    expect(invoiceTotals([], 10)).toEqual({ subtotal: 0, taxAmount: 0, total: 0 });
  });
});
