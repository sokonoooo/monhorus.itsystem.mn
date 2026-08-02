import type { PaginatedData, UserDto } from '@monhorus/shared';
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { userService } from '../../services/user.service';
import { renderWithAuth } from '../../test/render';
import { UsersPage } from './UsersPage';

function makeRow(overrides: Partial<UserDto> = {}): UserDto {
  return {
    id: 'u1',
    fullName: 'Дорж Бат',
    email: 'dorj@test.mn',
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

function makePage(items: UserDto[]): PaginatedData<UserDto> {
  return { items, page: 1, limit: 20, total: items.length, totalPages: 1 };
}

describe('UsersPage organisation column', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the organisation a customer account is linked to', async () => {
    vi.spyOn(userService, 'list').mockResolvedValue(makePage([makeRow()]));

    renderWithAuth(<UsersPage />);

    expect(await screen.findByText('Central Tower ХХК')).toBeInTheDocument();
  });

  it('calls out a customer account that is not linked to any organisation', async () => {
    vi.spyOn(userService, 'list').mockResolvedValue(
      makePage([makeRow({ customerId: null, customerName: null })]),
    );

    renderWithAuth(<UsersPage />);

    expect(await screen.findByText('Холбогдоогүй')).toBeInTheDocument();
  });

  it('leaves the column blank for a staff account', async () => {
    vi.spyOn(userService, 'list').mockResolvedValue(
      makePage([
        makeRow({ role: 'technician', customerId: null, customerName: null }),
      ]),
    );

    renderWithAuth(<UsersPage />);

    expect(await screen.findByText('Дорж Бат')).toBeInTheDocument();
    expect(screen.queryByText('Холбогдоогүй')).not.toBeInTheDocument();
  });
});
