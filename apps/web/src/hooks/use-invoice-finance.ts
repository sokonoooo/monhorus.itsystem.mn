import { PERMISSIONS, SETTING_KEYS, type SettingsMap } from '@monhorus/shared';
import { useEffect, useState } from 'react';

import { useAuth } from '../contexts/auth-context';
import { settingsService } from '../services/settings.service';

/** The two finance settings every invoice-creating screen has to know before it can quote a figure. */
export interface InvoiceFinance {
  /**
   * `finance.tax_percent`, 0-100.
   *
   * A genuine 0 is a legal value and is kept as 0 — the screens flag it with
   * `TAX_UNSET_NOTE` rather than hiding it. What must never happen is a 0 that only
   * means "we could not read the setting"; that is the `unavailable` state below.
   */
  taxPercent: number;
  /** `finance.invoice_due_days`, 1-365. */
  dueDays: number;
}

/**
 * Shown in place of a rate when the finance settings could not be read.
 *
 * Deliberately worded as an absence rather than a value: it must never read like a rate
 * of zero, because `TAX_UNSET_NOTE` — the note for a rate that genuinely is zero — is a
 * different message about a different situation.
 */
export const INVOICE_FINANCE_UNAVAILABLE_NOTE =
  'Санхүүгийн тохиргоог уншиж чадсангүй. Татварын хувь болон төлөх хугацаа тодорхойгүй тул нэхэмжлэл үүсгэх боломжгүй.';

/**
 * Three states, deliberately distinct.
 *
 * `unavailable` is not a rate of zero and not a term of thirty days. It is "this screen
 * cannot state either figure", and the caller must then show no rate, quote no total and
 * refuse to submit.
 */
export type InvoiceFinanceState =
  | { status: 'loading' }
  | ({ status: 'ready' } & InvoiceFinance)
  | { status: 'unavailable' };

/**
 * The finance figures the backend will actually apply to a new invoice.
 *
 * `invoice.service.ts` recomputes tax from `finance.tax_percent` at save time and never
 * takes it from the request, so a drawer that guesses the rate quotes a total the server
 * will not store. `invoice-totals.ts` was written after exactly that incident — "a
 * financial document must not disagree with itself" — and this hook closes the other half
 * of it: the drawers used to do `Number(tax?.value ?? 0)` inside a `.catch(() => undefined)`,
 * so a network blip, or any custom role holding `invoice.manage` without `settings.view`,
 * rendered «Татвар (0%)» and a total equal to the subtotal. The user approved that figure
 * and the server stored a different one.
 *
 * Following `use-sla-hours.ts`, a failed or refused read yields no numbers at all rather
 * than the shipped defaults: a wrong figure presented as the rule is worse than no figure.
 *
 * Unlike that hook this one does not cache. SLA windows are informational and change about
 * once a year; a tax rate is arithmetic on a financial document, and a value cached for the
 * page's lifetime would keep quoting the old rate after an administrator changed it in
 * another tab. The drawers open rarely, so the read is cheap.
 */
export function useInvoiceFinance(enabled: boolean): InvoiceFinanceState {
  const { can } = useAuth();
  const allowed = can(PERMISSIONS.SETTINGS_VIEW);
  const [state, setState] = useState<InvoiceFinanceState>({ status: 'loading' });

  useEffect(() => {
    if (!enabled) return undefined;

    // No point asking for a document the guard will refuse. The answer is the same either
    // way — this caller cannot state the tax rate — so it is reported as such rather than
    // as a rate of zero.
    if (!allowed) {
      setState({ status: 'unavailable' });
      return undefined;
    }

    let cancelled = false;
    setState({ status: 'loading' });

    void settingsService
      .get()
      .then((settings) => {
        if (cancelled) return;

        const map = Object.fromEntries(
          settings.groups.flatMap((group) => group.entries.map((entry) => [entry.key, entry.value])),
        ) as SettingsMap;

        // A payload missing either key, or carrying a non-numeric one, is not something
        // to guess around: the drawer would print "Татвар (NaN%)" and quote NaN as a total.
        const rawTax = map[SETTING_KEYS.FINANCE_TAX_PERCENT];
        const rawDueDays = map[SETTING_KEYS.FINANCE_INVOICE_DUE_DAYS];
        if (rawTax == null || rawDueDays == null) {
          setState({ status: 'unavailable' });
          return;
        }

        const taxPercent = Number(rawTax);
        const dueDays = Number(rawDueDays);
        if (!Number.isFinite(taxPercent) || taxPercent < 0 || taxPercent > 100) {
          setState({ status: 'unavailable' });
          return;
        }
        if (!Number.isFinite(dueDays) || dueDays < 1) {
          setState({ status: 'unavailable' });
          return;
        }

        setState({ status: 'ready', taxPercent, dueDays });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'unavailable' });
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, allowed]);

  return state;
}
