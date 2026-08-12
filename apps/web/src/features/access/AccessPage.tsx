import {
  canManageRole,
  PERMISSIONS,
  USER_ROLE_LABELS,
  type RoleDto,
  type UserDto,
} from '@monhorus/shared';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Alert } from '../../components/ui/Alert';
import { StatusBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ColumnPicker } from '../../components/ui/ColumnPicker';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { DataTable, Pagination, type Column } from '../../components/ui/DataTable';
import { Drawer } from '../../components/ui/Drawer';
import { PageHeader } from '../../components/ui/PageHeader';
import { RowActions, type RowActionItem } from '../../components/ui/RowActions';
import { EmptyState, Skeleton } from '../../components/ui/States';
import { useToast } from '../../components/ui/ToastProvider';
import { useAuth } from '../../contexts/auth-context';
import { useTableColumns } from '../../hooks/use-table-columns';
import { ApiError } from '../../lib/api-client';
import { rbacService, type PermissionCatalogueEntry } from '../../services/rbac.service';
import { userService } from '../../services/user.service';
import { RoleEditorDrawer } from './RoleEditorDrawer';

type TabKey = 'roles' | 'users';

/**
 * Role and permission administration.
 *
 * System roles are seeded by the backend and cannot be deleted; their permission sets
 * remain editable by a holder of rbac.manage. The backend enforces both rules, so this
 * screen only avoids offering the action.
 */
/**
 * Users per page.
 *
 * Twenty, matching every other list in the app, so a reader meets the same rhythm
 * wherever they are.
 */
const USER_PAGE_SIZE = 20;

export function AccessPage(): ReactElement {
  const { can, user: actor } = useAuth();
  const { notify } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTab: TabKey = searchParams.get('tab') === 'users' ? 'users' : 'roles';
  // Two authorities, not one. `rbac.manage` governs ROLES — what a permission set holds
  // and who is given it. Changing an account's status is the USER directory's authority,
  // and the /users router asks for `user.manage`. Deriving both from one key is what made
  // the screen disagree with the API: the seeded ADMIN role holds neither `rbac.manage`
  // nor, before this, any key the suspend action recognised.
  const canManage = can(PERMISSIONS.RBAC_MANAGE);
  const canManageUsers = can(PERMISSIONS.USER_MANAGE);

  const [roles, setRoles] = useState<RoleDto[] | null>(null);
  const [catalogue, setCatalogue] = useState<PermissionCatalogueEntry[]>([]);
  const [users, setUsers] = useState<UserDto[] | null>(null);
  /**
   * The user list's window, held here rather than in the url.
   *
   * The url on this screen already carries `tab`, and a page number that outlived a tab
   * switch would put a reader on page four of a list they have just come back to. Roles
   * and users are two independent lists behind one address.
   */
  const [userPage, setUserPage] = useState(1);
  const [userTotal, setUserTotal] = useState({ total: 0, totalPages: 0 });
  const [error, setError] = useState<string | null>(null);

  const [editorRole, setEditorRole] = useState<RoleDto | null | 'new'>(null);
  const [deleteTarget, setDeleteTarget] = useState<RoleDto | null>(null);
  const [assignTarget, setAssignTarget] = useState<UserDto | null>(null);
  const [assignSelection, setAssignSelection] = useState<string[]>([]);
  const [assignBusy, setAssignBusy] = useState(false);
  const [statusTarget, setStatusTarget] = useState<UserDto | null>(null);

  const loadRoles = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const [roleList, permissionList] = await Promise.all([
        rbacService.roles(),
        rbacService.permissions(),
      ]);
      setRoles(roleList);
      setCatalogue(permissionList);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Role ачаалж чадсангүй.');
      setRoles([]);
    }
  }, []);

  const loadUsers = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      // A page rather than the first fifty. The old fixed limit silently hid the fifty-first
      // user, with nothing on screen to say a cap had been reached.
      const page = await rbacService.users({ page: userPage, limit: USER_PAGE_SIZE });
      setUsers(page.items);
      setUserTotal({ total: page.total, totalPages: page.totalPages });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Хэрэглэгч ачаалж чадсангүй.');
      setUsers([]);
      setUserTotal({ total: 0, totalPages: 0 });
    }
  }, [userPage]);

  useEffect(() => {
    void loadRoles();
  }, [loadRoles]);

  useEffect(() => {
    // The null guard is what stops this refiring on its own result. Paging clears the
    // rows before changing the page, so a page change comes back through here too.
    if (activeTab === 'users' && users === null) void loadUsers();
  }, [activeTab, users, loadUsers]);

  function switchTab(tab: TabKey): void {
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next);
  }

  async function handleDelete(): Promise<void> {
    if (!deleteTarget) return;
    try {
      await rbacService.deleteRole(deleteTarget.id);
      notify(`"${deleteTarget.name}" role устгагдлаа.`, 'success');
      await loadRoles();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : 'Устгаж чадсангүй.', 'error');
    } finally {
      setDeleteTarget(null);
    }
  }

  async function handleAssign(): Promise<void> {
    if (!assignTarget) return;
    setAssignBusy(true);
    try {
      await rbacService.assignRoles(assignTarget.id, assignSelection);
      notify('Хэрэглэгчийн эрх шинэчлэгдлээ.', 'success');
      setAssignTarget(null);
      setUsers(null);
      await loadUsers();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : 'Эрх оноож чадсангүй.', 'error');
    } finally {
      setAssignBusy(false);
    }
  }

  /**
   * Why the caller may not change this account's status, or null when they may.
   *
   * The same three refusals the backend makes, restated here only so a greyed-out action
   * carries its reason instead of the user discovering it through a failed request. The
   * server stays the authority; the self-check comes first because "your own account" is a
   * better answer than the role rule, which would also refuse an admin looking at itself.
   */
  function statusBlockReason(row: UserDto): string | null {
    if (!canManageUsers || !actor) return 'Эрх хүрэлцэхгүй';
    if (row.id === actor.id) return 'Өөрийн бүртгэл';
    return canManageRole(actor.role, row.role) ? null : 'Эрх хүрэлцэхгүй';
  }

  async function handleStatusChange(): Promise<void> {
    if (!statusTarget) return;
    // must_change_password is the system's to set, so the action only ever toggles the two
    // states an administrator owns.
    const next = statusTarget.status === 'suspended' ? 'active' : 'suspended';
    try {
      await userService.updateStatus(statusTarget.id, { status: next });
      notify(
        next === 'suspended'
          ? `"${statusTarget.fullName}" түр хаагдлаа.`
          : `"${statusTarget.fullName}" идэвхжлээ.`,
        'success',
      );
      await loadUsers();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : 'Төлөв солиж чадсангүй.', 'error');
    } finally {
      setStatusTarget(null);
    }
  }

  const roleColumns: ReadonlyArray<Column<RoleDto>> = [
    {
      key: 'name',
      header: 'Role',
      render: (row) => <span className="truncate font-medium text-slate-900">{row.name}</span>,
    },
    {
      key: 'key',
      header: 'Түлхүүр',
      render: (row) => <span className="truncate font-mono text-xs text-slate-500">{row.key}</span>,
    },
    {
      key: 'isSystem',
      header: 'Системийн',
      align: 'center',
      render: (row) =>
        row.isSystem ? (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
            Тийм
          </span>
        ) : (
          <span className="text-xs text-slate-400">Үгүй</span>
        ),
    },
    {
      key: 'permissions',
      header: 'Permission',
      align: 'center',
      render: (row) => <span className="text-slate-700">{row.permissions.length}</span>,
    },
    {
      key: 'users',
      header: 'Хэрэглэгч',
      align: 'center',
      render: (row) => <span className="text-slate-700">{row.userCount ?? 0}</span>,
    },
    {
      key: 'salary',
      header: 'Цалин харах',
      align: 'center',
      render: (row) =>
        row.permissions.includes(PERMISSIONS.EMPLOYEE_VIEW_SALARY) ? (
          <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200">
            Тийм
          </span>
        ) : (
          <span className="text-xs text-slate-400">Үгүй</span>
        ),
    },
    {
      key: 'actions',
      header: 'Үйлдэл',
      align: 'right',
      render: (row) => {
        const items: RowActionItem[] = [
          { label: canManage ? 'Засах' : 'Харах', onSelect: () => setEditorRole(row) },
        ];
        // A system role is seeded by the backend and refuses deletion, so it is never offered.
        if (canManage && !row.isSystem) {
          items.push({ label: 'Устгах', onSelect: () => setDeleteTarget(row), tone: 'danger' });
        }
        return <RowActions items={items} />;
      },
    },
  ];

  const userColumns: ReadonlyArray<Column<UserDto>> = [
    {
      key: 'user',
      header: 'Хэрэглэгч',
      render: (row) => <span className="truncate font-medium text-slate-900">{row.fullName}</span>,
    },
    {
      key: 'email',
      header: 'Имэйл',
      render: (row) => <span className="truncate text-slate-700">{row.email}</span>,
    },
    {
      key: 'role',
      header: 'Үндсэн эрх',
      render: (row) => <span className="text-slate-700">{USER_ROLE_LABELS[row.role]}</span>,
    },
    {
      key: 'status',
      header: 'Төлөв',
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'lastLogin',
      header: 'Сүүлд нэвтэрсэн',
      render: (row) => (
        <span className="whitespace-nowrap text-slate-700">
          {row.lastLoginAt
            ? new Date(row.lastLoginAt).toLocaleString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' })
            : 'Нэвтрээгүй'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Үйлдэл',
      align: 'right',
      // Actions stay visible but disabled for a caller who may not perform them, because the
      // old cell spelled out why it was unavailable and dropping it would lose that answer.
      render: (row) => {
        const blocked = statusBlockReason(row);
        const suspending = row.status !== 'suspended';
        return (
          <RowActions
            items={[
              {
                label: 'Role оноох',
                onSelect: () => {
                  setAssignTarget(row);
                  setAssignSelection([]);
                },
                disabled: !canManage,
                disabledReason: 'Эрх хүрэлцэхгүй',
              },
              {
                label: suspending ? 'Түр хаах' : 'Идэвхжүүлэх',
                onSelect: () => setStatusTarget(row),
                tone: suspending ? 'danger' : 'default',
                disabled: blocked !== null,
                disabledReason: blocked ?? undefined,
              },
            ]}
          />
        );
      },
    },
  ];

  const roleColumnState = useTableColumns('access-roles', roleColumns);
  const userColumnState = useTableColumns('access-users', userColumns);

  return (
    <>
      <PageHeader
        title="Хэрэглэгч, role, permission"
        breadcrumbs={[{ label: 'Нүүр', to: '/dashboard' }, { label: 'Хэрэглэгч, role, permission' }]}
        actions={
          canManage && activeTab === 'roles' ? (
            <Button onClick={() => setEditorRole('new')}>Шинэ role</Button>
          ) : null
        }
      />

      {error && (
        <div className="mb-4">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <div role="tablist" aria-label="Эрхийн удирдлага" className="flex gap-1 border-b border-slate-200 px-3 pt-2">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'roles'}
            onClick={() => switchTab('roles')}
            className={`rounded-t-md px-3 py-2 text-sm font-medium ${
              activeTab === 'roles'
                ? 'border-b-2 border-slate-900 text-slate-900'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Role ({roles?.length ?? 0})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'users'}
            onClick={() => switchTab('users')}
            className={`rounded-t-md px-3 py-2 text-sm font-medium ${
              activeTab === 'users'
                ? 'border-b-2 border-slate-900 text-slate-900'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Хэрэглэгч
          </button>
        </div>

        {activeTab === 'roles' && (
          <>
            <div className="flex justify-end px-3 py-2">
              <ColumnPicker controller={roleColumnState} />
            </div>
            <DataTable
              columns={roleColumnState.visibleColumns}
              rows={roles ?? []}
              rowKey={(row) => row.id}
              // NUMBERED BUT NOT PAGED, and deliberately. A role is a permission set an
              // administrator defines by hand: the system ships a fixed handful and an
              // installation adds a few, so the list is bounded by how many distinct jobs
              // an organisation has. Paging it would add a control that never appears —
              // `Pagination` hides itself below two pages — for a list that fits on one
              // screen. The endpoint returns them all, and that is the right answer here.
              numbering
              loading={roles === null}
              emptyTitle="Role байхгүй"
              emptyDescription="Системийн role-ууд эхний ажиллагаанд автоматаар үүснэ."
            />
          </>
        )}

        {activeTab === 'users' && (
          <>
            <div className="flex justify-end px-3 py-2">
              <ColumnPicker controller={userColumnState} />
            </div>
            <DataTable
              columns={userColumnState.visibleColumns}
              rows={users ?? []}
              rowKey={(row) => row.id}
              numbering={{ page: userPage, limit: USER_PAGE_SIZE }}
              loading={users === null}
              emptyTitle="Хэрэглэгч байхгүй"
            />
            <Pagination
              page={userPage}
              totalPages={userTotal.totalPages}
              total={userTotal.total}
              onPageChange={(next) => {
                // Clearing the rows first so the table shows its skeleton rather than the
                // previous page's users under the new page's number.
                setUsers(null);
                setUserPage(next);
              }}
            />
          </>
        )}
      </div>

      <RoleEditorDrawer
        role={editorRole}
        catalogue={catalogue}
        readOnly={!canManage}
        onClose={() => setEditorRole(null)}
        onSaved={() => {
          setEditorRole(null);
          void loadRoles();
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Role устгах"
        message={
          deleteTarget
            ? `"${deleteTarget.name}" role-г устгах уу? Хэрэглэгчид оноогдсон бол устгах боломжгүй.`
            : ''
        }
        confirmLabel="Устгах"
        danger
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={statusTarget !== null}
        title={statusTarget?.status === 'suspended' ? 'Бүртгэл идэвхжүүлэх' : 'Бүртгэл түр хаах'}
        message={
          statusTarget === null
            ? ''
            : statusTarget.status === 'suspended'
              ? `"${statusTarget.fullName}"-н бүртгэлийг идэвхжүүлэх үү? Дахин нэвтрэх боломжтой болно.`
              : `"${statusTarget.fullName}"-н бүртгэлийг түр хаах уу? Нэвтэрсэн бүх сесс шууд хаагдана.`
        }
        confirmLabel={statusTarget?.status === 'suspended' ? 'Идэвхжүүлэх' : 'Түр хаах'}
        danger={statusTarget?.status !== 'suspended'}
        onCancel={() => setStatusTarget(null)}
        onConfirm={handleStatusChange}
      />

      <Drawer
        open={assignTarget !== null}
        title={assignTarget ? `${assignTarget.fullName} - role онооx` : ''}
        onClose={() => setAssignTarget(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAssignTarget(null)} disabled={assignBusy}>
              Цуцлах
            </Button>
            <Button onClick={() => void handleAssign()} loading={assignBusy}>
              Хадгалах
            </Button>
          </>
        }
      >
        {roles === null ? (
          <Skeleton className="h-32 w-full" />
        ) : roles.length === 0 ? (
          <EmptyState title="Role байхгүй" />
        ) : (
          <>
            <Alert variant="info">
              Оноосон role-уудын permission нэгтгэгдэж, хэрэглэгчийн эрх болно.
            </Alert>
            <ul className="mt-3 space-y-1.5">
              {roles.map((role) => (
                <li key={role.id}>
                  <label className="flex items-start gap-2 rounded-lg p-2 ring-1 ring-slate-200 hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={assignSelection.includes(role.id)}
                      onChange={() =>
                        setAssignSelection((previous) =>
                          previous.includes(role.id)
                            ? previous.filter((id) => id !== role.id)
                            : [...previous, role.id],
                        )
                      }
                      disabled={assignBusy}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-slate-900">
                        {role.name}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {role.permissions.length} permission
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}
      </Drawer>
    </>
  );
}
