import {
  PERMISSIONS,
  type CompanyDto,
  type DepartmentListItemDto,
  type PaginatedData,
  type PositionListItemDto,
} from '@monhorus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { orgService } from '../../services/org.service';
import { renderWithAuth } from '../../test/render';
import { PositionsPage } from './PositionsPage';

const COMPANY: CompanyDto = {
  id: 'c1',
  code: 'COM-001',
  name: 'Монхорус ХХК',
  registrationNumber: null,
  address: null,
  isActive: true,
};

const DEPARTMENT: DepartmentListItemDto = {
  id: 'd1',
  companyId: COMPANY.id,
  companyName: COMPANY.name,
  code: 'DEP-001',
  name: 'Цахилгааны хэлтэс',
  isActive: true,
};

function makePosition(overrides: Partial<PositionListItemDto> = {}): PositionListItemDto {
  return {
    id: 'p1',
    companyId: COMPANY.id,
    companyName: COMPANY.name,
    departmentId: DEPARTMENT.id,
    departmentName: DEPARTMENT.name,
    code: 'POS-001',
    name: 'Инженер',
    isActive: true,
    ...overrides,
  };
}

function makePage<T>(items: T[], overrides: Partial<PaginatedData<T>> = {}): PaginatedData<T> {
  return { items, page: 1, limit: 20, total: items.length, totalPages: 1, ...overrides };
}

const MANAGER = [PERMISSIONS.ORG_VIEW, PERMISSIONS.ORG_MANAGE];

describe('PositionsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Both pickers on this screen: companies, and the departments of whichever is chosen.
    vi.spyOn(orgService, 'companies').mockResolvedValue(makePage([COMPANY]));
    vi.spyOn(orgService, 'departments').mockResolvedValue(makePage([DEPARTMENT]));
  });

  it('renders a position with its company and department', async () => {
    vi.spyOn(orgService, 'positions').mockResolvedValue(makePage([makePosition()]));

    renderWithAuth(<PositionsPage />, { permissions: [PERMISSIONS.ORG_VIEW] });

    expect(await screen.findByText('Инженер')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('POS-001')).toBeInTheDocument();
    expect(within(table).getByText('Монхорус ХХК')).toBeInTheDocument();
    expect(within(table).getByText('Цахилгааны хэлтэс')).toBeInTheDocument();
  });

  /** A position with no department belongs to all of them, and must not read as missing one. */
  it('shows a position without a department as valid across every department', async () => {
    vi.spyOn(orgService, 'positions').mockResolvedValue(
      makePage([makePosition({ departmentId: null, departmentName: null })]),
    );

    renderWithAuth(<PositionsPage />, { permissions: [PERMISSIONS.ORG_VIEW] });

    await screen.findByText('Инженер');
    expect(within(screen.getByRole('table')).getByText('Бүх хэлтэс')).toBeInTheDocument();
  });

  it('asks the server to search rather than filtering what came back', async () => {
    const list = vi.spyOn(orgService, 'positions').mockResolvedValue(makePage([makePosition()]));
    const user = userEvent.setup();

    renderWithAuth(<PositionsPage />, { permissions: [PERMISSIONS.ORG_VIEW] });
    await screen.findByText('Инженер');

    await user.type(screen.getByLabelText('Хайлт'), 'инженер');
    await user.tab();

    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'инженер' })),
    );
  });

  it('asks for the next page when the reader turns it', async () => {
    const list = vi
      .spyOn(orgService, 'positions')
      .mockResolvedValue(makePage([makePosition()], { total: 25, totalPages: 2 }));
    const user = userEvent.setup();

    renderWithAuth(<PositionsPage />, { permissions: [PERMISSIONS.ORG_VIEW] });
    await screen.findByText('Инженер');

    await user.click(screen.getByRole('button', { name: 'Дараах' }));

    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
  });

  it('filters by company and then by department, from the first page', async () => {
    const list = vi
      .spyOn(orgService, 'positions')
      .mockResolvedValue(makePage([makePosition()], { total: 25, totalPages: 2 }));
    const user = userEvent.setup();

    renderWithAuth(<PositionsPage />, {
      permissions: [PERMISSIONS.ORG_VIEW],
      route: '/org/positions?page=2',
    });
    await screen.findByText('Инженер');
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));

    await screen.findByRole('option', { name: 'Монхорус ХХК' });
    await user.selectOptions(screen.getByLabelText('Байгууллага'), COMPANY.id);
    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, companyId: COMPANY.id }),
      ),
    );

    // The department options only exist once a company scopes them.
    await screen.findByRole('option', { name: 'Цахилгааны хэлтэс' });
    await user.selectOptions(screen.getByLabelText('Хэлтэс'), DEPARTMENT.id);

    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, companyId: COMPANY.id, departmentId: DEPARTMENT.id }),
      ),
    );
  });

  it('deactivates a position through the status endpoint', async () => {
    vi.spyOn(orgService, 'positions').mockResolvedValue(makePage([makePosition()]));
    const setStatus = vi
      .spyOn(orgService, 'setPositionStatus')
      .mockResolvedValue(makePosition({ isActive: false }));
    const user = userEvent.setup();

    renderWithAuth(<PositionsPage />, { permissions: MANAGER });
    await screen.findByText('Инженер');

    await user.click(within(screen.getByRole('table')).getByRole('button', { name: 'Үйлдэл' }));
    await user.click(screen.getByRole('menuitem', { name: 'Идэвхгүй болгох' }));
    await user.click(screen.getByRole('button', { name: 'Идэвхгүй болгох' }));

    await waitFor(() => expect(setStatus).toHaveBeenCalledWith('p1', { isActive: false }));
  });

  /** The blank department is an answer, so it is sent as an explicit null rather than dropped. */
  it('creates a company-wide position when no department is chosen', async () => {
    vi.spyOn(orgService, 'positions').mockResolvedValue(makePage([makePosition()]));
    const create = vi.spyOn(orgService, 'createPosition').mockResolvedValue(makePosition());
    const user = userEvent.setup();

    renderWithAuth(<PositionsPage />, { permissions: MANAGER });

    await user.click(await screen.findByRole('button', { name: 'Шинэ албан тушаал' }));
    const drawer = await screen.findByRole('dialog');

    expect(within(drawer).queryByLabelText(/^Код/)).not.toBeInTheDocument();
    await user.selectOptions(within(drawer).getByLabelText(/^Байгууллага/), COMPANY.id);
    await user.type(within(drawer).getByLabelText(/^Нэр/), 'Ерөнхий менежер');
    await user.click(within(drawer).getByRole('button', { name: 'Хадгалах' }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        companyId: COMPANY.id,
        departmentId: null,
        name: 'Ерөнхий менежер',
      }),
    );
  });
});
