import { PERMISSIONS, type CustomerDto, type PaginatedData } from '@monhorus/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../lib/api-client';
import { objectService } from '../../services/object.service';
import { makeCustomer } from '../../test/fixtures';
import { renderWithAuth } from '../../test/render';
import { CustomerListPage } from './CustomerListPage';

function makePage(items: CustomerDto[]): PaginatedData<CustomerDto> {
  return { items, page: 1, limit: 20, total: items.length, totalPages: 1 };
}

describe('CustomerListPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a loading state before data arrives', () => {
    vi.spyOn(objectService, 'listCustomers').mockReturnValue(new Promise(() => undefined));

    renderWithAuth(<CustomerListPage />, { permissions: [PERMISSIONS.CUSTOMER_VIEW] });

    expect(screen.getByRole('status', { name: 'Ачааллаж байна' })).toBeInTheDocument();
  });

  it('renders customer rows with counts', async () => {
    vi.spyOn(objectService, 'listCustomers').mockResolvedValue(
      makePage([
        makeCustomer({
          registrationNumber: '2712345',
          taxNumber: '99887766',
          contactPerson: 'Б. Болд',
          responsibleEmployeeName: 'Батаа Энхтөр',
          projectCount: 2,
          buildingCount: 5,
          activeAgreementCount: 1,
        }),
      ]),
    );

    renderWithAuth(<CustomerListPage />, { permissions: [PERMISSIONS.CUSTOMER_VIEW] });

    expect(await screen.findByText('Central Tower ХХК')).toBeInTheDocument();
    const table = screen.getByRole('table');
    const row = within(table).getAllByRole('row')[1]!;
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((header) => header.textContent);

    expect(within(table).getByText('2712345')).toBeInTheDocument();
    expect(within(table).getByText('99887766')).toBeInTheDocument();
    // Project and building counts are separate columns, so each is read by position.
    expect(within(row).getAllByRole('cell')[headers.indexOf('Төсөл')]).toHaveTextContent('2');
    expect(within(row).getAllByRole('cell')[headers.indexOf('Барилга')]).toHaveTextContent('5');
    expect(within(table).getByText('1 идэвхтэй')).toBeInTheDocument();
    expect(within(table).getByText('Батаа Энхтөр')).toBeInTheDocument();
  });

  it('shows an empty state when nothing matches', async () => {
    vi.spyOn(objectService, 'listCustomers').mockResolvedValue(makePage([]));

    renderWithAuth(<CustomerListPage />, { permissions: [PERMISSIONS.CUSTOMER_VIEW] });

    expect(await screen.findByText('Харилцагч олдсонгүй')).toBeInTheDocument();
  });

  it('shows an error state with a retry action', async () => {
    vi.spyOn(objectService, 'listCustomers').mockRejectedValue(
      new ApiError('Сервер алдаа', 'INTERNAL_ERROR', 500),
    );

    renderWithAuth(<CustomerListPage />, { permissions: [PERMISSIONS.CUSTOMER_VIEW] });

    expect(await screen.findByText('Сервер алдаа')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Дахин оролдох' })).toBeInTheDocument();
  });

  it('hides create and edit without customer.manage', async () => {
    vi.spyOn(objectService, 'listCustomers').mockResolvedValue(makePage([makeCustomer()]));
    const user = userEvent.setup();

    renderWithAuth(<CustomerListPage />, { permissions: [PERMISSIONS.CUSTOMER_VIEW] });

    await screen.findByText('Central Tower ХХК');
    expect(screen.queryByRole('button', { name: 'Шинэ харилцагч' })).not.toBeInTheDocument();

    const row = within(screen.getByRole('table')).getAllByRole('row')[1]!;
    await user.click(within(row).getByRole('button', { name: 'Үйлдэл' }));

    expect(screen.getByRole('menuitem', { name: 'Харах' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Засах' })).not.toBeInTheDocument();
  });

  it('shows create and edit with customer.manage', async () => {
    vi.spyOn(objectService, 'listCustomers').mockResolvedValue(makePage([makeCustomer()]));
    const user = userEvent.setup();

    renderWithAuth(<CustomerListPage />, {
      permissions: [PERMISSIONS.CUSTOMER_VIEW, PERMISSIONS.CUSTOMER_MANAGE],
    });

    expect(await screen.findByRole('button', { name: 'Шинэ харилцагч' })).toBeInTheDocument();

    const row = within(screen.getByRole('table')).getAllByRole('row')[1]!;
    await user.click(within(row).getByRole('button', { name: 'Үйлдэл' }));

    expect(screen.getByRole('menuitem', { name: 'Засах' })).toBeInTheDocument();
  });

  /**
   * These actions were plain links before the row menu existed. Keeping them as real anchors
   * is what preserves middle-click and cmd-click opening a customer in a new tab, which a
   * button cannot do.
   */
  it('keeps navigating actions as real links', async () => {
    vi.spyOn(objectService, 'listCustomers').mockResolvedValue(makePage([makeCustomer()]));
    const user = userEvent.setup();

    renderWithAuth(<CustomerListPage />, {
      permissions: [PERMISSIONS.CUSTOMER_VIEW, PERMISSIONS.CUSTOMER_MANAGE],
    });

    await screen.findByRole('table');
    const row = within(screen.getByRole('table')).getAllByRole('row')[1]!;
    await user.click(within(row).getByRole('button', { name: 'Үйлдэл' }));

    const view = screen.getByRole('menuitem', { name: 'Харах' });
    expect(view.tagName).toBe('A');
    expect(view).toHaveAttribute('href', '/customers/507f1f77bcf86cd799439011');

    const edit = screen.getByRole('menuitem', { name: 'Засах' });
    expect(edit).toHaveAttribute('href', '/customers/507f1f77bcf86cd799439011/edit');
  });
});
