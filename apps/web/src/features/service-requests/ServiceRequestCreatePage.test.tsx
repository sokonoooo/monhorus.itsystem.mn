import { PERMISSIONS, type ObjectNodeDto } from '@monhorus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { objectService } from '../../services/object.service';
import { serviceRequestService } from '../../services/service-request.service';
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

describe('ServiceRequestCreatePage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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

  it('shows the SLA hint that matches the urgency toggle', async () => {
    const user = userEvent.setup();

    renderWithAuth(<ServiceRequestCreatePage />, {
      permissions: [PERMISSIONS.SERVICE_REQUEST_CREATE],
    });

    expect(await screen.findByText('SLA 24 цаг')).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /Яаралтай дуудлага/ }));
    expect(await screen.findByText('SLA 6 цаг')).toBeInTheDocument();
  });
});
