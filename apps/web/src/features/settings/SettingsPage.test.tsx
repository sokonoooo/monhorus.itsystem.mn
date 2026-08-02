import { PERMISSIONS, SETTING_KEYS, type SettingsDto } from '@monhorus/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../lib/api-client';
import { settingsService } from '../../services/settings.service';
import { renderWithAuth } from '../../test/render';
import { SettingsPage } from './SettingsPage';

function makeSettings(overrides: Partial<SettingsDto> = {}): SettingsDto {
  return {
    canManage: true,
    groups: [
      {
        group: 'sla',
        label: 'SLA',
        description: 'Яаралтай болон энгийн дуудлагын хугацаа.',
        entries: [
          {
            key: SETTING_KEYS.SLA_URGENT_HOURS,
            group: 'sla',
            label: 'Яаралтай дуудлагын хугацаа',
            hint: 'Үндсэн утга 6 цаг.',
            type: 'integer',
            value: 6,
            defaultValue: 6,
            isOverridden: false,
            min: 1,
            max: 720,
            unit: 'цаг',
            updatedByName: null,
            updatedAt: null,
          },
          {
            key: SETTING_KEYS.SLA_STANDARD_HOURS,
            group: 'sla',
            label: 'Энгийн дуудлагын хугацаа',
            hint: 'Үндсэн утга 24 цаг.',
            type: 'integer',
            value: 48,
            defaultValue: 24,
            isOverridden: true,
            min: 1,
            max: 720,
            unit: 'цаг',
            updatedByName: 'Ерөнхий админ',
            updatedAt: '2026-07-01T00:00:00.000Z',
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders each setting with its label, hint and unit', async () => {
    vi.spyOn(settingsService, 'get').mockResolvedValue(makeSettings());

    renderWithAuth(<SettingsPage />, { permissions: [PERMISSIONS.SETTINGS_VIEW] });

    expect(await screen.findByLabelText('Яаралтай дуудлагын хугацаа')).toHaveValue(6);
    expect(screen.getByText('Үндсэн утга 6 цаг.')).toBeInTheDocument();
    expect(screen.getAllByText('цаг')).toHaveLength(2);
  });

  it('marks an overridden value and names who changed it', async () => {
    vi.spyOn(settingsService, 'get').mockResolvedValue(makeSettings());

    renderWithAuth(<SettingsPage />, { permissions: [PERMISSIONS.SETTINGS_VIEW] });

    expect(await screen.findByText(/Анхны утга 24 цаг/)).toBeInTheDocument();
    expect(screen.getByText(/Ерөнхий админ/)).toBeInTheDocument();
  });

  it('keeps save disabled until something actually changes', async () => {
    vi.spyOn(settingsService, 'get').mockResolvedValue(makeSettings());
    const user = userEvent.setup();

    renderWithAuth(<SettingsPage />, {
      permissions: [PERMISSIONS.SETTINGS_VIEW, PERMISSIONS.SETTINGS_MANAGE],
    });

    const save = await screen.findByRole('button', { name: /Хадгалах/ });
    expect(save).toBeDisabled();

    const urgent = screen.getByLabelText('Яаралтай дуудлагын хугацаа');
    await user.clear(urgent);
    await user.type(urgent, '4');

    expect(screen.getByRole('button', { name: /Хадгалах \(1\)/ })).toBeEnabled();
  });

  it('submits only the keys that changed', async () => {
    vi.spyOn(settingsService, 'get').mockResolvedValue(makeSettings());
    const update = vi.spyOn(settingsService, 'update').mockResolvedValue(makeSettings());
    const user = userEvent.setup();

    renderWithAuth(<SettingsPage />, {
      permissions: [PERMISSIONS.SETTINGS_VIEW, PERMISSIONS.SETTINGS_MANAGE],
    });

    const urgent = await screen.findByLabelText('Яаралтай дуудлагын хугацаа');
    await user.clear(urgent);
    await user.type(urgent, '4');
    await user.click(screen.getByRole('button', { name: /Хадгалах/ }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({ [SETTING_KEYS.SLA_URGENT_HOURS]: 4 });
    });
  });

  it('shows a backend cross-field rejection against the offending field', async () => {
    vi.spyOn(settingsService, 'get').mockResolvedValue(makeSettings());
    vi.spyOn(settingsService, 'update').mockRejectedValue(
      new ApiError('Тохиргооны утгууд хоорондоо зөрчилдөж байна.', 'VALIDATION_ERROR', 400, [
        {
          field: SETTING_KEYS.SLA_URGENT_HOURS,
          message: 'Эрсдэлтэй босго нь анхаарах босгоос их байх ёстой.',
        },
      ]),
    );
    const user = userEvent.setup();

    renderWithAuth(<SettingsPage />, {
      permissions: [PERMISSIONS.SETTINGS_VIEW, PERMISSIONS.SETTINGS_MANAGE],
    });

    const urgent = await screen.findByLabelText('Яаралтай дуудлагын хугацаа');
    await user.clear(urgent);
    await user.type(urgent, '4');
    await user.click(screen.getByRole('button', { name: /Хадгалах/ }));

    expect(
      await screen.findByText('Тохиргооны утгууд хоорондоо зөрчилдөж байна.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Эрсдэлтэй босго нь анхаарах босгоос их байх ёстой.'),
    ).toBeInTheDocument();
  });

  it('offers a reset only for an overridden setting', async () => {
    vi.spyOn(settingsService, 'get').mockResolvedValue(makeSettings());

    renderWithAuth(<SettingsPage />, {
      permissions: [PERMISSIONS.SETTINGS_VIEW, PERMISSIONS.SETTINGS_MANAGE],
    });

    // Only the standard-hours entry is overridden in the fixture.
    expect(await screen.findAllByRole('button', { name: 'Анхны утга' })).toHaveLength(1);
  });

  it('sends the reset for the chosen key', async () => {
    vi.spyOn(settingsService, 'get').mockResolvedValue(makeSettings());
    const reset = vi.spyOn(settingsService, 'reset').mockResolvedValue(makeSettings());
    const user = userEvent.setup();

    renderWithAuth(<SettingsPage />, {
      permissions: [PERMISSIONS.SETTINGS_VIEW, PERMISSIONS.SETTINGS_MANAGE],
    });

    await user.click(await screen.findByRole('button', { name: 'Анхны утга' }));

    await waitFor(() => {
      expect(reset).toHaveBeenCalledWith(SETTING_KEYS.SLA_STANDARD_HOURS);
    });
  });

  it('locks every control for a caller who may only read', async () => {
    vi.spyOn(settingsService, 'get').mockResolvedValue(makeSettings({ canManage: false }));

    renderWithAuth(<SettingsPage />, { permissions: [PERMISSIONS.SETTINGS_VIEW] });

    expect(await screen.findByLabelText('Яаралтай дуудлагын хугацаа')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Хадгалах/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Анхны утга' })).not.toBeInTheDocument();
    expect(screen.getByText(/зөвхөн харах горимд/)).toBeInTheDocument();
  });

  it('shows an error state when the catalogue cannot be loaded', async () => {
    vi.spyOn(settingsService, 'get').mockRejectedValue(
      new ApiError('Сервер алдаа', 'INTERNAL_ERROR', 500),
    );

    renderWithAuth(<SettingsPage />, { permissions: [PERMISSIONS.SETTINGS_VIEW] });

    expect(await screen.findByText('Сервер алдаа')).toBeInTheDocument();
  });
});
