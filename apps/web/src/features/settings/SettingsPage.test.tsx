import { PERMISSIONS, SETTING_KEYS, type SettingsDto } from '@monhorus/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as fileUrl from '../../lib/file-url';
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
    // The read-only banner is gone from the page; the reason now lives in the help panel.
    // The locked controls above are the assertion that carries the behaviour.
    expect(screen.queryByText(/зөвхөн харах горимд/)).not.toBeInTheDocument();
  });

  it('shows an error state when the catalogue cannot be loaded', async () => {
    vi.spyOn(settingsService, 'get').mockRejectedValue(
      new ApiError('Сервер алдаа', 'INTERNAL_ERROR', 500),
    );

    renderWithAuth(<SettingsPage />, { permissions: [PERMISSIONS.SETTINGS_VIEW] });

    expect(await screen.findByText('Сервер алдаа')).toBeInTheDocument();
  });
});

/**
 * Report branding: the letterhead and the organisation that carried the inspection out.
 *
 * Both are `general` settings and neither is special to the save flow, which is exactly what
 * these tests hold in place. The logo is a `file`, so its draft is a stored-file id: it is
 * uploaded on pick, carried by the same drafts map as every typed value, and committed by
 * the same Хадгалах. The one thing that can silently go wrong is the id being coerced like a
 * number, so that has a test of its own.
 */
describe('SettingsPage branding', () => {
  const LOGO_FILE_ID = '507f1f77bcf86cd799439011';

  function brandingSettings(
    values: { logo?: string; inspectionCompany?: string } = {},
  ): SettingsDto {
    return {
      canManage: true,
      groups: [
        {
          group: 'general',
          label: 'Ерөнхий',
          description: 'Байгууллагын мэдээлэл.',
          entries: [
            {
              key: SETTING_KEYS.INSPECTION_COMPANY,
              group: 'general',
              label: 'Үзлэг хийсэн байгууллага',
              hint: 'Хоосон бол байгууллагын нэрийг хэрэглэнэ.',
              type: 'string',
              value: values.inspectionCompany ?? '',
              defaultValue: '',
              isOverridden: false,
              updatedByName: null,
              updatedAt: null,
            },
            {
              key: SETTING_KEYS.COMPANY_LOGO,
              group: 'general',
              label: 'Байгууллагын лого',
              hint: 'Тайлангийн толгой хэсэгт хэвлэгдэнэ.',
              // The type that makes this a picker instead of a text box.
              type: 'file',
              value: values.logo ?? '',
              defaultValue: '',
              isOverridden: values.logo !== undefined,
              updatedByName: null,
              updatedAt: null,
            },
          ],
        },
      ],
    };
  }

  function pngFile(name = 'logo.png'): File {
    return new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' });
  }

  function uploadResponse(id = LOGO_FILE_ID) {
    return {
      id,
      name: 'logo.png',
      downloadUrl: `/api/v1/files/${id}`,
      mimeType: 'image/png',
      sizeBytes: 4,
    };
  }

  function manager(): { permissions: readonly (typeof PERMISSIONS)[keyof typeof PERMISSIONS][] } {
    return { permissions: [PERMISSIONS.SETTINGS_VIEW, PERMISSIONS.SETTINGS_MANAGE] };
  }

  beforeEach(() => {
    // Every render of this group can reach for the stored logo, and an unmocked fetch would
    // be a real request; the tests that care assert on the spy.
    vi.spyOn(fileUrl, 'authorisedFileUrl').mockResolvedValue('blob:logo');
  });

  it('renders the logo as a file picker rather than a text box', async () => {
    vi.spyOn(settingsService, 'get').mockResolvedValue(brandingSettings());

    renderWithAuth(<SettingsPage />, manager());

    const input = await screen.findByLabelText('Байгууллагын лого');
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAttribute('accept', 'image/png,image/jpeg');
  });

  /**
   * `GET /files/:id` needs the bearer token, so the preview cannot be a bare `src` pointing
   * at the download route — that request goes out unauthenticated and comes back 401.
   */
  it('fetches the stored logo with the session token instead of linking to it', async () => {
    vi.spyOn(settingsService, 'get').mockResolvedValue(brandingSettings({ logo: LOGO_FILE_ID }));

    renderWithAuth(<SettingsPage />, manager());

    const preview = await screen.findByAltText('Байгууллагын лого');
    expect(preview).toHaveAttribute('src', 'blob:logo');
    expect(fileUrl.authorisedFileUrl).toHaveBeenCalledWith(`/api/v1/files/${LOGO_FILE_ID}`);
  });

  it('uploads the picked file and saves the id it returns', async () => {
    vi.spyOn(settingsService, 'get').mockResolvedValue(brandingSettings());
    const upload = vi
      .spyOn(settingsService, 'uploadLogo')
      .mockResolvedValue(uploadResponse());
    const update = vi
      .spyOn(settingsService, 'update')
      .mockResolvedValue(brandingSettings({ logo: LOGO_FILE_ID }));
    const user = userEvent.setup();

    renderWithAuth(<SettingsPage />, manager());

    await user.upload(await screen.findByLabelText('Байгууллагын лого'), pngFile());

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    // The upload alone changes nothing: the id is a draft until Хадгалах commits it.
    expect(update).not.toHaveBeenCalled();

    await user.click(await screen.findByRole('button', { name: /Хадгалах \(1\)/ }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({ [SETTING_KEYS.COMPANY_LOGO]: LOGO_FILE_ID });
    });
  });

  /**
   * The regression this whole field nearly shipped with.
   *
   * The payload used to be built as "string, or else `Number(...)`", and a stored-file id is
   * not a number: `Number('507f1f77bcf86cd799439011')` is NaN, which serialises to null and
   * would have cleared the logo at the exact moment the admin set one. Asserting the payload
   * shape rather than only its value is what catches a reintroduction.
   */
  it('sends a file id as a string, never coerced to a number', async () => {
    vi.spyOn(settingsService, 'get').mockResolvedValue(brandingSettings());
    vi.spyOn(settingsService, 'uploadLogo').mockResolvedValue(uploadResponse());
    const update = vi
      .spyOn(settingsService, 'update')
      .mockResolvedValue(brandingSettings({ logo: LOGO_FILE_ID }));
    const user = userEvent.setup();

    renderWithAuth(<SettingsPage />, manager());

    await user.upload(await screen.findByLabelText('Байгууллагын лого'), pngFile());
    await user.click(await screen.findByRole('button', { name: /Хадгалах \(1\)/ }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const sent = update.mock.calls[0]?.[0] as Record<string, unknown>;
    const value = sent[SETTING_KEYS.COMPANY_LOGO];
    expect(typeof value).toBe('string');
    expect(value).toBe(LOGO_FILE_ID);
  });

  it('clears the logo by saving an empty value', async () => {
    vi.spyOn(settingsService, 'get').mockResolvedValue(brandingSettings({ logo: LOGO_FILE_ID }));
    const update = vi.spyOn(settingsService, 'update').mockResolvedValue(brandingSettings());
    const user = userEvent.setup();

    renderWithAuth(<SettingsPage />, manager());

    await user.click(await screen.findByRole('button', { name: 'Лого устгах' }));
    // The preview goes with it, so the admin sees the report's fallback before saving.
    await waitFor(() => expect(screen.queryByAltText('Байгууллагын лого')).toBeNull());

    await user.click(screen.getByRole('button', { name: /Хадгалах \(1\)/ }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({ [SETTING_KEYS.COMPANY_LOGO]: '' });
    });
  });

  /**
   * The client check is a courtesy, and the point is the second assertion: a file the form
   * can already see is wrong never becomes a request. The server refuses the same thing
   * independently — that is the actual gate, and it is not what is tested here.
   */
  it('refuses a file that is not a PNG or JPEG without calling the endpoint', async () => {
    vi.spyOn(settingsService, 'get').mockResolvedValue(brandingSettings());
    const upload = vi.spyOn(settingsService, 'uploadLogo');
    // The accept attribute already keeps this out of a real picker; the check under test is
    // the one in the page, so the browser-level filter is stood down.
    const user = userEvent.setup({ applyAccept: false });

    renderWithAuth(<SettingsPage />, manager());

    await user.upload(
      await screen.findByLabelText('Байгууллагын лого'),
      new File(['%PDF-'], 'logo.pdf', { type: 'application/pdf' }),
    );

    expect(await screen.findByText('Зөвхөн PNG эсвэл JPEG зураг байршуулна уу.')).toBeVisible();
    expect(upload).not.toHaveBeenCalled();
  });

  it('refuses an oversized image without calling the endpoint', async () => {
    vi.spyOn(settingsService, 'get').mockResolvedValue(brandingSettings());
    const upload = vi.spyOn(settingsService, 'uploadLogo');
    const user = userEvent.setup();

    renderWithAuth(<SettingsPage />, manager());

    const oversize = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'huge.png', {
      type: 'image/png',
    });
    await user.upload(await screen.findByLabelText('Байгууллагын лого'), oversize);

    expect(await screen.findByText(/хэтрэхгүй байх ёстой/)).toBeVisible();
    expect(upload).not.toHaveBeenCalled();
  });

  /**
   * The inspection company is optional, and blank is a real answer rather than a half-filled
   * field: it means "the operator and the inspector are the same organisation", which is what
   * the report prints when the key is empty.
   */
  it('saves the inspection company cleared to an empty value', async () => {
    vi.spyOn(settingsService, 'get').mockResolvedValue(
      brandingSettings({ inspectionCompany: 'Монхорус Үзлэг ХХК' }),
    );
    const update = vi.spyOn(settingsService, 'update').mockResolvedValue(brandingSettings());
    const user = userEvent.setup();

    renderWithAuth(<SettingsPage />, manager());

    await user.clear(await screen.findByLabelText('Үзлэг хийсэн байгууллага'));
    await user.click(screen.getByRole('button', { name: /Хадгалах \(1\)/ }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({ [SETTING_KEYS.INSPECTION_COMPANY]: '' });
    });
    // Saved, not rejected: the success toast is the page's own word that nothing came back
    // as a validation error against the field.
    expect(await screen.findByText('1 тохиргоо хадгалагдлаа.')).toBeInTheDocument();
  });

  it('types the inspection company like any other string setting', async () => {
    vi.spyOn(settingsService, 'get').mockResolvedValue(brandingSettings());
    const update = vi.spyOn(settingsService, 'update').mockResolvedValue(brandingSettings());
    const user = userEvent.setup();

    renderWithAuth(<SettingsPage />, manager());

    const field = await screen.findByLabelText('Үзлэг хийсэн байгууллага');
    expect(field).toHaveAttribute('type', 'text');
    await user.type(field, 'Шинэ ХХК');
    await user.click(screen.getByRole('button', { name: /Хадгалах \(1\)/ }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith({ [SETTING_KEYS.INSPECTION_COMPANY]: 'Шинэ ХХК' });
    });
  });
});
