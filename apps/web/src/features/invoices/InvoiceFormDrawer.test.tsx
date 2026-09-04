import {
  PERMISSIONS,
  SETTING_KEYS,
  TAX_UNSET_NOTE,
  type CustomerDto,
  type SettingEntryDto,
  type SettingsDto,
} from '@monhorus/shared';
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { INVOICE_FINANCE_UNAVAILABLE_NOTE } from '../../hooks/use-invoice-finance';
import { settingsService } from '../../services/settings.service';
import { renderWithAuth } from '../../test/render';
import { InvoiceFormDrawer } from './InvoiceFormDrawer';

function entry(key: string, value: number): SettingEntryDto {
  return {
    key,
    group: 'finance',
    label: key,
    hint: '',
    type: 'integer',
    value,
    defaultValue: value,
    isOverridden: true,
    min: 0,
    max: 365,
    unit: '',
    updatedByName: null,
    updatedAt: null,
  } as SettingEntryDto;
}

function financeSettings(taxPercent: number, dueDays = 30): SettingsDto {
  return {
    canManage: true,
    groups: [
      {
        group: 'finance',
        label: 'Санхүү',
        description: '',
        entries: [
          entry(SETTING_KEYS.FINANCE_TAX_PERCENT, taxPercent),
          entry(SETTING_KEYS.FINANCE_INVOICE_DUE_DAYS, dueDays),
        ],
      },
    ],
  };
}

const CUSTOMERS = [{ id: 'c1', name: 'Харилцагч Нэг' }] as unknown as readonly CustomerDto[];

function renderDrawer(): void {
  renderWithAuth(
    <InvoiceFormDrawer
      open
      customers={CUSTOMERS}
      onClose={() => undefined}
      onSaved={() => undefined}
    />,
    { permissions: [PERMISSIONS.INVOICE_MANAGE, PERMISSIONS.SETTINGS_VIEW] },
  );
}

function submitButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Хадгалах' }) as HTMLButtonElement;
}

/**
 * The three states a tax rate can be in, and why they must not look alike.
 *
 * `finance.tax_percent` ships as 0 (`settings.ts`), so a deployment that never opens
 * Тохиргоо issues every invoice untaxed. That is legal but worth flagging, and
 * `TAX_UNSET_NOTE` exists to flag it.
 *
 * A failed settings read is a different thing entirely. The drawer used to do
 * `Number(tax?.value ?? 0)` inside a `.catch(() => undefined)`, which turned a network
 * blip — or any custom role with `invoice.manage` but not `settings.view` — into the very
 * same «Татвар (0%)» with `total === subtotal`. The user approved that figure and the
 * server, which recomputes tax from the setting at save time, stored a different one.
 */
describe('InvoiceFormDrawer tax rate', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('flags a genuinely zero rate and still allows submission', async () => {
    vi.spyOn(settingsService, 'get').mockResolvedValue(financeSettings(0));

    renderDrawer();

    expect(await screen.findByText(TAX_UNSET_NOTE)).toBeInTheDocument();
    expect(screen.getByText(/Татвар \(0%\)/)).toBeInTheDocument();
    // A zero rate is a legal rate: nothing is blocked, it is only made visible.
    expect(submitButton()).not.toBeDisabled();
    expect(screen.queryByText(INVOICE_FINANCE_UNAVAILABLE_NOTE)).not.toBeInTheDocument();
  });

  it('states no rate at all and blocks submission when the settings read fails', async () => {
    const get = vi.spyOn(settingsService, 'get').mockRejectedValue(new Error('offline'));

    renderDrawer();

    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(await screen.findByText(INVOICE_FINANCE_UNAVAILABLE_NOTE)).toBeInTheDocument();

    // Not a rate of zero: neither the "0%" heading nor the zero-rate note may appear,
    // because neither is something this drawer knows to be true.
    expect(screen.queryByText(/Татвар \(0%\)/)).not.toBeInTheDocument();
    expect(screen.queryByText(TAX_UNSET_NOTE)).not.toBeInTheDocument();
    expect(submitButton()).toBeDisabled();
  });

  it('shows no warning when a real rate is configured', async () => {
    vi.spyOn(settingsService, 'get').mockResolvedValue(financeSettings(10));

    renderDrawer();

    expect(await screen.findByText(/Татвар \(10%\)/)).toBeInTheDocument();
    expect(screen.queryByText(TAX_UNSET_NOTE)).not.toBeInTheDocument();
    expect(screen.queryByText(INVOICE_FINANCE_UNAVAILABLE_NOTE)).not.toBeInTheDocument();
    expect(submitButton()).not.toBeDisabled();
  });
});
