import {
  PERMISSIONS,
  SETTING_KEYS,
  type ObjectNodeDto,
  type SettingEntryDto,
  type SettingKey,
  type SettingsDto,
} from '@monhorus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invalidateSlaHours } from '../../hooks/use-sla-hours';
import { ApiError } from '../../lib/api-client';
import * as fileUrl from '../../lib/file-url';
import { objectService } from '../../services/object.service';
import { serviceRequestService } from '../../services/service-request.service';
import { settingsService } from '../../services/settings.service';
import { makeCustomer, makeObjectNode } from '../../test/fixtures';
import { renderWithAuth } from '../../test/render';
import { ServiceRequestCreatePage } from './ServiceRequestCreatePage';

const CUSTOMER = makeCustomer();

function node(id: string, kind: ObjectNodeDto['kind'], name: string): ObjectNodeDto {
  return makeObjectNode({ id, kind, code: name, name, customerId: CUSTOMER.id });
}

const PROJECT = node('507f1f77bcf86cd799439021', 'PROJECT', 'Preventive Service');
const BUILDING = node('507f1f77bcf86cd799439022', 'BUILDING', 'Main Tower');

/** Finds the select that contains an option with the given label. */
function selectContainingOption(label: string): HTMLSelectElement | undefined {
  return screen
    .getAllByRole('combobox')
    .find((element) => within(element).queryByRole('option', { name: label })) as
    | HTMLSelectElement
    | undefined;
}

/** A settings payload carrying just the two SLA windows the form reads. */
function slaSettings(urgent: number, standard: number): SettingsDto {
  const entry = (key: SettingKey, value: number): SettingEntryDto => ({
    key,
    group: 'sla',
    label: key,
    hint: '',
    type: 'integer',
    value,
    defaultValue: value,
    isOverridden: false,
    min: 1,
    max: 720,
    unit: 'цаг',
    updatedByName: null,
    updatedAt: null,
  });

  return {
    canManage: false,
    groups: [
      {
        group: 'sla',
        label: 'SLA',
        description: '',
        entries: [
          entry(SETTING_KEYS.SLA_URGENT_HOURS, urgent),
          entry(SETTING_KEYS.SLA_STANDARD_HOURS, standard),
        ],
      },
    ],
  };
}

describe('ServiceRequestCreatePage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // The hook caches a successful read for the page's lifetime, which in a suite is
    // the whole file.
    invalidateSlaHours();
    vi.spyOn(objectService, 'customers').mockResolvedValue([CUSTOMER]);
    vi.spyOn(objectService, 'rootNodes').mockResolvedValue([PROJECT]);
    vi.spyOn(objectService, 'children').mockResolvedValue([BUILDING]);
  });

  it('blocks submission and reports required fields', async () => {
    const create = vi.spyOn(serviceRequestService, 'create');
    const user = userEvent.setup();

    renderWithAuth(<ServiceRequestCreatePage />, {
      permissions: [PERMISSIONS.SERVICE_REQUEST_CREATE],
    });

    await user.click(await screen.findByRole('button', { name: 'Хүсэлт үүсгэх' }));

    expect(
      await screen.findByText('Оруулсан мэдээлэл шаардлага хангахгүй байна.'),
    ).toBeInTheDocument();
    // Validation runs locally against the shared schema, so nothing is sent.
    expect(create).not.toHaveBeenCalled();
  });

  it('loads projects only after a customer is chosen', async () => {
    const user = userEvent.setup();

    renderWithAuth(<ServiceRequestCreatePage />, {
      permissions: [PERMISSIONS.SERVICE_REQUEST_CREATE],
    });

    const customerSelect = await screen.findByDisplayValue('Харилцагч сонгох');
    expect(objectService.rootNodes).not.toHaveBeenCalled();

    await user.selectOptions(customerSelect, CUSTOMER.id);

    await waitFor(() => {
      expect(objectService.rootNodes).toHaveBeenCalledWith(CUSTOMER.id, 'PROJECT');
    });
  });

  it('loads the next level when a project is chosen', async () => {
    const user = userEvent.setup();

    renderWithAuth(<ServiceRequestCreatePage />, {
      permissions: [PERMISSIONS.SERVICE_REQUEST_CREATE],
    });

    await user.selectOptions(
      await screen.findByDisplayValue('Харилцагч сонгох'),
      CUSTOMER.id,
    );

    await waitFor(() => {
      expect(selectContainingOption('Preventive Service')).toBeDefined();
    });

    const projectSelect = selectContainingOption('Preventive Service');
    expect(projectSelect).toBeDefined();
    await user.selectOptions(projectSelect as HTMLSelectElement, PROJECT.id);

    await waitFor(() => {
      expect(objectService.children).toHaveBeenCalledWith(PROJECT.id);
    });
  });

  it('clears the project selection when the customer is reset', async () => {
    const user = userEvent.setup();

    renderWithAuth(<ServiceRequestCreatePage />, {
      permissions: [PERMISSIONS.SERVICE_REQUEST_CREATE],
    });

    const customerSelect = await screen.findByDisplayValue('Харилцагч сонгох');
    await user.selectOptions(customerSelect, CUSTOMER.id);

    await waitFor(() => {
      expect(selectContainingOption('Preventive Service')).toBeDefined();
    });

    const projectSelect = selectContainingOption('Preventive Service') as HTMLSelectElement;
    await user.selectOptions(projectSelect, PROJECT.id);
    expect(projectSelect.value).toBe(PROJECT.id);

    // Changing the parent must invalidate every deeper selection, so a stale id
    // can never reach the API.
    await user.selectOptions(customerSelect, '');

    await waitFor(() => {
      const cleared = screen.getAllByRole('combobox') as HTMLSelectElement[];
      expect(cleared.every((element) => element.value !== PROJECT.id)).toBe(true);
    });
  });

  it('parks an attachment on upload and drops it again on remove', async () => {
    // Two-phase: the file is stored the moment it is chosen and only claimed by the
    // request on submit, so the draft holds the stored file rather than the File.
    const upload = vi.spyOn(serviceRequestService, 'uploadAttachment').mockResolvedValue({
      id: '507f1f77bcf86cd799439055',
      name: 'panel.jpg',
      downloadUrl: '/api/v1/files/507f1f77bcf86cd799439055',
      mimeType: 'image/jpeg',
      sizeBytes: 2048,
      uploadedByName: 'Тест Хэрэглэгч',
      uploadedAt: '2026-08-01T00:00:00.000Z',
    });
    vi.spyOn(fileUrl, 'authorisedFileUrl').mockResolvedValue('blob:attachment');
    const user = userEvent.setup();

    renderWithAuth(<ServiceRequestCreatePage />, {
      permissions: [PERMISSIONS.SERVICE_REQUEST_CREATE],
    });

    expect(await screen.findByText('Хавсралт байхгүй байна.')).toBeInTheDocument();

    await user.upload(
      screen.getByLabelText('Хавсралт сонгох'),
      new File(['x'], 'panel.jpg', { type: 'image/jpeg' }),
    );

    await waitFor(() => expect(upload).toHaveBeenCalled());
    expect(await screen.findByRole('img', { name: 'panel.jpg' })).toHaveAttribute(
      'src',
      'blob:attachment',
    );

    await user.click(screen.getByRole('button', { name: 'panel.jpg хасах' }));
    expect(await screen.findByText('Хавсралт байхгүй байна.')).toBeInTheDocument();
  });

  it('shows the SLA hours the settings actually hold, not 6/24', async () => {
    const user = userEvent.setup();
    vi.spyOn(settingsService, 'get').mockResolvedValue(slaSettings(4, 48));

    renderWithAuth(<ServiceRequestCreatePage />, {
      permissions: [PERMISSIONS.SERVICE_REQUEST_CREATE, PERMISSIONS.SETTINGS_VIEW],
    });

    // The shipped defaults are 6 and 24; this installation runs 4 and 48, and the
    // deadline the backend computes follows the settings, not the constants.
    expect(await screen.findByText('SLA 48 цаг')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /Яаралтай дуудлага/ }));
    expect(await screen.findByText('SLA 4 цаг')).toBeInTheDocument();
  });

  it('says nothing about the SLA when the setting cannot be read', async () => {
    const get = vi
      .spyOn(settingsService, 'get')
      .mockRejectedValue(new ApiError('Энэ үйлдлийг хийх эрх байхгүй байна.', 'FORBIDDEN', 403));

    renderWithAuth(<ServiceRequestCreatePage />, {
      permissions: [PERMISSIONS.SERVICE_REQUEST_CREATE, PERMISSIONS.SETTINGS_VIEW],
    });

    await waitFor(() => expect(get).toHaveBeenCalled());
    // No fallback to the shipped 6/24: a number presented as the rule that may not be
    // the rule is worse than no number, because the form is a promise to the customer.
    await waitFor(() => expect(screen.queryByText(/SLA/)).not.toBeInTheDocument());
  });

  it('does not ask for settings a request-creating role may not read', async () => {
    const get = vi.spyOn(settingsService, 'get').mockResolvedValue(slaSettings(6, 24));

    // DISPATCH and SALES can raise a request and hold no `settings.view`; GET /settings
    // would 403 for them.
    renderWithAuth(<ServiceRequestCreatePage />, {
      permissions: [PERMISSIONS.SERVICE_REQUEST_CREATE],
    });

    expect(await screen.findByRole('button', { name: 'Хүсэлт үүсгэх' })).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
    expect(screen.queryByText(/SLA/)).not.toBeInTheDocument();
  });
});
