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
const EMPLOYEE_ID = '507f1f77bcf86cd799439014';

/** The org lookups are paginated; the selectors read one page of options out of them. */
function makePage<T>(items: T[]): PaginatedData<T> {
  return { items, page: 1, limit: 100, total: items.length, totalPages: 1 };
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

  /**
   * The query, not merely "the dropdown rendered".
   *
   * `useOrgSelectors` asked for `limit: 200`, which `paginationQuerySchema` caps at 100 and
   * `validate` REJECTS rather than clamps — so every org lookup the employee form made came
   * back 400 and Company/Department/Position were permanently empty. A test that mocks
   * `orgService` and asserts on rendered options cannot see that, because a mock answers any
   * query. This asserts what is actually sent, the same way the equipment pickers do in
   * `PlannedWorkDetailPage.test.tsx` and `WorkReportPanel.test.tsx` after the identical bug.
   */
  it('asks for the org page the API will serve', async () => {
    const companies = vi.spyOn(orgService, 'companies');
    const departments = vi.spyOn(orgService, 'departments');
    const positions = vi.spyOn(orgService, 'positions');
    const teams = vi.spyOn(orgService, 'teams');

    renderWithAuth(<EmployeeFormPage />, { permissions: [PERMISSIONS.EMPLOYEE_CREATE] });

    await waitFor(() => expect(companies).toHaveBeenCalled());

    // The cap the shared schema enforces. Above it the request is a 400, not a bigger page.
    for (const spy of [companies, departments, positions, teams]) {
      for (const [query] of spy.mock.calls) {
        expect((query as { limit?: number } | undefined)?.limit ?? 0).toBeLessThanOrEqual(100);
      }
    }
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

  /**
   * The anket lists must survive an edit.
   *
   * The form has no UI for education, work history or certificates, but `buildPayload`
   * supplied `[]` for all three and `createEmployeeSchema.safeParse` re-injected them from
   * each field's `.default([])`. On the update path the backend applies any key that is
   * present, so saving an unrelated field — a phone number — deleted the employee's entire
   * education, work history and certificate record. Nothing on screen showed it, because
   * this screen never displays those lists; the employee mobile app is what reads them.
   *
   * `updateEmployeeSchema` is `.partial()`, so an absent key is left alone server-side.
   * This asserts the keys are absent rather than empty — `[]` would still mean "delete".
   */
  it('does not send the anket lists when updating, so an edit cannot erase them', async () => {
    const user = userEvent.setup();

    const existing = {
      id: EMPLOYEE_ID,
      employeeCode: 'E-001',
      firstName: 'Бат',
      lastName: 'Дорж',
      registrationNumber: null,
      email: null,
      phone: '99119911',
      birthDate: null,
      gender: null,
      // An ACTIVE employee must carry all five of these, per `applyEmployeeRefinements`.
      company: { id: COMPANY.id, name: COMPANY.name },
      department: { id: DEPARTMENT.id, name: DEPARTMENT.name },
      position: { id: POSITION.id, name: POSITION.name },
      team: null,
      workLocation: null,
      employmentStartDate: '2024-01-15T00:00:00.000Z',
      employeeType: 'FULL_TIME',
      status: 'ACTIVE',
      terminationDate: null,
      terminationReason: null,
      icCardNumber: null,
      attendanceNumber: null,
      skills: [],
      qualificationLevel: null,
      safetyGrade: null,
      permittedJobTypes: [],
      hasDriverLicense: false,
      gpsVerificationEnabled: true,
      mealDiscountPercent: null,
      dailyMealCount: null,
      mealConfigEnabled: false,
      birthProvince: null,
      birthDistrict: null,
      currentAddress: null,
      residentialAddress: null,
      maritalStatus: null,
      familySize: null,
      emergencyContactName: null,
      emergencyContactRelation: null,
      emergencyContactPhone: null,
      // The records at risk. The form cannot show or edit them.
      education: [{ level: 'BACHELOR', school: 'ШУТИС', major: 'Цахилгаан', startDate: null, endDate: null, diplomaNumber: 'D-1' }],
      workHistory: [{ organization: 'Өмнөх ХХК', position: 'Инженер', startDate: null, endDate: null, leaveReason: null }],
      certificates: [{ name: 'Аюулгүй ажиллагаа', certificateNumber: 'C-1', issuedAt: null, expiresAt: null }],
    };

    vi.spyOn(employeeService, 'getById').mockResolvedValue(
      existing as unknown as Awaited<ReturnType<typeof employeeService.getById>>,
    );
    const update = vi
      .spyOn(employeeService, 'update')
      .mockResolvedValue(existing as unknown as Awaited<ReturnType<typeof employeeService.update>>);

    renderWithAuth(<EmployeeFormPage />, {
      permissions: [PERMISSIONS.EMPLOYEE_UPDATE],
      route: `/employees/${EMPLOYEE_ID}/edit`,
      path: '/employees/:employeeId/edit',
    });

    // Change something unrelated, exactly as the real report describes.
    const phone = await screen.findByDisplayValue('99119911');
    await user.clear(phone);
    await user.type(phone, '88228822');

    await user.click(screen.getByRole('button', { name: 'Хадгалах' }));

    await waitFor(() => expect(update).toHaveBeenCalled());

    const [, payload] = update.mock.calls[0] as [string, Record<string, unknown>];
    expect(payload.phone).toBe('88228822');
    expect(payload).not.toHaveProperty('education');
    expect(payload).not.toHaveProperty('workHistory');
    expect(payload).not.toHaveProperty('certificates');
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
