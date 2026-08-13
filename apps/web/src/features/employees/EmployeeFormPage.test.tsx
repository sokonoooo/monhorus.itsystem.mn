import { PERMISSIONS, type PaginatedData } from '@monhorus/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { employeeService } from '../../services/employee.service';
import { orgService } from '../../services/org.service';
import { renderWithAuth } from '../../test/render';
import { EmployeeFormPage } from './EmployeeFormPage';

const COMPANY = { id: '507f1f77bcf86cd799439011', code: 'MH', name: 'Монхорус ХХК', registrationNumber: null, address: null, isActive: true };
const DEPARTMENT = { id: '507f1f77bcf86cd799439012', companyId: COMPANY.id, code: 'ELEC', name: 'Цахилгааны хэлтэс', isActive: true };
const POSITION = { id: '507f1f77bcf86cd799439013', companyId: COMPANY.id, departmentId: DEPARTMENT.id, code: 'ENG', name: 'Инженер', isActive: true };

/** The org lookups are paginated; the selectors read one page of options out of them. */
function makePage<T>(items: T[]): PaginatedData<T> {
  return { items, page: 1, limit: 200, total: items.length, totalPages: 1 };
}

describe('EmployeeFormPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(orgService, 'companies').mockResolvedValue(makePage([COMPANY]));
    vi.spyOn(orgService, 'departments').mockResolvedValue(
      makePage([{ ...DEPARTMENT, companyName: COMPANY.name }]),
    );
    vi.spyOn(orgService, 'positions').mockResolvedValue(
      makePage([{ ...POSITION, companyName: COMPANY.name, departmentName: DEPARTMENT.name }]),
    );
    vi.spyOn(orgService, 'teams').mockResolvedValue([]);
  });

  it('hides the salary tab without employee.view_salary', async () => {
    renderWithAuth(<EmployeeFormPage />, { permissions: [PERMISSIONS.EMPLOYEE_CREATE] });

    expect(await screen.findByRole('tab', { name: 'Ерөнхий мэдээлэл' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Анкет' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Цалингийн мэдээлэл' })).not.toBeInTheDocument();
  });

  it('shows the salary tab with employee.view_salary', async () => {
    renderWithAuth(<EmployeeFormPage />, {
      permissions: [PERMISSIONS.EMPLOYEE_CREATE, PERMISSIONS.EMPLOYEE_VIEW_SALARY],
    });

    expect(await screen.findByRole('tab', { name: 'Цалингийн мэдээлэл' })).toBeInTheDocument();
  });

  it('blocks submission and reports required fields', async () => {
    const create = vi.spyOn(employeeService, 'create');
    const user = userEvent.setup();

    renderWithAuth(<EmployeeFormPage />, { permissions: [PERMISSIONS.EMPLOYEE_CREATE] });

    await user.click(await screen.findByRole('button', { name: 'Ажилтан үүсгэх' }));

    expect(await screen.findByText('Оруулсан мэдээлэл шаардлага хангахгүй байна.')).toBeInTheDocument();
    // Local validation uses the same shared schema as the API, so no request is sent.
    expect(create).not.toHaveBeenCalled();
  });

  it('clears the department when the company changes', async () => {
    const user = userEvent.setup();
    renderWithAuth(<EmployeeFormPage />, { permissions: [PERMISSIONS.EMPLOYEE_CREATE] });

    const companySelect = await screen.findByDisplayValue('Компани сонгох');
    await user.selectOptions(companySelect, COMPANY.id);

    await waitFor(() => {
      expect(orgService.departments).toHaveBeenCalledWith(
        expect.objectContaining({ companyId: COMPANY.id }),
      );
    });

    const departmentSelect = screen.getByDisplayValue('Алба сонгох');
    await user.selectOptions(departmentSelect, DEPARTMENT.id);
    expect((departmentSelect as HTMLSelectElement).value).toBe(DEPARTMENT.id);

    // Re-selecting the company must invalidate the child selection.
    await user.selectOptions(companySelect, '');
    await waitFor(() => {
      expect((screen.getByDisplayValue('Алба сонгох') as HTMLSelectElement).value).toBe('');
    });
  });

  it('renders termination fields only for the TERMINATED status', async () => {
    const user = userEvent.setup();
    renderWithAuth(<EmployeeFormPage />, { permissions: [PERMISSIONS.EMPLOYEE_CREATE] });

    await screen.findByRole('tab', { name: 'Ерөнхий мэдээлэл' });
    expect(screen.queryByText('Ажлаас гарсан шалтгаан')).not.toBeInTheDocument();

    const statusSelect = screen.getByDisplayValue('Ноорог');
    await user.selectOptions(statusSelect, 'TERMINATED');

    expect(await screen.findByText('Ажлаас гарсан шалтгаан')).toBeInTheDocument();
  });
});
