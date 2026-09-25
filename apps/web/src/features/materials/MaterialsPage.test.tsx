import { PERMISSIONS, type MaterialItemDto, type PaginatedData } from '@monhorus/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../lib/api-client';
import { materialService } from '../../services/material.service';
import { renderWithAuth } from '../../test/render';
import { MaterialsPage } from './MaterialsPage';

function makeMaterial(overrides: Partial<MaterialItemDto> = {}): MaterialItemDto {
  return {
    id: 'm1',
    code: 'CBL-3X2.5',
    name: 'Кабель 3x2.5',
    category: 'CABLE',
    defaultUnit: 'METRE',
    description: null,
    isActive: true,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function makePage(items: MaterialItemDto[]): PaginatedData<MaterialItemDto> {
  return { items, page: 1, limit: 20, total: items.length, totalPages: 1 };
}

const MANAGER = [PERMISSIONS.MATERIAL_VIEW, PERMISSIONS.MATERIAL_MANAGE];

describe('MaterialsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('lists a material with its code, category and unit', async () => {
    vi.spyOn(materialService, 'list').mockResolvedValue(makePage([makeMaterial()]));

    renderWithAuth(<MaterialsPage />, { permissions: MANAGER, route: '/materials' });

    const table = await screen.findByRole('table', { name: 'Материалын жагсаалт' });
    expect(within(table).getByText('CBL-3X2.5')).toBeInTheDocument();
    expect(within(table).getByText('Кабель 3x2.5')).toBeInTheDocument();
    // The Mongolian labels, not the wire values.
    expect(within(table).getByText('Кабель, дамжуулагч')).toBeInTheDocument();
    expect(within(table).getByText('Метр')).toBeInTheDocument();
  });

  /**
   * The default list is the active one, because that is what a picker offers. "Бүгд" is
   * the only way to see retired rows, and it drops the filter rather than negating it —
   * the API returns both when `isActive` is absent.
   */
  it('asks for active materials by default and for both when Бүгд is chosen', async () => {
    const list = vi.spyOn(materialService, 'list').mockResolvedValue(makePage([makeMaterial()]));

    renderWithAuth(<MaterialsPage />, { permissions: MANAGER, route: '/materials' });
    await screen.findByRole('table', { name: 'Материалын жагсаалт' });

    expect(list).toHaveBeenCalledWith(expect.objectContaining({ isActive: true }));

    await userEvent.selectOptions(screen.getByLabelText('Төлөв'), 'all');

    await vi.waitFor(() => {
      const last = list.mock.calls.at(-1)?.[0];
      expect(last).not.toHaveProperty('isActive');
    });
  });

  it('creates a material from the drawer', async () => {
    vi.spyOn(materialService, 'list').mockResolvedValue(makePage([]));
    const create = vi.spyOn(materialService, 'create').mockResolvedValue(makeMaterial());

    renderWithAuth(<MaterialsPage />, { permissions: MANAGER, route: '/materials' });

    await userEvent.click(await screen.findByRole('button', { name: 'Шинэ материал' }));

    // Scoped to the drawer: the filter bar behind it carries an Ангилал control too.
    const drawer = within(screen.getByRole('dialog'));
    await userEvent.type(drawer.getByLabelText(/^Код/), 'brk-16a');
    await userEvent.type(drawer.getByLabelText(/^Нэр/), 'Автомат таслуур 16A');
    await userEvent.selectOptions(drawer.getByLabelText(/^Ангилал/), 'BREAKER');
    await userEvent.selectOptions(drawer.getByLabelText(/^Хэмжих нэгж/), 'PIECE');
    await userEvent.click(drawer.getByRole('button', { name: 'Хадгалах' }));

    // The shared schema upper-cases the code, so the server never sees the typed casing.
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'BRK-16A',
        name: 'Автомат таслуур 16A',
        category: 'BREAKER',
        defaultUnit: 'PIECE',
      }),
    );
  });

  it('refuses to submit a code the shared schema rejects', async () => {
    vi.spyOn(materialService, 'list').mockResolvedValue(makePage([]));
    const create = vi.spyOn(materialService, 'create');

    renderWithAuth(<MaterialsPage />, { permissions: MANAGER, route: '/materials' });

    await userEvent.click(await screen.findByRole('button', { name: 'Шинэ материал' }));
    await userEvent.type(screen.getByLabelText(/^Код/), 'a');
    await userEvent.type(screen.getByLabelText(/^Нэр/), 'Хэт богино кодтой');
    await userEvent.click(screen.getByRole('button', { name: 'Хадгалах' }));

    expect(create).not.toHaveBeenCalled();
    expect(await screen.findByText(/дор хаяж 2 тэмдэгттэй/)).toBeInTheDocument();
  });

  it('surfaces a duplicate-code rejection from the server against the field', async () => {
    vi.spyOn(materialService, 'list').mockResolvedValue(makePage([]));
    vi.spyOn(materialService, 'create').mockRejectedValue(
      new ApiError('Материалын код давхардсан байна.', 'DUPLICATE_KEY', 409, [
        { field: 'code', message: 'Код давхардсан.' },
      ]),
    );

    renderWithAuth(<MaterialsPage />, { permissions: MANAGER, route: '/materials' });

    await userEvent.click(await screen.findByRole('button', { name: 'Шинэ материал' }));
    await userEvent.type(screen.getByLabelText(/^Код/), 'CBL-3X2.5');
    await userEvent.type(screen.getByLabelText(/^Нэр/), 'Давхардсан');
    await userEvent.click(screen.getByRole('button', { name: 'Хадгалах' }));

    expect(await screen.findByText('Материалын код давхардсан байна.')).toBeInTheDocument();
    expect(screen.getByText('Код давхардсан.')).toBeInTheDocument();
  });

  /** Retiring, not deleting: planned works point at these rows and must keep resolving. */
  it('retires a material instead of deleting it', async () => {
    vi.spyOn(materialService, 'list').mockResolvedValue(makePage([makeMaterial()]));
    const update = vi.spyOn(materialService, 'update').mockResolvedValue(
      makeMaterial({ isActive: false }),
    );

    renderWithAuth(<MaterialsPage />, { permissions: MANAGER, route: '/materials' });

    const table = await screen.findByRole('table', { name: 'Материалын жагсаалт' });
    await userEvent.click(within(table).getByRole('button', { name: 'Үйлдэл' }));

    // No destructive option is offered at all.
    expect(screen.queryByRole('menuitem', { name: 'Устгах' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('menuitem', { name: 'Идэвхгүй болгох' }));
    await userEvent.click(screen.getByRole('button', { name: 'Идэвхгүй болгох' }));

    expect(update).toHaveBeenCalledWith('m1', { isActive: false });
  });

  it('offers no editing without material.manage', async () => {
    vi.spyOn(materialService, 'list').mockResolvedValue(makePage([makeMaterial()]));

    renderWithAuth(<MaterialsPage />, {
      permissions: [PERMISSIONS.MATERIAL_VIEW],
      route: '/materials',
    });

    const table = await screen.findByRole('table', { name: 'Материалын жагсаалт' });
    // The catalogue stays readable — a technician needs the names — but nothing writes.
    expect(within(table).getByText('CBL-3X2.5')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Шинэ материал' })).not.toBeInTheDocument();
    expect(within(table).queryByRole('button', { name: 'Үйлдэл' })).not.toBeInTheDocument();
  });
});
