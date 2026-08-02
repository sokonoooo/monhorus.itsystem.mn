import type { CustomerDto } from '@monhorus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { objectService } from '../../services/object.service';
import { userService } from '../../services/user.service';
import { renderWithAuth } from '../../test/render';
import { CreateUserModal } from './CreateUserModal';

function makeCustomer(overrides: Partial<CustomerDto> = {}): CustomerDto {
  return {
    id: 'c1',
    code: 'CT',
    name: 'Central Tower ХХК',
    registrationNumber: null,
    taxNumber: null,
    phone: null,
    email: null,
    address: null,
    contactPerson: null,
    responsibleEmployeeId: null,
    responsibleEmployeeName: null,
    notes: null,
    isActive: true,
    ...overrides,
  };
}

const CUSTOMER_LABEL = /^Харилцагч байгууллага/;

function renderModal(options: { role?: 'admin' | 'head_admin' | 'technician' } = {}): void {
  renderWithAuth(
    <CreateUserModal open onClose={() => undefined} onCreated={() => undefined} />,
    { role: options.role ?? 'head_admin' },
  );
}

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText(/^Бүтэн нэр/), 'Шинэ Хэрэглэгч');
  await user.type(screen.getByLabelText(/^Имэйл/), 'new.user@test.mn');
}

describe('CreateUserModal customer organisation link', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(objectService, 'customers').mockResolvedValue([
      makeCustomer(),
      makeCustomer({ id: 'c2', code: 'OT', name: 'Өөр Байгууллага ХХК' }),
    ]);
  });

  it('offers no organisation selector until the customer role is chosen', async () => {
    const user = userEvent.setup();
    renderModal();

    expect(screen.queryByLabelText(CUSTOMER_LABEL)).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/^Эрх/), 'technician');
    expect(screen.queryByLabelText(CUSTOMER_LABEL)).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/^Эрх/), 'customer');
    expect(await screen.findByLabelText(CUSTOMER_LABEL)).toBeInTheDocument();
  });

  it('withdraws the organisation selector when the role moves away from customer', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.selectOptions(screen.getByLabelText(/^Эрх/), 'customer');
    expect(await screen.findByLabelText(CUSTOMER_LABEL)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/^Эрх/), 'technician');
    expect(screen.queryByLabelText(CUSTOMER_LABEL)).not.toBeInTheDocument();
  });

  it('lists the organisations from the existing customer service', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.selectOptions(screen.getByLabelText(/^Эрх/), 'customer');

    const select = await screen.findByLabelText(CUSTOMER_LABEL);
    await waitFor(() => {
      expect(within(select).getByRole('option', { name: 'Central Tower ХХК' })).toBeInTheDocument();
    });
    expect(objectService.customers).toHaveBeenCalled();
  });

  it('refuses to submit a customer account with no organisation', async () => {
    const create = vi.spyOn(userService, 'create');
    const user = userEvent.setup();
    renderModal();

    await fillRequiredFields(user);
    await user.selectOptions(screen.getByLabelText(/^Эрх/), 'customer');
    await user.click(screen.getByRole('button', { name: 'Үүсгэх' }));

    expect(await screen.findByText('Байгууллага заавал сонгоно.')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('sends the chosen organisation to the service', async () => {
    const create = vi.spyOn(userService, 'create').mockResolvedValue({
      user: {
        id: 'u2',
        fullName: 'Шинэ Хэрэглэгч',
        email: 'new.user@test.mn',
        phone: null,
        role: 'customer',
        status: 'must_change_password',
        customerId: 'c2',
        customerName: 'Өөр Байгууллага ХХК',
        lastLoginAt: null,
        createdBy: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      temporaryPassword: 'TempPass2026x',
    });
    const user = userEvent.setup();
    renderModal();

    await fillRequiredFields(user);
    await user.selectOptions(screen.getByLabelText(/^Эрх/), 'customer');
    await user.selectOptions(await screen.findByLabelText(CUSTOMER_LABEL), 'c2');
    await user.click(screen.getByRole('button', { name: 'Үүсгэх' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'c2' }));
    });
  });

  it('sends no organisation for a staff account', async () => {
    const create = vi.spyOn(userService, 'create').mockRejectedValue(new Error('stop here'));
    const user = userEvent.setup();
    renderModal();

    await fillRequiredFields(user);
    await user.selectOptions(screen.getByLabelText(/^Эрх/), 'technician');
    await user.click(screen.getByRole('button', { name: 'Үүсгэх' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalled();
    });
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('customerId');
  });

  it('offers nothing to link for a caller who may not manage users', async () => {
    renderModal({ role: 'technician' });

    // The role list is derived from the same predicate the server enforces, so a caller
    // who cannot manage a customer account is never offered the role, and therefore never
    // reaches the organisation control at all.
    await waitFor(() => {
      expect(
        screen.queryByRole('option', { name: 'Харилцагч' }),
      ).not.toBeInTheDocument();
    });
    expect(screen.queryByLabelText(CUSTOMER_LABEL)).not.toBeInTheDocument();
    expect(objectService.customers).not.toHaveBeenCalled();
  });
});
