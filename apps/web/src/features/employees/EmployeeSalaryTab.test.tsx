import { PERMISSIONS, type EmployeeSalaryDto } from '@monhorus/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { employeeService } from '../../services/employee.service';
import { renderWithAuth } from '../../test/render';
import { EmployeeSalaryTab } from './EmployeeSalaryTab';

const EMPLOYEE_ID = '507f1f77bcf86cd799439011';

function makeSalary(overrides: Partial<EmployeeSalaryDto> = {}): EmployeeSalaryDto {
  return {
    id: '507f1f77bcf86cd799439021',
    grade: 'Ахлах инженер',
    baseSalary: 2_000_000,
    currency: 'MNT',
    calculationType: 'MONTHLY',
    bankName: 'Хаан банк',
    bankAccountName: 'Тест Ажилтан',
    bankAccountNumber: '5001234567',
    socialInsurance: true,
    personalIncomeTax: true,
    transportAllowance: 150_000,
    mealAllowance: 120_000,
    phoneAllowance: 40_000,
    otherAllowance: 30_000,
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: null,
    isCurrent: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const MANAGE = [PERMISSIONS.EMPLOYEE_VIEW_SALARY, PERMISSIONS.EMPLOYEE_MANAGE_SALARY];

describe('EmployeeSalaryTab', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('seeds every field from the record currently in force', async () => {
    vi.spyOn(employeeService, 'salaryHistory').mockResolvedValue([makeSalary()]);

    renderWithAuth(<EmployeeSalaryTab employeeId={EMPLOYEE_ID} />, { permissions: MANAGE });

    expect(await screen.findByLabelText(/Үндсэн цалин/)).toHaveValue(2_000_000);
    expect(screen.getByLabelText(/Унааны нэмэгдэл/)).toHaveValue(150_000);
    expect(screen.getByLabelText(/Хоолны нэмэгдэл/)).toHaveValue(120_000);
    expect(screen.getByLabelText(/Утасны нэмэгдэл/)).toHaveValue(40_000);
    expect(screen.getByLabelText(/Бусад тогтмол нэмэгдэл/)).toHaveValue(30_000);
    expect(screen.getByLabelText(/Банк$/)).toHaveValue('Хаан банк');
  });

  /**
   * The bug. The four allowances started at `'0'` and were never seeded, and the backend
   * writes an append-only record from the payload alone, so raising the base salary wrote
   * a new effective period with every allowance zeroed.
   */
  it('carries the existing allowances into a record where only the base salary changed', async () => {
    vi.spyOn(employeeService, 'salaryHistory').mockResolvedValue([makeSalary()]);
    const save = vi.spyOn(employeeService, 'saveSalary').mockResolvedValue(
      makeSalary({ id: '507f1f77bcf86cd799439022', baseSalary: 2_400_000 }),
    );
    const user = userEvent.setup();

    renderWithAuth(<EmployeeSalaryTab employeeId={EMPLOYEE_ID} />, { permissions: MANAGE });

    const base = await screen.findByLabelText(/Үндсэн цалин/);
    await user.clear(base);
    await user.type(base, '2400000');

    // The new period must start after the open one, so the date is the user's to supply.
    await user.type(screen.getByLabelText(/Хүчин төгөлдөр эхлэх огноо/), '2026-09-01');
    await user.click(screen.getByRole('button', { name: 'Цалингийн мэдээлэл хадгалах' }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]![1]).toMatchObject({
      baseSalary: 2_400_000,
      transportAllowance: 150_000,
      mealAllowance: 120_000,
      phoneAllowance: 40_000,
      otherAllowance: 30_000,
      grade: 'Ахлах инженер',
      bankAccountNumber: '5001234567',
    });
  });

  it('leaves the form empty for an employee with no salary on record', async () => {
    vi.spyOn(employeeService, 'salaryHistory').mockResolvedValue([]);

    renderWithAuth(<EmployeeSalaryTab employeeId={EMPLOYEE_ID} />, { permissions: MANAGE });

    expect(await screen.findByLabelText(/Үндсэн цалин/)).toHaveValue(null);
    expect(screen.getByText('Бүртгэгдсэн цалингийн мэдээлэл байхгүй байна.')).toBeInTheDocument();
  });
});
