import {
  PERMISSIONS,
  type CompanyDto,
  type DepartmentListItemDto,
  type PaginatedData,
} from '@monhorus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { orgService } from '../../services/org.service';
import { renderWithAuth } from '../../test/render';
import { DepartmentsPage } from './DepartmentsPage';

const COMPANY: CompanyDto = {
  id: 'c1',
  code: 'COM-001',
  name: 'Монхорус ХХК',
  registrationNumber: null,
  address: null,
  isActive: true,
};

function makeDepartment(overrides: Partial<DepartmentListItemDto> = {}): DepartmentListItemDto {
  return {
    id: 'd1',
    companyId: COMPANY.id,
    companyName: COMPANY.name,
    code: 'DEP-001',
    name: 'Цахилгааны хэлтэс',
    isActive: true,
    ...overrides,
  };
}

function makePage<T>(items: T[], overrides: Partial<PaginatedData<T>> = {}): PaginatedData<T> {
  return { items, page: 1, limit: 20, total: items.length, totalPages: 1, ...overrides };
}

/** The company picker feeds both the form and the company filter, so every test needs it. */
function mockCompanies() {
  return vi.spyOn(orgService, 'companies').mockResolvedValue(makePage([COMPANY]));
}

const MANAGER = [PERMISSIONS.ORG_VIEW, PERMISSIONS.ORG_MANAGE];

describe('DepartmentsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockCompanies();
  });

  it('renders a department with its code and its company', async () => {
    vi.spyOn(orgService, 'departments').mockResolvedValue(makePage([makeDepartment()]));

    renderWithAuth(<DepartmentsPage />, { permissions: [PERMISSIONS.ORG_VIEW] });

    expect(await screen.findByText('Цахилгааны хэлтэс')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('DEP-001')).toBeInTheDocument();
    expect(within(table).getByText('Монхорус ХХК')).toBeInTheDocument();
  });

  /** Only the request tells a server-side search apart from a list trimmed on the client. */
  it('asks the server to search rather than filtering what came back', async () => {
    const list = vi
      .spyOn(orgService, 'departments')
      .mockResolvedValue(makePage([makeDepartment()]));
    const user = userEvent.setup();

    renderWithAuth(<DepartmentsPage />, { permissions: [PERMISSIONS.ORG_VIEW] });
    await screen.findByText('Цахилгааны хэлтэс');

    await user.type(screen.getByLabelText('Хайлт'), 'цахилгаан');
    await user.tab();

    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'цахилгаан' })),
    );
  });

  it('asks for the next page when the reader turns it', async () => {
    const list = vi
      .spyOn(orgService, 'departments')
      .mockResolvedValue(makePage([makeDepartment()], { total: 25, totalPages: 2 }));
    const user = userEvent.setup();

    renderWithAuth(<DepartmentsPage />, { permissions: [PERMISSIONS.ORG_VIEW] });
    await screen.findByText('Цахилгааны хэлтэс');

    await user.click(screen.getByRole('button', { name: 'Дараах' }));

    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
  });

  it('filters by company from the first page', async () => {
    const list = vi
      .spyOn(orgService, 'departments')
      .mockResolvedValue(makePage([makeDepartment()], { total: 25, totalPages: 2 }));
    const user = userEvent.setup();

    renderWithAuth(<DepartmentsPage />, {
      permissions: [PERMISSIONS.ORG_VIEW],
      route: '/org/departments?page=2',
    });
    await screen.findByText('Цахилгааны хэлтэс');
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));

    // The option arrives with the company lookup, not with the first paint.
    await screen.findByRole('option', { name: 'Монхорус ХХК' });
    await user.selectOptions(screen.getByLabelText('Байгууллага'), COMPANY.id);

    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, companyId: COMPANY.id }),
      ),
    );
  });

  it('deactivates a department through the status endpoint', async () => {
    vi.spyOn(orgService, 'departments').mockResolvedValue(makePage([makeDepartment()]));
    const setStatus = vi
      .spyOn(orgService, 'setDepartmentStatus')
      .mockResolvedValue(makeDepartment({ isActive: false }));
    const user = userEvent.setup();

    renderWithAuth(<DepartmentsPage />, { permissions: MANAGER });
    await screen.findByText('Цахилгааны хэлтэс');

    await user.click(within(screen.getByRole('table')).getByRole('button', { name: 'Үйлдэл' }));
    await user.click(screen.getByRole('menuitem', { name: 'Идэвхгүй болгох' }));
    await user.click(screen.getByRole('button', { name: 'Идэвхгүй болгох' }));

    await waitFor(() => expect(setStatus).toHaveBeenCalledWith('d1', { isActive: false }));
  });

  it('creates a department under the chosen company and never sends a code', async () => {
    vi.spyOn(orgService, 'departments').mockResolvedValue(makePage([makeDepartment()]));
    const create = vi.spyOn(orgService, 'createDepartment').mockResolvedValue(makeDepartment());
    const user = userEvent.setup();

    renderWithAuth(<DepartmentsPage />, { permissions: MANAGER });

    await user.click(await screen.findByRole('button', { name: 'Шинэ хэлтэс' }));
    const drawer = await screen.findByRole('dialog');

    expect(within(drawer).queryByLabelText(/^Код/)).not.toBeInTheDocument();
    await user.selectOptions(within(drawer).getByLabelText(/^Байгууллага/), COMPANY.id);
    await user.type(within(drawer).getByLabelText(/^Нэр/), 'Санхүү');
    await user.click(within(drawer).getByRole('button', { name: 'Хадгалах' }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({ companyId: COMPANY.id, name: 'Санхүү' }),
    );
  });
});
