import {
  ACCOUNT_STATUSES,
  ACCOUNT_STATUS_LABELS,
  canManageRole,
  PERMISSIONS,
  USER_ROLES,
  USER_ROLE_LABELS,
  type AccountStatus,
  type UserDto,
  type UserRole,
} from '@monhorus/shared';
import { useState, type ReactElement } from 'react';

import { Alert } from '../../components/ui/Alert';
import { RoleBadge, StatusBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { SearchField } from '../../components/ui/SearchField';
import { Spinner } from '../../components/ui/Spinner';
import { FILTER_SEARCH_SLOT, FILTER_SELECT } from '../../components/ui/control-styles';
import { useAuth } from '../../contexts/auth-context';
import { useUsers } from '../../hooks/use-users';
import { ApiError } from '../../lib/api-client';
import { userService } from '../../services/user.service';
import { CreateUserModal } from './CreateUserModal';
import { ResetPasscodeModal } from './ResetPasscodeModal';

export function UsersPage(): ReactElement {
  const { user: actor, can } = useAuth();

  const [page, setPage] = useState(1);
  const [role, setRole] = useState<UserRole | ''>('');
  const [status, setStatus] = useState<AccountStatus | ''>('');
  const [search, setSearch] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<UserDto | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, loading, error, refetch } = useUsers({
    page,
    limit: 20,
    ...(role ? { role } : {}),
    ...(status ? { status } : {}),
    ...(search ? { search } : {}),
  });

  /**
  * Whether the caller may provision accounts at all.
  *
  * This screen is not routed today, and its create control used to render for anyone who
  * reached it. The /users endpoints require `user.manage`, so the gate is stated here too
  * rather than left for whoever wires the page up to discover.
  */
  const canProvision = can(PERMISSIONS.USER_MANAGE);

  /** True when the actor may act on this row. Same predicate the backend enforces. */
  function canManage(target: UserDto): boolean {
    if (!canProvision || !actor || target.id === actor.id) return false;
    return canManageRole(actor.role, target.role);
  }

  async function toggleStatus(target: UserDto): Promise<void> {
    setActionError(null);
    const next = target.status === 'suspended' ? 'active' : 'suspended';
    try {
      await userService.updateStatus(target.id, { status: next });
      await refetch();
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : 'Төлөв солиход алдаа гарлаа.');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Хэрэглэгчийн удирдлага</h1>
          <p className="mt-0.5 text-sm text-slate-600">
            Системд бүртгэлтэй хэрэглэгчид. Шинэ бүртгэлийг зөвхөн админ үүсгэнэ.
          </p>
        </div>
        {canProvision && <Button onClick={() => setCreateOpen(true)}>Шинэ хэрэглэгч</Button>}
      </div>

      {actionError && <Alert variant="error">{actionError}</Alert>}

      <div className="flex flex-wrap gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <SearchField
          wrapperClassName={FILTER_SEARCH_SLOT}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder="Нэр, имэйл, утсаар хайх"
          aria-label="Хайх"
        />
        <select
          value={role}
          onChange={(event) => {
            setRole(event.target.value as UserRole | '');
            setPage(1);
          }}
          aria-label="Эрхээр шүүх"
          className={FILTER_SELECT}
        >
          <option value="">Бүх эрх</option>
          {USER_ROLES.map((value) => (
            <option key={value} value={value}>
              {USER_ROLE_LABELS[value]}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as AccountStatus | '');
            setPage(1);
          }}
          aria-label="Төлөвөөр шүүх"
          className={FILTER_SELECT}
        >
          <option value="">Бүх төлөв</option>
          {ACCOUNT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {ACCOUNT_STATUS_LABELS[value]}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        {loading && (
          <div className="flex justify-center py-16">
            <Spinner size="lg" />
          </div>
        )}

        {!loading && error && (
          <div className="p-4">
            <Alert variant="error">{error}</Alert>
          </div>
        )}

        {!loading && !error && data && data.items.length === 0 && (
          <div className="px-6 py-16 text-center">
            <p className="text-sm font-medium text-slate-900">Хэрэглэгч олдсонгүй</p>
            <p className="mt-1 text-sm text-slate-600">Шүүлтүүрээ өөрчилж үзнэ үү.</p>
          </div>
        )}

        {!loading && !error && data && data.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  {/* Matches the shared DataTable's № column: narrow, right-aligned and
                      never wrapping, so a four-digit number on a later page stays on one
                      line. This table is hand-rolled rather than a DataTable, so the
                      column is spelled out here. */}
                  <th className="w-12 whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-700">
                    №
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Хэрэглэгч</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Эрх</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Байгууллага</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Төлөв</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">
                    Сүүлд нэвтэрсэн
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Үүсгэсэн</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-700">Үйлдэл</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((item, index) => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    {/* Continuous across pages: page 2 of 20 starts at 21, so a reader
                        asked to check row 34 can find row 34. */}
                    <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                      {(data.page - 1) * data.limit + index + 1}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{item.fullName}</div>
                      <div className="text-slate-500">{item.email}</div>
                      {item.phone && <div className="text-xs text-slate-400">{item.phone}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <RoleBadge role={item.role} />
                    </td>
                    {/*
                      The organisation is the security boundary for a customer account, so
                      an admin can see it on the list without opening the form. A customer
                      row with no organisation is called out rather than left blank: that
                      account cannot read anything until it is linked.
                    */}
                    <td className="px-4 py-3">
                      {item.customerName ? (
                        <span className="text-slate-700">{item.customerName}</span>
                      ) : item.role === 'customer' ? (
                        <span className="text-xs font-medium text-red-600">Холбогдоогүй</span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={item.status} />
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {item.lastLoginAt
                        ? new Date(item.lastLoginAt).toLocaleString('mn-MN', {
                            timeZone: 'Asia/Ulaanbaatar',
                          })
                        : 'Нэвтрээгүй'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-slate-700">{item.createdByName ?? '-'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        {canManage(item) ? (
                          <>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setResetTarget(item)}
                            >
                              Нууц үг шинэчлэх
                            </Button>
                            <Button
                              size="sm"
                              variant={item.status === 'suspended' ? 'secondary' : 'danger'}
                              onClick={() => void toggleStatus(item)}
                            >
                              {item.status === 'suspended' ? 'Идэвхжүүлэх' : 'Түр хаах'}
                            </Button>
                          </>
                        ) : (
                          <span className="text-xs text-slate-400">
                            {item.id === actor?.id ? 'Өөрийн бүртгэл' : 'Эрх хүрэлцэхгүй'}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-sm text-slate-600">
              Нийт {data.total} хэрэглэгч, хуудас {data.page}/{data.totalPages}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={page <= 1}
                onClick={() => setPage((value) => value - 1)}
              >
                Өмнөх
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={page >= data.totalPages}
                onClick={() => setPage((value) => value + 1)}
              >
                Дараах
              </Button>
            </div>
          </div>
        )}
      </div>

      <CreateUserModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => void refetch()}
      />
      <ResetPasscodeModal
        target={resetTarget}
        onClose={() => setResetTarget(null)}
        onReset={() => void refetch()}
      />
    </div>
  );
}
