import { PERMISSIONS } from '@monhorus/shared';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../lib/api-client';
import { objectService } from '../../services/object.service';
import { dispatchService } from '../../services/service-request.service';
import { renderWithAuth } from '../../test/render';
import { CustomerFormPage } from './CustomerFormPage';

/** Fills the two required fields by their visible label. */
async function fillRequired(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText(/^Код/), 'CT');
  await user.type(screen.getByLabelText(/^Байгууллагын нэр/), 'Central Tower ХХК');
}

describe('CustomerFormPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(dispatchService, 'employeeCandidates').mockResolvedValue([]);
  });

  it('offers organisation fields only, with no customer-type choice', async () => {
    renderWithAuth(<CustomerFormPage />, { permissions: [PERMISSIONS.CUSTOMER_MANAGE] });

    // Requirements rule 17.2. The admin prototype offers an individual-customer
    // option; it is deliberately not reproduced, so only organisation identifiers exist.
    expect(await screen.findByLabelText(/^Байгууллагын нэр/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Регистрийн дугаар/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Татвар төлөгчийн дугаар/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Харилцагчийн төрөл/)).not.toBeInTheDocument();
  });

  it('blocks submission and reports required fields', async () => {
    const create = vi.spyOn(objectService, 'createCustomer');
    const user = userEvent.setup();

    renderWithAuth(<CustomerFormPage />, { permissions: [PERMISSIONS.CUSTOMER_MANAGE] });

    await user.click(await screen.findByRole('button', { name: 'Харилцагч үүсгэх' }));

    expect(
      await screen.findByText('Оруулсан мэдээлэл шаардлага хангахгүй байна.'),
    ).toBeInTheDocument();
    // Local validation uses the shared schema, so no request is sent.
    expect(create).not.toHaveBeenCalled();
  });

  it('sends the trimmed, upper-cased payload on a valid submit', async () => {
    const create = vi
      .spyOn(objectService, 'createCustomer')
      .mockResolvedValue({ id: 'new-id' } as Awaited<ReturnType<typeof objectService.createCustomer>>);
    const user = userEvent.setup();

    renderWithAuth(<CustomerFormPage />, { permissions: [PERMISSIONS.CUSTOMER_MANAGE] });

    await screen.findByLabelText(/^Код/);
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: 'Харилцагч үүсгэх' }));

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'CT', name: 'Central Tower ХХК' }),
    );
  });

  it('renders a backend duplicate-code error instead of claiming success', async () => {
    vi.spyOn(objectService, 'createCustomer').mockRejectedValue(
      new ApiError('Энэ кодтой харилцагч бүртгэгдсэн байна.', 'DUPLICATE_KEY', 409),
    );
    const user = userEvent.setup();

    renderWithAuth(<CustomerFormPage />, { permissions: [PERMISSIONS.CUSTOMER_MANAGE] });

    await screen.findByLabelText(/^Код/);
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: 'Харилцагч үүсгэх' }));

    expect(
      await screen.findByText('Энэ кодтой харилцагч бүртгэгдсэн байна.'),
    ).toBeInTheDocument();
  });

  it('surfaces a field-level backend error against its field', async () => {
    vi.spyOn(objectService, 'createCustomer').mockRejectedValue(
      new ApiError('Оруулсан мэдээлэл шаардлага хангахгүй байна.', 'VALIDATION_ERROR', 400, [
        { field: 'phone', message: 'Утасны дугаар буруу форматтай байна.' },
      ]),
    );
    const user = userEvent.setup();

    renderWithAuth(<CustomerFormPage />, { permissions: [PERMISSIONS.CUSTOMER_MANAGE] });

    await screen.findByLabelText(/^Код/);
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: 'Харилцагч үүсгэх' }));

    expect(
      await screen.findByText('Утасны дугаар буруу форматтай байна.'),
    ).toBeInTheDocument();
  });
});
