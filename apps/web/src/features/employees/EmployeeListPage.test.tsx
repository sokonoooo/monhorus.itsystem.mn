import { PERMISSIONS, type EmployeeListItemDto, type PaginatedData } from '@monhorus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../lib/api-client';
import { employeeService } from '../../services/employee.service';
import { renderWithAuth } from '../../test/render';
import { EmployeeListPage } from './EmployeeListPage';

function makeRow(overrides: Partial<EmployeeListItemDto> = {}): EmployeeListItemDto {
  return {
    id: 'e1',
    employeeCode: 'EMP-001',
    firstName: 'Энхтөр',
    lastName: 'Батаа',
    registrationNumber: 'АА12345678',
    email: 'e@test.mn',
    phone: '9911-2233',
    photoUrl: null,
    company: { id: 'c1', name: 'Монхорус ХХК' },
    department: { id: 'd1', name: 'Цахилгааны хэлтэс' },
    position: { id: 'p1', name: 'Инженер' },
    team: null,
    employeeType: 'FULL_TIME',
    status: 'ACTIVE',
    employmentStartDate: '2024-01-15T00:00:00.000Z',
    hasSystemAccess: false,
    isActive: true,
    ...overrides,
  };
}

function makePage(items: EmployeeListItemDto[]): PaginatedData<EmployeeListItemDto> {
  return { items, page: 1, limit: 20, total: items.length, totalPages: 1 };
}

describe('EmployeeListPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a loading state before data arrives', () => {
    vi.spyOn(employeeService, 'list').mockReturnValue(new Promise(() => undefined));

    renderWithAuth(<EmployeeListPage />, { permissions: [PERMISSIONS.EMPLOYEE_VIEW] });

    expect(screen.getByRole('status', { name: 'Ачааллаж байна' })).toBeInTheDocument();
  });

  it('renders employee rows once loaded', async () => {
    vi.spyOn(employeeService, 'list').mockResolvedValue(makePage([makeRow()]));

    renderWithAuth(<EmployeeListPage />, { permissions: [PERMISSIONS.EMPLOYEE_VIEW] });

    expect(await screen.findByText('Батаа Энхтөр')).toBeInTheDocument();
    expect(screen.getByText('EMP-001')).toBeInTheDocument();
    // Scoped to the table: "Идэвхтэй" also appears as a status filter option.
    expect(within(screen.getByRole('table')).getByText('Идэвхтэй')).toBeInTheDocument();
  });

  it('shows an empty state when there are no employees', async () => {
    vi.spyOn(employeeService, 'list').mockResolvedValue(makePage([]));

    renderWithAuth(<EmployeeListPage />, { permissions: [PERMISSIONS.EMPLOYEE_VIEW] });

    expect(await screen.findByText('Ажилтан олдсонгүй')).toBeInTheDocument();
  });

  it('shows an error state and a retry action when the request fails', async () => {
    vi.spyOn(employeeService, 'list').mockRejectedValue(
      new ApiError('Сервер алдаа', 'INTERNAL_ERROR', 500),
    );

    renderWithAuth(<EmployeeListPage />, { permissions: [PERMISSIONS.EMPLOYEE_VIEW] });

    expect(await screen.findByText('Сервер алдаа')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Дахин оролдох' })).toBeInTheDocument();
  });

  it('hides the create action without employee.create', async () => {
    vi.spyOn(employeeService, 'list').mockResolvedValue(makePage([makeRow()]));

    renderWithAuth(<EmployeeListPage />, { permissions: [PERMISSIONS.EMPLOYEE_VIEW] });

    await screen.findByText('Батаа Энхтөр');
    expect(screen.queryByRole('button', { name: 'Шинэ ажилтан' })).not.toBeInTheDocument();
  });

  it('shows the create action with employee.create', async () => {
    vi.spyOn(employeeService, 'list').mockResolvedValue(makePage([makeRow()]));

    renderWithAuth(<EmployeeListPage />, {
      permissions: [PERMISSIONS.EMPLOYEE_VIEW, PERMISSIONS.EMPLOYEE_CREATE],
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Шинэ ажилтан' })).toBeInTheDocument();
    });
  });

  /**
   * Row numbers only mean something if they are continuous: asked to "check employee 21",
   * a reader must find it as row 21 on page two, not as row 1 all over again.
   */
  it('numbers page two from 21 rather than restarting at 1', async () => {
    vi.spyOn(employeeService, 'list').mockResolvedValue({
      ...makePage([makeRow()]),
      page: 2,
      total: 21,
      totalPages: 2,
    });

    renderWithAuth(<EmployeeListPage />, {
      permissions: [PERMISSIONS.EMPLOYEE_VIEW],
      route: '/employees?page=2',
    });

    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: '№' })).toBeInTheDocument();
    const firstRow = within(table).getAllByRole('row')[1]!;
    expect(within(firstRow).getAllByRole('cell')[0]).toHaveTextContent(/^21$/);
  });

  it('hides the edit action without employee.update', async () => {
    vi.spyOn(employeeService, 'list').mockResolvedValue(makePage([makeRow()]));
    const user = userEvent.setup();

    renderWithAuth(<EmployeeListPage />, { permissions: [PERMISSIONS.EMPLOYEE_VIEW] });

    await screen.findByText('Батаа Энхтөр');
    const row = within(screen.getByRole('table')).getAllByRole('row')[1]!;
    await user.click(within(row).getByRole('button', { name: 'Үйлдэл' }));

    expect(screen.getByRole('menuitem', { name: 'Харах' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Засах' })).not.toBeInTheDocument();
  });
});
