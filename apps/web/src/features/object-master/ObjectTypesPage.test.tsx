import { PERMISSIONS, type ObjectTypeDto, type PaginatedData } from '@monhorus/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { objectTypeService } from '../../services/object-master.service';
import { renderWithAuth } from '../../test/render';
import { ObjectTypesPage } from './ObjectTypesPage';

function makeType(overrides: Partial<ObjectTypeDto> = {}): ObjectTypeDto {
  return {
    id: 't1',
    code: 'PANEL',
    name: 'Самбар',
    description: null,
    category: 'EQUIPMENT',
    showOnPlan: false,
    insidePanel: false,
    generatesConclusion: true,
    icon: 'OTHER',
    isActive: true,
    objectCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makePage(items: ObjectTypeDto[]): PaginatedData<ObjectTypeDto> {
  return { items, page: 1, limit: 50, total: items.length, totalPages: 1 };
}

describe('ObjectTypesPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('enables delete only for a type no object is using', async () => {
    vi.spyOn(objectTypeService, 'list').mockResolvedValue(
      makePage([
        makeType({ id: 't1', name: 'Ашиглагдаагүй', code: 'FREE', objectCount: 0 }),
        makeType({ id: 't2', name: 'Ашиглагдаж буй', code: 'USED', objectCount: 3 }),
      ]),
    );
    const user = userEvent.setup();

    renderWithAuth(<ObjectTypesPage />, {
      permissions: [PERMISSIONS.OBJECT_MASTER_VIEW, PERMISSIONS.OBJECT_TYPE_MANAGE],
    });

    await screen.findByText('Ашиглагдаагүй');
    const rows = within(screen.getByRole('table')).getAllByRole('row');

    await user.click(within(rows[1]!).getByRole('button', { name: 'Үйлдэл' }));
    expect(screen.getByRole('menuitem', { name: 'Засах' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Устгах' })).toBeEnabled();

    // A type already carrying objects still shows the action, disabled with its reason.
    await user.click(within(rows[2]!).getByRole('button', { name: 'Үйлдэл' }));
    expect(screen.getByRole('menuitem', { name: 'Засах' })).toBeInTheDocument();
    const blocked = screen.getByRole('menuitem', { name: 'Устгах' });
    expect(blocked).toBeDisabled();
    expect(blocked).toHaveAttribute(
      'title',
      'Энэ төрлийг 3 тоноглол ашиглаж байгаа тул устгах боломжгүй.',
    );
  });

  it('deletes a type that no object uses', async () => {
    vi.spyOn(objectTypeService, 'list').mockResolvedValue(
      makePage([makeType({ id: 't1', name: 'Ашиглагдаагүй', code: 'FREE', objectCount: 0 })]),
    );
    const remove = vi.spyOn(objectTypeService, 'remove').mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderWithAuth(<ObjectTypesPage />, {
      permissions: [PERMISSIONS.OBJECT_MASTER_VIEW, PERMISSIONS.OBJECT_TYPE_MANAGE],
    });

    await screen.findByText('Ашиглагдаагүй');
    await user.click(within(screen.getByRole('table')).getByRole('button', { name: 'Үйлдэл' }));
    await user.click(screen.getByRole('menuitem', { name: 'Устгах' }));
    await user.click(screen.getByRole('button', { name: 'Устгах' }));

    expect(remove).toHaveBeenCalledWith('t1');
  });

  it('drops the usage and status columns from the table', async () => {
    vi.spyOn(objectTypeService, 'list').mockResolvedValue(makePage([makeType()]));

    renderWithAuth(<ObjectTypesPage />, { permissions: [PERMISSIONS.OBJECT_MASTER_VIEW] });

    await screen.findByText('Самбар');
    const headers = within(screen.getByRole('table')).getAllByRole('columnheader');
    const labels = headers.map((header) => header.textContent);
    expect(labels).not.toContain('Ашиглалт');
    expect(labels).not.toContain('Төлөв');
  });

  it('leaves the action cell empty without object_type.manage', async () => {
    vi.spyOn(objectTypeService, 'list').mockResolvedValue(makePage([makeType()]));

    renderWithAuth(<ObjectTypesPage />, { permissions: [PERMISSIONS.OBJECT_MASTER_VIEW] });

    await screen.findByText('Самбар');
    expect(screen.queryByRole('button', { name: 'Шинэ төрөл' })).not.toBeInTheDocument();
    // Nothing is on offer, so there is no menu button to open in the first place.
    const table = screen.getByRole('table');
    expect(within(table).queryByRole('button', { name: 'Үйлдэл' })).not.toBeInTheDocument();
  });
});
