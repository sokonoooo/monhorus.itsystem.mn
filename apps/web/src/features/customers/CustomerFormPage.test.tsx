import { PERMISSIONS } from '@monhorus/shared';
import { screen, waitFor } from '@testing-library/react';
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

  /**
   * The logo is a field on the form, not a separate screen.
   *
   * What this pins is the two-phase flow: choosing a file uploads it immediately and the
   * id that comes back is what the customer is saved with. A test that only checked the
   * input existed would pass against a picker that uploaded nothing.
   */
  it('uploads a picked logo and saves the customer with the id it was given', async () => {
    const create = vi
      .spyOn(objectService, 'createCustomer')
      .mockResolvedValue({ id: 'new-id' } as Awaited<
        ReturnType<typeof objectService.createCustomer>
      >);
    const upload = vi.spyOn(objectService, 'uploadCustomerLogo').mockResolvedValue({
      id: '507f1f77bcf86cd799439222',
      name: 'logo.png',
      downloadUrl: '/api/v1/files/507f1f77bcf86cd799439222',
      mimeType: 'image/png',
      sizeBytes: 1024,
    });
    const user = userEvent.setup();

    renderWithAuth(<CustomerFormPage />, { permissions: [PERMISSIONS.CUSTOMER_MANAGE] });

    await screen.findByLabelText(/^Код/);
    await fillRequired(user);

    const logo = new File(['x'], 'logo.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('Лого'), logo);

    await waitFor(() => expect(upload).toHaveBeenCalledWith(logo));

    await user.click(screen.getByRole('button', { name: 'Харилцагч үүсгэх' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ logoFileId: '507f1f77bcf86cd799439222' }),
      );
    });
  });

  /** A customer with no logo saves an explicit null, not an absent key. */
  it('saves a null logo when none was picked', async () => {
    const create = vi
      .spyOn(objectService, 'createCustomer')
      .mockResolvedValue({ id: 'new-id' } as Awaited<
        ReturnType<typeof objectService.createCustomer>
      >);
    const user = userEvent.setup();

    renderWithAuth(<CustomerFormPage />, { permissions: [PERMISSIONS.CUSTOMER_MANAGE] });

    await screen.findByLabelText(/^Код/);
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: 'Харилцагч үүсгэх' }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ logoFileId: null })),
    );
  });

  /**
   * The size check is a courtesy that has to actually fire.
   *
   * Size rather than type, because the picker's `accept` attribute already stops the
   * browser handing over a PDF and there is nothing left for the component to say. A 3MB
   * PNG is the case that reaches it: without this check the user waits out an upload only
   * to be told at the far end that the file was too big.
   */
  it('refuses an oversized logo without uploading it', async () => {
    const upload = vi.spyOn(objectService, 'uploadCustomerLogo');
    const user = userEvent.setup();

    renderWithAuth(<CustomerFormPage />, { permissions: [PERMISSIONS.CUSTOMER_MANAGE] });

    await screen.findByLabelText(/^Код/);
    await user.upload(
      screen.getByLabelText('Лого'),
      new File([new ArrayBuffer(3 * 1024 * 1024)], 'big.png', { type: 'image/png' }),
    );

    expect(await screen.findByText('Зураг 2MB-аас бага байна.')).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
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
