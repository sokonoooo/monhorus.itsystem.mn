import {
  PERMISSIONS,
  SETTING_KEYS,
  TAX_UNSET_NOTE,
  type SettingEntryDto,
  type SettingsDto,
} from '@monhorus/shared';
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { INVOICE_FINANCE_UNAVAILABLE_NOTE } from '../../hooks/use-invoice-finance';
import { invoiceService } from '../../services/invoice.service';
import { settingsService } from '../../services/settings.service';
import { renderWithAuth } from '../../test/render';
import { GenerateInvoicesDrawer } from './GenerateInvoicesDrawer';

function financeSettings(dueDays: number): SettingsDto {
  const entry: SettingEntryDto = {
    key: SETTING_KEYS.FINANCE_INVOICE_DUE_DAYS,
    group: 'finance',
    label: 'Нэхэмжлэлийн төлөх хугацаа',
    hint: '',
    type: 'integer',
    value: dueDays,
    defaultValue: 30,
    isOverridden: true,
    min: 1,
    max: 365,
    unit: 'хоног',
    updatedByName: null,
    updatedAt: null,
  };

  const tax: SettingEntryDto = {
    ...entry,
    key: SETTING_KEYS.FINANCE_TAX_PERCENT,
    label: 'НӨАТ/татварын хувь',
    type: 'percent',
    value: 10,
    defaultValue: 0,
    min: 0,
    max: 100,
    unit: '%',
  };

  return {
    canManage: true,
    groups: [{ group: 'finance', label: 'Санхүү', description: '', entries: [entry, tax] }],
  };
}

function renderDrawer(): void {
  renderWithAuth(
    <GenerateInvoicesDrawer open onClose={() => undefined} onGenerated={() => undefined} />,
    { permissions: [PERMISSIONS.INVOICE_MANAGE, PERMISSIONS.SETTINGS_VIEW] },
  );
}

/** The monthly run's rate comes from the preview, which is the figure the server will apply. */
function preview(taxPercent: number): void {
  vi.spyOn(invoiceService, 'generationPreview').mockResolvedValue({
    billingPeriod: '2026-08',
    taxPercent,
    candidates: [],
  });
}

describe('GenerateInvoicesDrawer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 7, 4, 9, 0, 0));
    preview(10);
  });

  /**
   * The bug: this drawer hardcoded 30 while `InvoiceFormDrawer` read
   * `finance.invoice_due_days`, so a 14-day tenant got 14 on a one-off invoice and 30 on
   * the whole monthly run. Both paths now read the same setting.
   */
  it('defaults the due date to the configured due-day count', async () => {
    vi.spyOn(settingsService, 'get').mockResolvedValue(financeSettings(14));

    renderDrawer();

    // 2026-08-04 plus the configured 14 days, not the hardcoded 30 (which would be 09-03).
    await waitFor(() =>
      expect(screen.getByLabelText(/Төлөх хугацаа/)).toHaveValue('2026-08-18'),
    );
  });

  /**
   * This used to assert the opposite — that a failed read silently fell back to 30 days.
   * That fallback was the bug: a term nobody configured, presented as though it were the
   * tenant's own, on a document the customer is expected to pay by that date.
   */
  it('invents no due-day count when the settings read fails', async () => {
    const get = vi.spyOn(settingsService, 'get').mockRejectedValue(new Error('offline'));

    renderDrawer();

    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(await screen.findByText(INVOICE_FINANCE_UNAVAILABLE_NOTE)).toBeInTheDocument();
    expect(screen.getByLabelText(/Төлөх хугацаа/)).toHaveValue('');
    expect(screen.queryByText(TAX_UNSET_NOTE)).not.toBeInTheDocument();
  });

  it('flags a zero tax rate on the monthly run', async () => {
    vi.spyOn(settingsService, 'get').mockResolvedValue(financeSettings(30));
    preview(0);

    renderDrawer();

    expect(await screen.findByText(TAX_UNSET_NOTE)).toBeInTheDocument();
  });

  it('shows no tax warning when a real rate is configured', async () => {
    vi.spyOn(settingsService, 'get').mockResolvedValue(financeSettings(30));
    preview(10);

    renderDrawer();

    await waitFor(() =>
      expect(screen.getByLabelText(/Төлөх хугацаа/)).toHaveValue('2026-09-03'),
    );
    expect(screen.queryByText(TAX_UNSET_NOTE)).not.toBeInTheDocument();
    expect(screen.queryByText(INVOICE_FINANCE_UNAVAILABLE_NOTE)).not.toBeInTheDocument();
  });
});
