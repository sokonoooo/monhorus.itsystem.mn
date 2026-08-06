import {
  PERMISSIONS,
  SETTING_KEYS,
  type ObjectNodeDto,
  type SettingEntryDto,
  type SettingKey,
  type SettingsDto,
} from '@monhorus/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invalidateSlaHours } from '../../hooks/use-sla-hours';
import { ApiError } from '../../lib/api-client';
import * as fileUrl from '../../lib/file-url';
import { objectService } from '../../services/object.service';
import { projectService } from '../../services/project.service';
import { serviceRequestService } from '../../services/service-request.service';
import { settingsService } from '../../services/settings.service';
import { makeCustomer, makeFloorPlan, makeObjectNode } from '../../test/fixtures';
import { renderWithAuth } from '../../test/render';
import { ServiceRequestCreatePage } from './ServiceRequestCreatePage';

const CUSTOMER = makeCustomer();

function node(id: string, kind: ObjectNodeDto['kind'], name: string): ObjectNodeDto {
  return makeObjectNode({ id, kind, code: name, name, customerId: CUSTOMER.id });
}

const PROJECT = node('507f1f77bcf86cd799439021', 'PROJECT', 'Preventive Service');
const BUILDING = node('507f1f77bcf86cd799439022', 'BUILDING', 'Main Tower');
const FLOOR = node('507f1f77bcf86cd799439023', 'FLOOR', '2 давхар');
const ZONE = node('507f1f77bcf86cd799439024', 'ROOM', '201 тоот');

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

  /**
   * The zone dropdown and the plan pin.
   *
   * The Өрөө/Бүс level was always rendered and always empty, because nothing in the app
   * wrote it. With zones registered it populates from the same chain as every other level,
   * and the plan pin sits beside it: the caller who cannot name a zone can still point at
   * the spot, which is why the pin depends on the floor and not on the zone.
   */
  describe('zone and plan pin', () => {
    /** The chain one level at a time, so each level answers with its own children. */
    function mockChain(): void {
      vi.spyOn(objectService, 'children').mockImplementation(async (parentId: string) => {
        if (parentId === PROJECT.id) return [BUILDING];
        if (parentId === BUILDING.id) return [FLOOR];
        if (parentId === FLOOR.id) return [ZONE];
        return [];
      });
    }

    /**
     * The plan image laid out at a known size.
     *
     * The coordinate model is "a fraction of the rendered box" and jsdom lays nothing out,
     * so the box is stated here and the assertion is about the fraction that comes back —
     * the same arrangement the object placement suite uses, because it is the same geometry.
     */
    function layOutImage(image: HTMLElement, width = 400, height = 200): void {
      vi.spyOn(image, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        right: width,
        bottom: height,
        width,
        height,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect);
    }

    async function chooseLocation(
      user: ReturnType<typeof userEvent.setup>,
      depth: 'floor' | 'zone',
    ): Promise<void> {
      await user.selectOptions(await screen.findByDisplayValue('Харилцагч сонгох'), CUSTOMER.id);

      await waitFor(() => expect(selectContainingOption('Preventive Service')).toBeDefined());
      await user.selectOptions(
        selectContainingOption('Preventive Service') as HTMLSelectElement,
        PROJECT.id,
      );

      await waitFor(() => expect(selectContainingOption('Main Tower')).toBeDefined());
      await user.selectOptions(
        selectContainingOption('Main Tower') as HTMLSelectElement,
        BUILDING.id,
      );

      await waitFor(() => expect(selectContainingOption('2 давхар')).toBeDefined());
      await user.selectOptions(selectContainingOption('2 давхар') as HTMLSelectElement, FLOOR.id);

      if (depth === 'zone') {
        await waitFor(() => expect(selectContainingOption('201 тоот')).toBeDefined());
        await user.selectOptions(selectContainingOption('201 тоот') as HTMLSelectElement, ZONE.id);
      }
    }

    async function fillRequiredFields(
      user: ReturnType<typeof userEvent.setup>,
    ): Promise<void> {
      await user.selectOptions(
        selectContainingOption('Яаралтай дуудлага') as HTMLSelectElement,
        'URGENT_CALL',
      );
      await user.type(screen.getByLabelText(/^Холбоо барих хүн/), 'Д. Болор');
      await user.type(screen.getByLabelText(/^Холбоо барих утас/), '9911-2233');
      await user.type(screen.getByLabelText(/^Тайлбар/), 'Самбар оч гаргаж байна.');
    }

    beforeEach(() => {
      mockChain();
      vi.spyOn(fileUrl, 'authorisedFileUrl').mockResolvedValue('blob:plan');
      vi.spyOn(projectService, 'getFloorPlan').mockResolvedValue(makeFloorPlan());
    });

    it('offers the zones of the chosen floor and sends the one picked as roomId', async () => {
      const create = vi
        .spyOn(serviceRequestService, 'create')
        .mockResolvedValue({ id: 'r1', requestNumber: 'SR-1' } as never);
      const user = userEvent.setup();

      renderWithAuth(<ServiceRequestCreatePage />, {
        permissions: [PERMISSIONS.SERVICE_REQUEST_CREATE],
      });

      await chooseLocation(user, 'zone');
      await fillRequiredFields(user);
      await user.click(screen.getByRole('button', { name: 'Хүсэлт үүсгэх' }));

      await waitFor(() => {
        expect(create).toHaveBeenCalledWith(
          expect.objectContaining({ floorId: FLOOR.id, roomId: ZONE.id }),
        );
      });
    });

    it('sends the clicked spot as a normalised planPosition', async () => {
      const create = vi
        .spyOn(serviceRequestService, 'create')
        .mockResolvedValue({ id: 'r1', requestNumber: 'SR-1' } as never);
      const user = userEvent.setup();

      renderWithAuth(<ServiceRequestCreatePage />, {
        permissions: [PERMISSIONS.SERVICE_REQUEST_CREATE],
      });

      await chooseLocation(user, 'floor');

      const image = await screen.findByAltText('2 давхарын төлөвлөгөө');
      layOutImage(image);
      // A quarter across and halfway down the drawing.
      fireEvent.pointerUp(image, { clientX: 100, clientY: 100 });

      expect(await screen.findByRole('img', { name: 'План дээр тэмдэглэсэн байрлал' })).toHaveStyle(
        { left: '25%', top: '50%' },
      );

      await fillRequiredFields(user);
      await user.click(screen.getByRole('button', { name: 'Хүсэлт үүсгэх' }));

      await waitFor(() => {
        expect(create).toHaveBeenCalledWith(
          // A pin with no zone is allowed: pointing at the spot does not require the zone
          // to have been registered.
          expect.objectContaining({
            floorId: FLOOR.id,
            roomId: null,
            planPosition: { x: 0.25, y: 0.5 },
          }),
        );
      });
    });

    it('moves the pin on a second click and can clear it again', async () => {
      const user = userEvent.setup();

      renderWithAuth(<ServiceRequestCreatePage />, {
        permissions: [PERMISSIONS.SERVICE_REQUEST_CREATE],
      });

      await chooseLocation(user, 'floor');

      const image = await screen.findByAltText('2 давхарын төлөвлөгөө');
      layOutImage(image);
      fireEvent.pointerUp(image, { clientX: 100, clientY: 100 });
      await screen.findByRole('img', { name: 'План дээр тэмдэглэсэн байрлал' });

      fireEvent.pointerUp(image, { clientX: 300, clientY: 50 });
      await waitFor(() => {
        expect(screen.getByRole('img', { name: 'План дээр тэмдэглэсэн байрлал' })).toHaveStyle({
          left: '75%',
          top: '25%',
        });
      });

      await user.click(screen.getByRole('button', { name: 'Тэмдэглэгээ арилгах' }));
      expect(
        screen.queryByRole('img', { name: 'План дээр тэмдэглэсэн байрлал' }),
      ).not.toBeInTheDocument();
    });

    /** No drawing means nothing to point at; a sentence rather than a dead area. */
    it('offers no pin control on a floor with no plan image', async () => {
      vi.spyOn(projectService, 'getFloorPlan').mockResolvedValue(null);
      const user = userEvent.setup();

      renderWithAuth(<ServiceRequestCreatePage />, {
        permissions: [PERMISSIONS.SERVICE_REQUEST_CREATE],
      });

      await chooseLocation(user, 'floor');

      expect(
        await screen.findByText(/Энэ давхарт план зураг хавсаргаагүй тул байрлал тэмдэглэх/),
      ).toBeInTheDocument();
      expect(screen.queryByAltText('2 давхарын төлөвлөгөө')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('img', { name: 'План дээр тэмдэглэсэн байрлал' }),
      ).not.toBeInTheDocument();
    });

    /** Both are optional: an untouched form submits exactly what it always did. */
    it('sends neither a zone nor a position when neither was touched', async () => {
      const create = vi
        .spyOn(serviceRequestService, 'create')
        .mockResolvedValue({ id: 'r1', requestNumber: 'SR-1' } as never);
      const user = userEvent.setup();

      renderWithAuth(<ServiceRequestCreatePage />, {
        permissions: [PERMISSIONS.SERVICE_REQUEST_CREATE],
      });

      await user.selectOptions(await screen.findByDisplayValue('Харилцагч сонгох'), CUSTOMER.id);
      await waitFor(() => expect(selectContainingOption('Preventive Service')).toBeDefined());
      await user.selectOptions(
        selectContainingOption('Preventive Service') as HTMLSelectElement,
        PROJECT.id,
      );
      await waitFor(() => expect(selectContainingOption('Main Tower')).toBeDefined());
      await user.selectOptions(
        selectContainingOption('Main Tower') as HTMLSelectElement,
        BUILDING.id,
      );

      // No floor chosen, so there is nothing to pin against and it says so.
      expect(
        screen.getByText('Давхар сонгосны дараа план зураг дээр байрлал тэмдэглэх боломжтой.'),
      ).toBeInTheDocument();

      await fillRequiredFields(user);
      await user.click(screen.getByRole('button', { name: 'Хүсэлт үүсгэх' }));

      await waitFor(() => expect(create).toHaveBeenCalled());
      const payload = create.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(payload.roomId).toBeNull();
      expect('planPosition' in payload).toBe(false);
    });
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
