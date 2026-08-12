import { PERMISSIONS, type PaginatedData, type UserDto } from '@monhorus/shared';
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

  /**
   * The tab asked for a hundred accounts and rendered whatever came back, so a large
   * organisation's accounts past the first hundred were unreachable here.
   */
  it('asks for one page of accounts rather than a hundred', async () => {
    const list = vi.spyOn(userService, 'list').mockResolvedValue({
      items: [makeAccount()],
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });

    render();
    await screen.findByText('Болд Ганаа');

    expect(list).toHaveBeenCalledWith({ customerId: 'c1', page: 1, limit: 20 });
  });

  it('numbers the accounts continuously across pages', async () => {
    const user = userEvent.setup();
    const list = vi.spyOn(userService, 'list').mockImplementation(async (query) => ({
      items: [makeAccount({ id: `u-${query?.page ?? 1}` })],
      page: query?.page ?? 1,
      limit: 20,
      total: 25,
      totalPages: 2,
    }));

    render();

    const table = await screen.findByRole('table', { name: 'Нэвтрэх эрх' });
    expect(within(table).getByRole('columnheader', { name: '№' })).toBeInTheDocument();
    expect(within(table).getAllByRole('cell')[0]?.textContent?.trim()).toBe('1');

    await user.click(screen.getByRole('button', { name: 'Дараах' }));

    // Page 2 of 20 begins at 21, and the second page is fetched rather than sliced here.
    await waitFor(() =>
      expect(
        within(screen.getByRole('table', { name: 'Нэвтрэх эрх' }))
          .getAllByRole('cell')[0]
          ?.textContent?.trim(),
      ).toBe('21'),
    );
    expect(list).toHaveBeenLastCalledWith({ customerId: 'c1', page: 2, limit: 20 });
  });
});
