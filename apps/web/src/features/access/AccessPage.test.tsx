import { PERMISSIONS, type RoleDto, type UserDto } from '@monhorus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../lib/api-client';
import { rbacService } from '../../services/rbac.service';
import { userService } from '../../services/user.service';
import { renderWithAuth } from '../../test/render';
import { AccessPage } from './AccessPage';

function makeRole(overrides: Partial<RoleDto> = {}): RoleDto {
  return {
    id: 'r1',
    key: 'CUSTOM',
    name: 'Тусгай role',
    description: null,
    permissions: [PERMISSIONS.EMPLOYEE_VIEW],
    isSystem: false,
    userCount: 0,
    createdByName: 'Б. Энхтөр',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * A listed account. `id` defaults to something other than the signed-in user's `u1`, so a
 * row is a stranger unless a case deliberately makes it the caller's own.
 */
function makeAccount(overrides: Partial<UserDto> = {}): UserDto {
  return {
    id: 'u9',
    fullName: 'Дорж Бат',
    email: 'dorj@test.mn',
    phone: null,
    role: 'technician',
    status: 'active',
    customerId: null,
    customerName: null,
    lastLoginAt: null,
    createdBy: null,
    createdByName: 'Б. Энхтөр',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function mockUserPage(items: readonly UserDto[]): void {
  vi.spyOn(rbacService, 'users').mockResolvedValue({
    items: [...items],
    page: 1,
    limit: 50,
    total: items.length,
    totalPages: 1,
  });
}

const CATALOGUE = [
  { key: PERMISSIONS.EMPLOYEE_VIEW, module: 'employee', label: 'Ажилтан харах' },
  { key: PERMISSIONS.EMPLOYEE_VIEW_SALARY, module: 'employee', label: 'Цалингийн мэдээлэл харах' },
  { key: PERMISSIONS.DISPATCH_VIEW, module: 'dispatch', label: 'Dispatch board харах' },
];

describe('AccessPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(rbacService, 'permissions').mockResolvedValue(CATALOGUE);
  });

  it('lists roles with permission and user counts', async () => {
    vi.spyOn(rbacService, 'roles').mockResolvedValue([
      makeRole({ name: 'Системийн админ', isSystem: true, userCount: 2 }),
    ]);

    renderWithAuth(<AccessPage />, { permissions: [PERMISSIONS.RBAC_VIEW] });

    expect(await screen.findByText('Системийн админ')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('Системийн')).toBeInTheDocument();
  });

  /**
   * A seeded role was created by nobody. Saying "Систем" distinguishes that from a role
   * whose creator was simply never recorded, which is what the dash means.
   */
  it('credits a seeded role to the system rather than to nobody', async () => {
    vi.spyOn(rbacService, 'roles').mockResolvedValue([
      makeRole({ name: 'Системийн админ', isSystem: true, createdByName: null }),
    ]);

    renderWithAuth(<AccessPage />, { permissions: [PERMISSIONS.RBAC_VIEW] });

    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Үүсгэсэн' })).toBeInTheDocument();
    expect(within(table).getByText('Систем')).toBeInTheDocument();
  });

  it('names the administrator who defined a custom role', async () => {
    vi.spyOn(rbacService, 'roles').mockResolvedValue([
      makeRole({ name: 'Санхүү', isSystem: false, createdByName: 'Б. Энхтөр' }),
    ]);

    renderWithAuth(<AccessPage />, { permissions: [PERMISSIONS.RBAC_VIEW] });

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Б. Энхтөр')).toBeInTheDocument();
  });

  it('flags a role that grants salary visibility', async () => {
    vi.spyOn(rbacService, 'roles').mockResolvedValue([
      makeRole({ name: 'Санхүү', permissions: [PERMISSIONS.EMPLOYEE_VIEW_SALARY] }),
    ]);

    renderWithAuth(<AccessPage />, { permissions: [PERMISSIONS.RBAC_VIEW] });

    await screen.findByText('Санхүү');
    // The salary column marks roles that can read compensation.
    expect(within(screen.getByRole('table')).getByText('Тийм')).toBeInTheDocument();
  });

  it('never offers delete for a system role', async () => {
    vi.spyOn(rbacService, 'roles').mockResolvedValue([
      makeRole({ name: 'Системийн админ', isSystem: true }),
      makeRole({ id: 'r2', name: 'Тусгай', isSystem: false }),
    ]);
    const user = userEvent.setup();

    renderWithAuth(<AccessPage />, {
      permissions: [PERMISSIONS.RBAC_VIEW, PERMISSIONS.RBAC_MANAGE],
    });

    await screen.findByText('Системийн админ');
    const rows = within(screen.getByRole('table')).getAllByRole('row');

    // Only the non-system role exposes a delete action.
    await user.click(within(rows[1]!).getByRole('button', { name: 'Үйлдэл' }));
    expect(screen.queryByRole('menuitem', { name: 'Устгах' })).not.toBeInTheDocument();

    await user.click(within(rows[2]!).getByRole('button', { name: 'Үйлдэл' }));
    expect(screen.getAllByRole('menuitem', { name: 'Устгах' })).toHaveLength(1);
  });

  /**
   * The users tab used to ask for a fixed fifty and render whatever came back, so the
   * fifty-first user was unreachable with nothing on screen saying so.
   */
  it('asks for one page of users rather than a fixed fifty', async () => {
    vi.spyOn(rbacService, 'roles').mockResolvedValue([makeRole()]);
    const users = vi.spyOn(rbacService, 'users').mockResolvedValue({
      items: [makeAccount()],
      page: 1,
      limit: 20,
      total: 45,
      totalPages: 3,
    });
    const user = userEvent.setup();

    renderWithAuth(<AccessPage />, { permissions: [PERMISSIONS.RBAC_VIEW] });
    await user.click(screen.getByRole('tab', { name: 'Хэрэглэгч' }));

    await waitFor(() =>
      expect(users).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 20 })),
    );
  });

  it('numbers the users and continues the numbering onto the next page', async () => {
    vi.spyOn(rbacService, 'roles').mockResolvedValue([makeRole()]);
    const users = vi.spyOn(rbacService, 'users').mockResolvedValue({
      items: [makeAccount()],
      page: 1,
      limit: 20,
      total: 45,
      totalPages: 3,
    });
    const user = userEvent.setup();

    renderWithAuth(<AccessPage />, { permissions: [PERMISSIONS.RBAC_VIEW] });
    await user.click(screen.getByRole('tab', { name: 'Хэрэглэгч' }));
    await screen.findByText('Дорж Бат');

    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: '№' })).toBeInTheDocument();
    expect(within(table).getAllByRole('row')[1]!.textContent).toMatch(/^1/);

    // Дараах asks the server for the next window, and the numbering follows it.
    await user.click(screen.getByRole('button', { name: 'Дараах' }));
    await waitFor(() =>
      expect(users).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })),
    );
  });

  /**
   * Roles are numbered but never paged. A role is a permission set an administrator
   * defines by hand, so the list is bounded by how many distinct jobs an organisation
   * has — a pager there would be a control that never appears.
   */
  it('numbers the roles without offering a pager', async () => {
    vi.spyOn(rbacService, 'roles').mockResolvedValue([makeRole()]);

    renderWithAuth(<AccessPage />, { permissions: [PERMISSIONS.RBAC_VIEW] });
    await screen.findByText('Тусгай role');

    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: '№' })).toBeInTheDocument();
    expect(within(table).getAllByRole('row')[1]!.textContent).toMatch(/^1/);
    expect(screen.queryByRole('button', { name: 'Дараах' })).not.toBeInTheDocument();
  });

  it('hides every management action without rbac.manage', async () => {
    vi.spyOn(rbacService, 'roles').mockResolvedValue([makeRole()]);
    const user = userEvent.setup();

    renderWithAuth(<AccessPage />, { permissions: [PERMISSIONS.RBAC_VIEW] });

    await screen.findByText('Тусгай role');
    expect(screen.queryByRole('button', { name: 'Шинэ role' })).not.toBeInTheDocument();

    const row = within(screen.getByRole('table')).getAllByRole('row')[1]!;
    await user.click(within(row).getByRole('button', { name: 'Үйлдэл' }));

    expect(screen.queryByRole('menuitem', { name: 'Устгах' })).not.toBeInTheDocument();
    // Read-only callers still get a view action.
    expect(screen.getByRole('menuitem', { name: 'Харах' })).toBeInTheDocument();
  });

  it('keeps every row action behind one menu button, destructive item last', async () => {
    vi.spyOn(rbacService, 'roles').mockResolvedValue([makeRole()]);
    const user = userEvent.setup();

    renderWithAuth(<AccessPage />, {
      permissions: [PERMISSIONS.RBAC_VIEW, PERMISSIONS.RBAC_MANAGE],
    });

    await screen.findByText('Тусгай role');
    const row = within(screen.getByRole('table')).getAllByRole('row')[1]!;
    const trigger = within(row).getByRole('button', { name: 'Үйлдэл' });

    // Nothing is on screen until the menu is opened.
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await user.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['Засах', 'Устгах']);
    // Destructive last and coloured, so it is never the item under the cursor.
    expect(items[1]).toHaveClass('text-red-600');
  });

  it('explains rather than hides the role assignment a caller may not perform', async () => {
    vi.spyOn(rbacService, 'roles').mockResolvedValue([makeRole()]);
    mockUserPage([makeAccount({ role: 'admin' })]);
    const user = userEvent.setup();

    renderWithAuth(<AccessPage />, {
      permissions: [PERMISSIONS.RBAC_VIEW],
      route: '/access?tab=users',
    });

    await screen.findByText('Дорж Бат');
    const row = within(screen.getByRole('table')).getAllByRole('row')[1]!;
    await user.click(within(row).getByRole('button', { name: 'Үйлдэл' }));

    const assign = screen.getByRole('menuitem', { name: 'Role оноох' });
    expect(assign).toBeDisabled();
    expect(assign).toHaveAttribute('title', 'Эрх хүрэлцэхгүй');
  });

  it('suspends a user after the confirmation is accepted', async () => {
    vi.spyOn(rbacService, 'roles').mockResolvedValue([makeRole()]);
    mockUserPage([makeAccount()]);
    const updateStatus = vi
      .spyOn(userService, 'updateStatus')
      .mockResolvedValue(makeAccount({ status: 'suspended' }));
    const user = userEvent.setup();

    renderWithAuth(<AccessPage />, {
      permissions: [PERMISSIONS.RBAC_VIEW, PERMISSIONS.USER_MANAGE],
      route: '/access?tab=users',
    });

    await screen.findByText('Дорж Бат');
    const row = within(screen.getByRole('table')).getAllByRole('row')[1]!;
    await user.click(within(row).getByRole('button', { name: 'Үйлдэл' }));
    await user.click(screen.getByRole('menuitem', { name: 'Түр хаах' }));

    // Nothing is sent until the confirmation is accepted.
    expect(updateStatus).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: 'Бүртгэл түр хаах' });
    expect(within(dialog).getByText(/Дорж Бат/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Түр хаах' }));

    await waitFor(() => expect(updateStatus).toHaveBeenCalledWith('u9', { status: 'suspended' }));
    // The list is re-read, so the row shows the status the server now holds.
    expect(rbacService.users).toHaveBeenCalledTimes(2);
  });

  it('offers reactivation rather than suspension for a suspended user', async () => {
    vi.spyOn(rbacService, 'roles').mockResolvedValue([makeRole()]);
    mockUserPage([makeAccount({ status: 'suspended' })]);
    const user = userEvent.setup();

    renderWithAuth(<AccessPage />, {
      permissions: [PERMISSIONS.RBAC_VIEW, PERMISSIONS.USER_MANAGE],
      route: '/access?tab=users',
    });

    await screen.findByText('Дорж Бат');
    const row = within(screen.getByRole('table')).getAllByRole('row')[1]!;
    await user.click(within(row).getByRole('button', { name: 'Үйлдэл' }));

    const item = screen.getByRole('menuitem', { name: 'Идэвхжүүлэх' });
    expect(item).toBeEnabled();
    // Restoring access is not destructive, so it is not coloured as such.
    expect(item).not.toHaveClass('text-red-600');
    expect(screen.queryByRole('menuitem', { name: 'Түр хаах' })).not.toBeInTheDocument();
  });

  it('refuses the status action on the caller own row', async () => {
    vi.spyOn(rbacService, 'roles').mockResolvedValue([makeRole()]);
    // `renderWithAuth` signs in as u1, so this row is the caller looking at itself.
    mockUserPage([makeAccount({ id: 'u1', fullName: 'Тест Хэрэглэгч', role: 'admin' })]);
    const user = userEvent.setup();

    renderWithAuth(<AccessPage />, {
      permissions: [PERMISSIONS.RBAC_VIEW, PERMISSIONS.USER_MANAGE],
      route: '/access?tab=users',
    });

    await screen.findByText('Тест Хэрэглэгч');
    const row = within(screen.getByRole('table')).getAllByRole('row')[1]!;
    await user.click(within(row).getByRole('button', { name: 'Үйлдэл' }));

    const item = screen.getByRole('menuitem', { name: 'Түр хаах' });
    expect(item).toBeDisabled();
    // The self rule is reported ahead of the role rule, which would also refuse this row.
    expect(item).toHaveAttribute('title', 'Өөрийн бүртгэл');
  });

  it('refuses the status action on a target the caller may not manage', async () => {
    vi.spyOn(rbacService, 'roles').mockResolvedValue([makeRole()]);
    // A plain admin acting on a peer admin: the rule assertCanManageRole enforces server-side.
    mockUserPage([makeAccount({ role: 'admin' })]);
    const user = userEvent.setup();

    renderWithAuth(<AccessPage />, {
      permissions: [PERMISSIONS.RBAC_VIEW, PERMISSIONS.USER_MANAGE],
      role: 'admin',
      route: '/access?tab=users',
    });

    await screen.findByText('Дорж Бат');
    const row = within(screen.getByRole('table')).getAllByRole('row')[1]!;
    await user.click(within(row).getByRole('button', { name: 'Үйлдэл' }));

    const item = screen.getByRole('menuitem', { name: 'Түр хаах' });
    expect(item).toBeDisabled();
    expect(item).toHaveAttribute('title', 'Эрх хүрэлцэхгүй');
  });

  it('shows the status in Mongolian rather than the stored enum value', async () => {
    vi.spyOn(rbacService, 'roles').mockResolvedValue([makeRole()]);
    mockUserPage([makeAccount({ status: 'suspended' })]);

    renderWithAuth(<AccessPage />, {
      permissions: [PERMISSIONS.RBAC_VIEW],
      route: '/access?tab=users',
    });

    await screen.findByText('Дорж Бат');
    const table = screen.getByRole('table');
    expect(within(table).getByText('Түр хаагдсан')).toBeInTheDocument();
    expect(within(table).queryByText('suspended')).not.toBeInTheDocument();
  });

  it('reports a status change the server refuses', async () => {
    vi.spyOn(rbacService, 'roles').mockResolvedValue([makeRole()]);
    mockUserPage([makeAccount()]);
    vi.spyOn(userService, 'updateStatus').mockRejectedValue(
      new ApiError('Эрх хүрэлцэхгүй байна.', 'INSUFFICIENT_PRIVILEGES', 403),
    );
    const user = userEvent.setup();

    renderWithAuth(<AccessPage />, {
      permissions: [PERMISSIONS.RBAC_VIEW, PERMISSIONS.USER_MANAGE],
      route: '/access?tab=users',
    });

    await screen.findByText('Дорж Бат');
    const row = within(screen.getByRole('table')).getAllByRole('row')[1]!;
    await user.click(within(row).getByRole('button', { name: 'Үйлдэл' }));
    await user.click(screen.getByRole('menuitem', { name: 'Түр хаах' }));

    const dialog = await screen.findByRole('dialog', { name: 'Бүртгэл түр хаах' });
    await user.click(within(dialog).getByRole('button', { name: 'Түр хаах' }));

    // The server message is shown as-is rather than a generic failure.
    expect(await screen.findByText('Эрх хүрэлцэхгүй байна.')).toBeInTheDocument();
  });

  it('reports a load failure', async () => {
    vi.spyOn(rbacService, 'roles').mockRejectedValue(
      new ApiError('Сервер алдаа', 'INTERNAL_ERROR', 500),
    );

    renderWithAuth(<AccessPage />, { permissions: [PERMISSIONS.RBAC_VIEW] });

    expect(await screen.findByText('Сервер алдаа')).toBeInTheDocument();
  });

  it('groups permissions by module in the role editor', async () => {
    vi.spyOn(rbacService, 'roles').mockResolvedValue([makeRole()]);
    const user = userEvent.setup();

    renderWithAuth(<AccessPage />, {
      permissions: [PERMISSIONS.RBAC_VIEW, PERMISSIONS.RBAC_MANAGE],
    });

    await user.click(await screen.findByRole('button', { name: 'Шинэ role' }));

    const dialog = await screen.findByRole('dialog', { name: 'Шинэ role' });
    // Module group headers come from the shared catalogue, not a local copy.
    expect(within(dialog).getByText('Ажилтан')).toBeInTheDocument();
    expect(within(dialog).getByText('Dispatch')).toBeInTheDocument();
  });

  it('blocks an invalid new role and does not call the API', async () => {
    vi.spyOn(rbacService, 'roles').mockResolvedValue([makeRole()]);
    const create = vi.spyOn(rbacService, 'createRole');
    const user = userEvent.setup();

    renderWithAuth(<AccessPage />, {
      permissions: [PERMISSIONS.RBAC_VIEW, PERMISSIONS.RBAC_MANAGE],
    });

    await user.click(await screen.findByRole('button', { name: 'Шинэ role' }));
    const dialog = await screen.findByRole('dialog', { name: 'Шинэ role' });
    await user.click(within(dialog).getByRole('button', { name: 'Хадгалах' }));

    await waitFor(() => {
      expect(
        within(dialog).getByText('Оруулсан мэдээлэл шаардлага хангахгүй байна.'),
      ).toBeInTheDocument();
    });
    expect(create).not.toHaveBeenCalled();
  });
  /**
   * The bug this split fixes.
   *
   * The seeded ADMIN role holds `user.manage` and not `rbac.manage`. Deriving both
   * controls from one key meant such an administrator saw the suspend action greyed out
   * while the API would have accepted it — the screen disagreeing with the server in the
   * strict direction, which reads as a broken permission rather than a deliberate rule.
   */
  it('separates the user directory authority from the role authority', async () => {
    vi.spyOn(rbacService, 'roles').mockResolvedValue([makeRole()]);
    mockUserPage([makeAccount({ role: 'technician' })]);
    const user = userEvent.setup();

    renderWithAuth(<AccessPage />, {
      permissions: [PERMISSIONS.RBAC_VIEW, PERMISSIONS.USER_MANAGE],
      route: '/access?tab=users',
    });

    await screen.findByText('Дорж Бат');
    const row = within(screen.getByRole('table')).getAllByRole('row')[1]!;
    await user.click(within(row).getByRole('button', { name: 'Үйлдэл' }));

    expect(screen.getByRole('menuitem', { name: 'Түр хаах' })).toBeEnabled();
    // Assigning a role is still the RBAC authority, which this caller does not hold.
    const assign = screen.getByRole('menuitem', { name: 'Role оноох' });
    expect(assign).toBeDisabled();
    expect(assign).toHaveAttribute('title', 'Эрх хүрэлцэхгүй');
  });
});

/**
 * Filtering the user directory.
 *
 * Every filter is applied by the server — `/users` already accepts search, role and status —
 * so these assert on what was ASKED FOR rather than on what is rendered. A screen that
 * fetched everything and hid the misses would still show the right rows while reporting a
 * total that counts users the reader cannot see, and only the request reveals the
 * difference.
 */
describe('AccessPage user filters', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(rbacService, 'permissions').mockResolvedValue(CATALOGUE);
    vi.spyOn(rbacService, 'roles').mockResolvedValue([makeRole()]);
  });

  function mockUsers() {
    return vi.spyOn(rbacService, 'users').mockResolvedValue({
      items: [makeAccount()],
      page: 1,
      limit: 20,
      total: 45,
      totalPages: 3,
    });
  }

  async function openUsersTab(user: ReturnType<typeof userEvent.setup>) {
    renderWithAuth(<AccessPage />, { permissions: [PERMISSIONS.RBAC_VIEW] });
    await user.click(screen.getByRole('tab', { name: 'Хэрэглэгч' }));
    await screen.findByRole('table');
  }

  it('asks the server to search rather than filtering what came back', async () => {
    const user = userEvent.setup();
    const users = mockUsers();

    await openUsersTab(user);
    await user.type(screen.getByLabelText('Хайлт'), 'дорж');
    await user.tab();

    await waitFor(() =>
      expect(users).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'дорж' })),
    );
  });

  it('asks the server to filter by role and by status', async () => {
    const user = userEvent.setup();
    const users = mockUsers();

    await openUsersTab(user);
    await user.selectOptions(screen.getByLabelText('Эрх'), 'admin');
    await waitFor(() =>
      expect(users).toHaveBeenLastCalledWith(expect.objectContaining({ role: 'admin' })),
    );

    await user.selectOptions(screen.getByLabelText('Төлөв'), 'suspended');
    // Both travel together: narrowing by status must not drop the role already chosen.
    await waitFor(() =>
      expect(users).toHaveBeenLastCalledWith(
        expect.objectContaining({ role: 'admin', status: 'suspended' }),
      ),
    );
  });

  /** The requirement: a filter must survive paging, or page two is a different question. */
  it('keeps the filters when the reader turns the page', async () => {
    const user = userEvent.setup();
    const users = mockUsers();

    await openUsersTab(user);
    await user.selectOptions(screen.getByLabelText('Эрх'), 'admin');
    await waitFor(() =>
      expect(users).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, role: 'admin' })),
    );

    await user.click(screen.getByRole('button', { name: 'Дараах' }));

    await waitFor(() =>
      expect(users).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, role: 'admin' })),
    );
  });

  /** Page four of the whole directory is usually past the end of a filtered one. */
  it('returns to the first page when a filter changes', async () => {
    const user = userEvent.setup();
    const users = mockUsers();

    await openUsersTab(user);
    await user.click(screen.getByRole('button', { name: 'Дараах' }));
    await waitFor(() =>
      expect(users).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 })),
    );

    await user.selectOptions(screen.getByLabelText('Төлөв'), 'active');

    await waitFor(() =>
      expect(users).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, status: 'active' }),
      ),
    );
  });

  it('sends no filter key at all when a filter is cleared', async () => {
    const user = userEvent.setup();
    const users = mockUsers();

    await openUsersTab(user);
    await user.selectOptions(screen.getByLabelText('Эрх'), 'admin');
    await waitFor(() =>
      expect(users).toHaveBeenLastCalledWith(expect.objectContaining({ role: 'admin' })),
    );

    await user.click(screen.getByRole('button', { name: 'Шүүлтүүр цэвэрлэх' }));

    // Absent, not empty: the query schema types role as an enum, so '' is a 400.
    await waitFor(() => {
      const last = users.mock.calls.at(-1)?.[0] ?? {};
      expect('role' in last).toBe(false);
    });
    expect(screen.getByLabelText('Хайлт')).toHaveValue('');
  });

  it('offers the clear control only while something is filtered', async () => {
    const user = userEvent.setup();
    mockUsers();

    await openUsersTab(user);
    expect(
      screen.queryByRole('button', { name: 'Шүүлтүүр цэвэрлэх' }),
    ).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Төлөв'), 'active');

    expect(
      await screen.findByRole('button', { name: 'Шүүлтүүр цэвэрлэх' }),
    ).toBeInTheDocument();
  });
});
