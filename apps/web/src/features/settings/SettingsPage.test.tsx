import {
  DEFAULT_RISK_BANDS,
  DEFAULT_SERVICE_REQUEST_STAGES,
  PERMISSIONS,
  SETTING_KEYS,
  type RiskBandConfig,
  type ServiceRequestStage,
  type SettingsDto,
} from '@monhorus/shared';
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

/**
 * The stage list: the one setting whose value is an ordered array rather than a scalar.
 *
 * What these hold in place is that being an array changes nothing about the page around it.
 * The draft still lives in the same map, the dirty count still counts it as one key, and
 * Хадгалах still sends only what changed — the difference is that the value it sends is the
 * whole list, in the order shown, because that order IS the configuration.
 */
describe('SettingsPage stages', () => {
  function stageSettings(overrides: Partial<SettingsDto> = {}): SettingsDto {
    return {
      canManage: true,
      groups: [
        {
          group: 'workflow',
          label: 'Ажлын урсгал',
          description: 'Үйлчилгээний хүсэлтийн үе шат.',
          entries: [
            {
              key: SETTING_KEYS.REQUEST_STAGES,
              group: 'workflow',
              label: 'Хүсэлтийн үе шат',
              hint: 'Төлөв бүр яг нэг үе шатанд хамаарна.',
              // The type that makes this a list editor instead of a text box.
              type: 'stages',
              value: DEFAULT_SERVICE_REQUEST_STAGES,
              defaultValue: DEFAULT_SERVICE_REQUEST_STAGES,
              isOverridden: false,
              updatedByName: null,
              updatedAt: null,
            },
          ],
        },
      ],
      ...overrides,
    };
  }

  function manager(): { permissions: readonly (typeof PERMISSIONS)[keyof typeof PERMISSIONS][] } {
    return { permissions: [PERMISSIONS.SETTINGS_VIEW, PERMISSIONS.SETTINGS_MANAGE] };
  }

  /** The stage array the page actually sent, for the tests that assert on the payload. */
  function sentStages(update: { mock: { calls: unknown[][] } }): ServiceRequestStage[] {
    const payload = update.mock.calls[0]?.[0] as Record<string, unknown>;
    return payload[SETTING_KEYS.REQUEST_STAGES] as ServiceRequestStage[];
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders every configured stage in its saved order', async () => {
    vi.spyOn(settingsService, 'get').mockResolvedValue(stageSettings());

    renderWithAuth(<SettingsPage />, manager());

    expect(await screen.findByLabelText('Үе шат 1 нэр')).toHaveValue('Нээлттэй');
    expect(screen.getByLabelText('Үе шат 6 нэр')).toHaveValue('Дууссан');
    expect(screen.getByLabelText('Үе шат 9 нэр')).toHaveValue('Цуцалсан');
    // Nine and no more: the fixture is the shipped default.
    expect(screen.queryByLabelText('Үе шат 10 нэр')).toBeNull();
  });

  /**
   * A rename is one changed key, and the key it changes is the label — never the stable
   * identifier saved filters and board columns join on.
   */
  it('counts a renamed stage as one change and submits the whole list', async () => {
    vi.spyOn(settingsService, 'get').mockResolvedValue(stageSettings());
    const update = vi.spyOn(settingsService, 'update').mockResolvedValue(stageSettings());
    const user = userEvent.setup();

    renderWithAuth(<SettingsPage />, manager());

    const label = await screen.findByLabelText('Үе шат 1 нэр');
    await user.clear(label);
    await user.type(label, 'Түр');

    await user.click(screen.getByRole('button', { name: /Хадгалах \(1\)/ }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const stages = sentStages(update);
    expect(stages).toHaveLength(9);
    expect(stages[0]?.label).toBe('Түр');
    expect(stages[0]?.key).toBe('OPEN');
    expect(stages[0]?.statuses).toEqual(['NEW', 'UNASSIGNED']);
  });

  it('reorders the list when a row is moved up, and saves that order', async () => {
    vi.spyOn(settingsService, 'get').mockResolvedValue(stageSettings());
    const update = vi.spyOn(settingsService, 'update').mockResolvedValue(stageSettings());
    const user = userEvent.setup();

    renderWithAuth(<SettingsPage />, manager());

    await user.click(await screen.findByLabelText('Хуваарилагдсан дээш'));

    expect(screen.getByLabelText('Үе шат 1 нэр')).toHaveValue('Хуваарилагдсан');
    expect(screen.getByLabelText('Үе шат 2 нэр')).toHaveValue('Нээлттэй');

    await user.click(screen.getByRole('button', { name: /Хадгалах \(1\)/ }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(sentStages(update).map((stage) => stage.key).slice(0, 2)).toEqual(['ASSIGNED', 'OPEN']);
  });

  /**
   * The fault a stage editor exists to catch: a status pulled out of one group belongs to
   * nothing until it is put into another, and a request in that status would then have
   * nowhere to appear. It is reported as the admin edits, not after a rejected save.
   */
  it('reports a status that no longer belongs to any stage', async () => {
    vi.spyOn(settingsService, 'get').mockResolvedValue(stageSettings());
    const user = userEvent.setup();

    renderWithAuth(<SettingsPage />, manager());

    await user.click(await screen.findByLabelText('Үе шат 1: Шинэ'));

    expect(
      await screen.findByText('«NEW» төлөв ямар ч үе шатанд хамаарахгүй байна.'),
    ).toBeVisible();
  });

  it('shows a read-only caller the configuration without a single control', async () => {
    vi.spyOn(settingsService, 'get').mockResolvedValue(stageSettings({ canManage: false }));

    renderWithAuth(<SettingsPage />, { permissions: [PERMISSIONS.SETTINGS_VIEW] });

    // The stages are still readable — this is a view of the configuration, not a blank.
    expect(await screen.findByText('Нээлттэй')).toBeInTheDocument();
    // And so is what each one covers, which is the part a summary could quietly drop.
    expect(screen.getByText('Дүгнэлт илгээсэн, Баталгаажуулах, Дууссан')).toBeInTheDocument();

    expect(screen.queryByLabelText('Үе шат 1 нэр')).toBeNull();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /устгах/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Үе шат нэмэх' })).toBeNull();
  });
});


describe('SettingsPage risk bands', () => {
  function bandSettings(overrides: Partial<SettingsDto> = {}): SettingsDto {
    return {
      canManage: true,
      groups: [
        {
          group: 'evaluation',
          label: 'Үнэлгээний түвшин',
          description: '0-100 оноог хэдэн түвшинд хуваах.',
          entries: [
            {
              key: SETTING_KEYS.EVAL_RISK_BANDS,
              group: 'evaluation',
              label: 'Эрсдэлийн түвшин',
              hint: 'Доод түвшин 0 оноогоор эхэлнэ.',
              // The type that makes this a ladder editor instead of a text box.
              type: 'riskBands',
              value: DEFAULT_RISK_BANDS,
              defaultValue: DEFAULT_RISK_BANDS,
              isOverridden: false,
              updatedByName: null,
              updatedAt: null,
            },
          ],
        },
      ],
      ...overrides,
    };
  }

  function manager(): { permissions: readonly (typeof PERMISSIONS)[keyof typeof PERMISSIONS][] } {
    return { permissions: [PERMISSIONS.SETTINGS_VIEW, PERMISSIONS.SETTINGS_MANAGE] };
  }

  /** The ladder the page actually sent, for the tests that assert on the payload. */
  function sentBands(update: { mock: { calls: unknown[][] } }): RiskBandConfig[] {
    const payload = update.mock.calls[0]?.[0] as Record<string, unknown>;
    return payload[SETTING_KEYS.EVAL_RISK_BANDS] as RiskBandConfig[];
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders every configured band in its saved order', async () => {
    vi.spyOn(settingsService, 'get').mockResolvedValue(bandSettings());

    renderWithAuth(<SettingsPage />, manager());

    // Worst-first, the order the shipped ladder is written in.
    expect(await screen.findByLabelText('Түвшин 1 нэр')).toHaveValue('Ашиглах боломжгүй');
    expect(screen.getByLabelText('Түвшин 5 нэр')).toHaveValue('Хэвийн');
    expect(screen.queryByLabelText('Түвшин 6 нэр')).toBeNull();
  });

  /**
   * The top of a band cannot be typed — it is the next band's minimum minus one — so the
   * range is the one thing on the row that only the editor can show. It is what makes a
   * hole in the ladder visible before Хадгалах rather than after.
   */
  it('shows each band the score range it actually owns', async () => {
    vi.spyOn(settingsService, 'get').mockResolvedValue(bandSettings());

    renderWithAuth(<SettingsPage />, manager());

    expect(await screen.findByText('0-20 оноо')).toBeInTheDocument();
    expect(screen.getByText('41-60 оноо')).toBeInTheDocument();
    expect(screen.getByText('81-100 оноо')).toBeInTheDocument();
  });

  /** A rename moves the label and nothing else: the key is what history joins on. */
  it('counts a renamed band as one change and submits the whole ladder', async () => {
    vi.spyOn(settingsService, 'get').mockResolvedValue(bandSettings());
    const update = vi.spyOn(settingsService, 'update').mockResolvedValue(bandSettings());
    const user = userEvent.setup();

    renderWithAuth(<SettingsPage />, manager());

    const label = await screen.findByLabelText('Түвшин 5 нэр');
    await user.clear(label);
    await user.type(label, 'Аюулгүй');

    await user.click(screen.getByRole('button', { name: /Хадгалах \(1\)/ }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    const bands = sentBands(update);
    expect(bands).toHaveLength(5);
    expect(bands[4]?.label).toBe('Аюулгүй');
    expect(bands[4]?.key).toBe('NORMAL');
    expect(bands[4]?.minScore).toBe(81);
  });

  it('saves a re-cut boundary and the colour picked for a band', async () => {
    vi.spyOn(settingsService, 'get').mockResolvedValue(bandSettings());
    const update = vi.spyOn(settingsService, 'update').mockResolvedValue(bandSettings());
    const user = userEvent.setup();

    renderWithAuth(<SettingsPage />, manager());

    const minScore = await screen.findByLabelText('Түвшин 5 доод оноо');
    await user.clear(minScore);
    await user.type(minScore, '90');
    await user.selectOptions(screen.getByLabelText('Түвшин 5 өнгө'), 'blue');

    // The row above re-tiles on its own, which is the whole point of deriving the top.
    expect(screen.getByText('61-89 оноо')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Хадгалах \(1\)/ }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(sentBands(update)[4]).toMatchObject({ minScore: 90, colour: 'blue' });
  });

  /**
   * The fault this editor exists to catch: the ladder must still tile 0..100 after an edit,
   * or a score would land in no band at all. Reported as the admin types, not after a
   * rejected save.
   */
  it('reports a ladder that no longer starts at zero', async () => {
    vi.spyOn(settingsService, 'get').mockResolvedValue(bandSettings());
    const user = userEvent.setup();

    renderWithAuth(<SettingsPage />, manager());

    const minScore = await screen.findByLabelText('Түвшин 1 доод оноо');
    await user.clear(minScore);
    await user.type(minScore, '5');

    expect(await screen.findByText('Хамгийн доод түвшин 0 оноогоор эхэлнэ.')).toBeVisible();
  });

  /** Exactly one band may take the equipment out of service; it is an irreversible write. */
  it('reports a second band that also decommissions', async () => {
    vi.spyOn(settingsService, 'get').mockResolvedValue(bandSettings());
    const user = userEvent.setup();

    renderWithAuth(<SettingsPage />, manager());

    await user.click(await screen.findByLabelText('Түвшин 2: Ашиглалтаас гаргана'));

    expect(
      await screen.findByText('Зөвхөн нэг түвшин тоноглолыг ашиглалтаас гаргана.'),
    ).toBeVisible();
  });

  /**
   * A new band can only take a key from the reserved list, so the vocabulary a score is
   * STORED as never widens and no assessment ever needs rewriting.
   */
  it('gives a new band the next reserved key, and stops at the last one', async () => {
    vi.spyOn(settingsService, 'get').mockResolvedValue(bandSettings());
    const user = userEvent.setup();

    renderWithAuth(<SettingsPage />, manager());

    const add = await screen.findByRole('button', { name: 'Түвшин нэмэх' });
    await user.click(add);
    expect(screen.getByText('BAND_6')).toBeInTheDocument();

    await user.click(add);
    await user.click(add);
    expect(screen.getByText('BAND_8')).toBeInTheDocument();
    // Eight reserved keys, and no ninth to hand out.
    expect(add).toBeDisabled();
  });

  it('shows a read-only caller the ladder without a single control', async () => {
    vi.spyOn(settingsService, 'get').mockResolvedValue(bandSettings({ canManage: false }));

    renderWithAuth(<SettingsPage />, { permissions: [PERMISSIONS.SETTINGS_VIEW] });

    // Still readable — this is a view of the configuration, not a blank.
    expect(await screen.findByText('Ашиглах боломжгүй')).toBeInTheDocument();
    expect(screen.getByText('0-20')).toBeInTheDocument();
    // And what the band demands, which is the part a summary could quietly drop.
    expect(
      screen.getByText('Дүгнэлт заавал, Зөвлөмж заавал, Ашиглалтаас гаргана, Мэдэгдэл илгээнэ'),
    ).toBeInTheDocument();

    expect(screen.queryByLabelText('Түвшин 1 нэр')).toBeNull();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Түвшин нэмэх' })).toBeNull();
  });
});
