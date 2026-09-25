import { PERMISSIONS, type CompanyDto, type PaginatedData } from '@monhorus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { orgService } from '../../services/org.service';
import { renderWithAuth } from '../../test/render';
import { CompaniesPage } from './CompaniesPage';

function makeCompany(overrides: Partial<CompanyDto> = {}): CompanyDto {
  return {
    id: 'c1',
    code: 'COM-001',
    name: 'Монхорус ХХК',
    registrationNumber: '2712345',
    address: 'Улаанбаатар',
    isActive: true,
    ...overrides,
  };
}

function makePage(
  items: CompanyDto[],
  overrides: Partial<PaginatedData<CompanyDto>> = {},
): PaginatedData<CompanyDto> {
  return { items, page: 1, limit: 20, total: items.length, totalPages: 1, ...overrides };
}

const MANAGER = [PERMISSIONS.ORG_VIEW, PERMISSIONS.ORG_MANAGE];

describe('CompaniesPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a company with its server-issued code', async () => {
    vi.spyOn(orgService, 'companies').mockResolvedValue(makePage([makeCompany()]));

    renderWithAuth(<CompaniesPage />, { permissions: [PERMISSIONS.ORG_VIEW] });

    expect(await screen.findByText('Монхорус ХХК')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('COM-001')).toBeInTheDocument();
    expect(within(table).getByText('2712345')).toBeInTheDocument();
    expect(within(table).getByText('Идэвхтэй')).toBeInTheDocument();
  });

  /**
   * The filters are the server's job, and only the request proves it. A page that fetched
   * everything and hid the misses would render the same rows under a total that counts
   * companies the reader cannot see.
   */
  it('asks the server to search rather than filtering what came back', async () => {
    const list = vi.spyOn(orgService, 'companies').mockResolvedValue(makePage([makeCompany()]));
    const user = userEvent.setup();

    renderWithAuth(<CompaniesPage />, { permissions: [PERMISSIONS.ORG_VIEW] });
    await screen.findByText('Монхорус ХХК');

    await user.type(screen.getByLabelText('Хайлт'), 'монхорус');
    await user.tab();

    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'монхорус' })),
    );
  });

  it('asks for the next page when the reader turns it', async () => {
    const list = vi
      .spyOn(orgService, 'companies')
      .mockResolvedValue(makePage([makeCompany()], { total: 25, totalPages: 2 }));
    const user = userEvent.setup();

    renderWithAuth(<CompaniesPage />, { permissions: [PERMISSIONS.ORG_VIEW] });
    await screen.findByText('Монхорус ХХК');

    await user.click(screen.getByRole('button', { name: 'Дараах' }));

    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));
  });

  /** Page two of a different question is not page two: a new filter starts from the top. */
  it('returns to the first page when a filter changes', async () => {
    const list = vi
      .spyOn(orgService, 'companies')
      .mockResolvedValue(makePage([makeCompany()], { total: 25, totalPages: 2 }));
    const user = userEvent.setup();

    renderWithAuth(<CompaniesPage />, {
      permissions: [PERMISSIONS.ORG_VIEW],
      route: '/org/companies?page=2',
    });
    await screen.findByText('Монхорус ХХК');
    await waitFor(() => expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })));

    await user.selectOptions(screen.getByLabelText('Төлөв'), 'true');

    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, includeInactive: true }),
      ),
    );
  });

  it('deactivates a company through the status endpoint', async () => {
    vi.spyOn(orgService, 'companies').mockResolvedValue(makePage([makeCompany()]));
    const setStatus = vi
      .spyOn(orgService, 'setCompanyStatus')
      .mockResolvedValue(makeCompany({ isActive: false }));
    const user = userEvent.setup();

    renderWithAuth(<CompaniesPage />, { permissions: MANAGER });
    await screen.findByText('Монхорус ХХК');

    await user.click(within(screen.getByRole('table')).getByRole('button', { name: 'Үйлдэл' }));
    await user.click(screen.getByRole('menuitem', { name: 'Идэвхгүй болгох' }));
    await user.click(screen.getByRole('button', { name: 'Идэвхгүй болгох' }));

    await waitFor(() => expect(setStatus).toHaveBeenCalledWith('c1', { isActive: false }));
  });

  it('shows the company details in a drawer', async () => {
    vi.spyOn(orgService, 'companies').mockResolvedValue(makePage([makeCompany()]));
    const user = userEvent.setup();

    renderWithAuth(<CompaniesPage />, { permissions: [PERMISSIONS.ORG_VIEW] });
    await screen.findByText('Монхорус ХХК');

    await user.click(within(screen.getByRole('table')).getByRole('button', { name: 'Үйлдэл' }));
    await user.click(screen.getByRole('menuitem', { name: 'Харах' }));

    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('COM-001')).toBeInTheDocument();
    expect(within(drawer).getByText('Улаанбаатар')).toBeInTheDocument();
  });

  /** The code is the server's to issue, so the form has nowhere to type one. */
  it('offers no code field on the create form', async () => {
    vi.spyOn(orgService, 'companies').mockResolvedValue(makePage([makeCompany()]));
    const user = userEvent.setup();

    renderWithAuth(<CompaniesPage />, { permissions: MANAGER });

    await user.click(await screen.findByRole('button', { name: 'Шинэ байгууллага' }));
    const drawer = await screen.findByRole('dialog');

    expect(within(drawer).getByLabelText(/^Нэр/)).toBeInTheDocument();
    expect(within(drawer).queryByLabelText(/^Код/)).not.toBeInTheDocument();
  });

  it('hides every write action without org.manage', async () => {
    vi.spyOn(orgService, 'companies').mockResolvedValue(makePage([makeCompany()]));
    const user = userEvent.setup();

    renderWithAuth(<CompaniesPage />, { permissions: [PERMISSIONS.ORG_VIEW] });
    await screen.findByText('Монхорус ХХК');

    expect(screen.queryByRole('button', { name: 'Шинэ байгууллага' })).not.toBeInTheDocument();
    await user.click(within(screen.getByRole('table')).getByRole('button', { name: 'Үйлдэл' }));
    expect(screen.getByRole('menuitem', { name: 'Харах' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Засах' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Идэвхгүй болгох' })).not.toBeInTheDocument();
  });
});
