/**
 * Invoice arithmetic, kept deliberately in step with `totalsOf` in the backend's
 * `invoice.service.ts`.
 *
 * The rounding order is the whole point: each line amount is rounded first, and the
 * subtotal is the rounded sum of those rounded amounts. Summing the raw products and
 * rounding once at the end gives a different figure, because `quantity` and `unitPrice`
 * both accept decimals — `invoiceLineInputSchema` puts no `.int()` on either, so 2.5
 * hours of labour is a legal line — and the per-line remainders accumulate.
 *
 * That divergence previously let the create-invoice drawer display a total the server
 * would never store: three lines of 0.5 × 1001 at 10% tax showed 1,651.5 while the saved
 * invoice came to 1,653. A financial document must not disagree with itself, so if the
 * backend's rule ever changes, this has to change with it.
 */
export interface InvoiceTotals {
  subtotal: number;
  taxAmount: number;
  total: number;
}

export function invoiceTotals(
  lines: readonly { quantity: number; unitPrice: number }[],
  taxPercent: number,
): InvoiceTotals {
  const subtotal = Math.round(
    lines.reduce((sum, line) => {
      const amount = line.quantity * line.unitPrice;
      // A half-typed line parses as NaN. It contributes nothing rather than poisoning
      // the running total, so the figures stay readable while the form is being filled.
      return sum + (Number.isFinite(amount) ? Math.round(amount) : 0);
    }, 0),
  );
  const taxAmount = Math.round((subtotal * taxPercent) / 100);
  return { subtotal, taxAmount, total: subtotal + taxAmount };
}
