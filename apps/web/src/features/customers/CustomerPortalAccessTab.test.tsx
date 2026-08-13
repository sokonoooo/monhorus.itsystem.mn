import {
  PERMISSIONS,
  type ListUsersQuery,
  type PaginatedData,
  type UserDto,
} from '@monhorus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { userService } from '../../services/user.service';
import { renderWithAuth } from '../../test/render';
import { CustomerPortalAccessTab } from './CustomerPortalAccessTab';

function makeAccount(overrides: Partial<UserDto> = {}): UserDto {
  return {
    id: 'u9',
    fullName: 'Болд Ганаа',
    email: 'bold@central.mn',
    phone: null,
    role: 'customer',
    status: 'active',
    customerId: 'c1',
    customerName: 'Central Tower ХХК',
    lastLoginAt: null,
    createdBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function mockAccounts(items: UserDto[]): void {
  const page: PaginatedData<UserDto> = {
    items,
    page: 1,
    limit: 100,
    total: items.length,
    totalPages: 1,
  };
  vi.spyOn(userService, 'list').mockResolvedValue(page);
}

function render(permissions = [PERMISSIONS.USER_VIEW, PERMISSIONS.USER_MANAGE]) {
  return renderWithAuth(<CustomerPortalAccessTab customerId="c1" />, { permissions });
}

describe('CustomerPortalAccessTab', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('lists only the accounts belonging to this organisation', async () => {
    const list = vi.spyOn(userService, 'list').mockResolvedValue({
      items: [makeAccount()],
      page: 1,
      limit: 100,
      total: 1,
      totalPages: 1,
    });

    render();

    expect(await screen.findByText('Болд Ганаа')).toBeInTheDocument();
    // Scoped server-side rather than fetched wholesale and filtered here: the directory
    // is not this screen's to read.
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'c1' }));
  });

  it('shows the temporary password once, and only after it is issued', async () => {
    mockAccounts([]);
    const create = vi.spyOn(userService, 'create').mockResolvedValue({
      user: makeAccount({ id: 'new1', fullName: 'Шинэ Хэрэглэгч' }),
      temporaryPassword: 'Tmp-9f2Kd8Lq',
    });
    const user = userEvent.setup();

    render();

    await user.click(await screen.findByRole('button', { name: 'Нэвтрэх эрх үүсгэх' }));
    const dialog = await screen.findByRole('dialog', { name: 'Нэвтрэх эрх үүсгэх' });

    // Nothing is shown before the server has issued it.
    expect(screen.queryByText('Tmp-9f2Kd8Lq')).not.toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(/Бүтэн нэр/), 'Шинэ Хэрэглэгч');
    await user.type(within(dialog).getByLabelText(/Нэвтрэх имэйл/), 'new@central.mn');
    await user.click(within(dialog).getByRole('button', { name: 'Үүсгэх' }));

    expect(await screen.findByText('Tmp-9f2Kd8Lq')).toBeInTheDocument();
    // The organisation and the role are the screen's to decide, never the operator's.
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'customer', customerId: 'c1', requirePasswordChange: true }),
    );
  });

  it('offers no write action to a caller who may only read the directory', async () => {
    mockAccounts([makeAccount()]);

    render([PERMISSIONS.USER_VIEW]);

    await screen.findByText('Болд Ганаа');
    expect(
      screen.queryByRole('button', { name: 'Нэвтрэх эрх үүсгэх' }),
    ).not.toBeInTheDocument();
  });

  it('asks the server for the next page, and numbers it on from the first', async () => {
    const first = Array.from({ length: 20 }, (_, index) =>
      makeAccount({ id: `a${index + 1}`, fullName: `Хэрэглэгч ${index + 1}` }),
    );
    const list = vi
      .spyOn(userService, 'list')
      .mockResolvedValueOnce({ items: first, page: 1, limit: 20, total: 21, totalPages: 2 })
      .mockResolvedValueOnce({
        items: [makeAccount({ id: 'a21', fullName: 'Хэрэглэгч 21' })],
        page: 2,
        limit: 20,
        total: 21,
        totalPages: 2,
      });
    const user = userEvent.setup();

    render();

    await screen.findByText('Хэрэглэгч 1');
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 20 }));

    await user.click(screen.getByRole('button', { name: 'Дараах' }));

    // The 21st account exists only on page two: before paging it was simply invisible.
    expect(await screen.findByText('Хэрэглэгч 21')).toBeInTheDocument();
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, limit: 20 }));

    // Numbering carries across pages, so "check row 21" means the same thing to the
    // reader as it does to the operator.
    const row = screen.getByText('Хэрэглэгч 21').closest('tr');
    expect(row).not.toBeNull();
    expect(within(row as HTMLTableRowElement).getByText('21')).toBeInTheDocument();
  });

  it('searches server-side and drops back to the first page', async () => {
    const list = vi
      .spyOn(userService, 'list')
      .mockImplementation(async (query: ListUsersQuery = {}) =>
        query.search
          ? {
              items: [makeAccount({ id: 'f1', fullName: 'Хайлтын Илэрц' })],
              page: 1,
              limit: 20,
              total: 1,
              totalPages: 1,
            }
          : {
              items: [makeAccount()],
              page: query.page ?? 1,
              limit: 20,
              total: 40,
              totalPages: 2,
            },
      );
    const user = userEvent.setup();

    render();

    await screen.findByText('Болд Ганаа');
    await user.click(screen.getByRole('button', { name: 'Дараах' }));
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));

    await user.type(screen.getByLabelText('Хайлт'), 'илэрц{Enter}');

    expect(await screen.findByText('Хайлтын Илэрц')).toBeInTheDocument();
    // Sent to the server rather than applied to the page in hand — and page 2 of the old
    // result would have been empty under the new one, so the search resets it.
    expect(list).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: 'илэрц', page: 1, customerId: 'c1' }),
    );
  });

  it('sends the role filter to the server', async () => {
    const list = vi.spyOn(userService, 'list').mockResolvedValue({
      items: [makeAccount()],
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
    const user = userEvent.setup();

    render();

    await screen.findByText('Болд Ганаа');
    await user.selectOptions(screen.getByLabelText('Эрх'), 'customer');

    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(
        expect.objectContaining({ role: 'customer', page: 1 }),
      ),
    );
  });
});
