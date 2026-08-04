import { SETTING_KEYS, type SettingEntryDto, type SettingsDto } from '@monhorus/shared';
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

  return {
    canManage: true,
    groups: [{ group: 'finance', label: 'Санхүү', description: '', entries: [entry] }],
  };
}

describe('GenerateInvoicesDrawer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 7, 4, 9, 0, 0));
    vi.spyOn(invoiceService, 'generationPreview').mockResolvedValue({
      billingPeriod: '2026-08',
      taxPercent: 10,
      candidates: [],
    });
  });

  /**
   * The bug: this drawer hardcoded 30 while `InvoiceFormDrawer` read
   * `finance.invoice_due_days`, so a 14-day tenant got 14 on a one-off invoice and 30 on
   * the whole monthly run. Both paths now read the same setting.
   */
  it('defaults the due date to the configured due-day count', async () => {
    vi.spyOn(settingsService, 'get').mockResolvedValue(financeSettings(14));

    renderWithAuth(
      <GenerateInvoicesDrawer open onClose={() => undefined} onGenerated={() => undefined} />,
    );

    // 2026-08-04 plus the configured 14 days, not the hardcoded 30 (which would be 09-03).
    await waitFor(() =>
      expect(screen.getByLabelText(/Төлөх хугацаа/)).toHaveValue('2026-08-18'),
    );
  });

  it('falls back to the shipped 30 days when the setting cannot be read', async () => {
    const get = vi.spyOn(settingsService, 'get').mockRejectedValue(new Error('offline'));

    renderWithAuth(
      <GenerateInvoicesDrawer open onClose={() => undefined} onGenerated={() => undefined} />,
    );

    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.getByLabelText(/Төлөх хугацаа/)).toHaveValue('2026-09-03');
  });
});
