import {
  EMPLOYEE_STATUSES,
  EMPLOYEE_STATUS_LABELS,
  EMPLOYEE_TYPES,
  EMPLOYEE_TYPE_LABELS,
  PERMISSIONS,
  type EmployeeListItemDto,
  type EmployeeListQuery,
  type EmployeeStatus,
  type EmployeeType,
} from '@monhorus/shared';
import { useMemo, useState, type ReactElement } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Button } from '../../components/ui/Button';
import { ColumnPicker } from '../../components/ui/ColumnPicker';
import { DataTable, Pagination, type Column } from '../../components/ui/DataTable';
import { EmployeeStatusBadge } from '../../components/ui/DomainBadges';
import { PageHeader } from '../../components/ui/PageHeader';
import { RowActions, type RowActionItem } from '../../components/ui/RowActions';
import { SearchField } from '../../components/ui/SearchField';
import { FILTER_BAR, FILTER_LABEL, FILTER_SELECT } from '../../components/ui/control-styles';
import { useAuth } from '../../contexts/auth-context';
import { useTableColumns } from '../../hooks/use-table-columns';
import { useEmployeeList } from './useEmployeeList';

/** Initials fallback when an employee has no uploaded photo. */
function initialsOf(employee: EmployeeListItemDto): string {
  return `${employee.lastName.charAt(0)}${employee.firstName.charAt(0)}`.toUpperCase();
}

export function EmployeeListPage(): ReactElement {
  const { can } = useAuth();
  const navigate = useNavigate();

  // URL is the source of truth for filters, so a filtered list is shareable and
  // survives a browser reload.
  const [searchParams, setSearchParams] = useSearchParams();

  const query = useMemo<EmployeeListQuery>(() => {
    const page = Number.parseInt(searchParams.get('page') ?? '1', 10);
    const status = searchParams.get('status');
    const employeeType = searchParams.get('employeeType');
    const search = searchParams.get('search');

    return {
      page: Number.isFinite(page) && page > 0 ? page : 1,
      limit: 20,
      ...(search ? { search } : {}),
      ...(status ? { status: status as EmployeeStatus } : {}),
      ...(employeeType ? { employeeType: employeeType as EmployeeType } : {}),
    };
  }, [searchParams]);

  const [searchDraft, setSearchDraft] = useState(() => searchParams.get('search') ?? '');
  const { data, loading, error, refetch } = useEmployeeList(query);

  function updateParam(key: string, value: string): void {
    const next = new URLSearchParams(searchParams);
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    // Any filter change resets paging; page 5 of the old filter is meaningless.
    if (key !== 'page') next.delete('page');
    setSearchParams(next);
  }

  function clearFilters(): void {
    setSearchDraft('');
    setSearchParams(new URLSearchParams());
  }

  const hasFilters = ['search', 'status', 'employeeType'].some((key) => searchParams.get(key));

  const columns: ReadonlyArray<Column<EmployeeListItemDto>> = [
    {
      key: 'photo',
      header: 'Зураг',
      render: (row) =>
        row.photoUrl ? (
          <img
            src={row.photoUrl}
            alt=""
            className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-slate-200"
          />
        ) : (
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-600">
            {initialsOf(row)}
          </span>
        ),
    },
    {
      key: 'employee',
      header: 'Ажилтан',
      render: (row) => (
        <span className="truncate font-medium text-slate-900">
          {row.lastName} {row.firstName}
        </span>
      ),
    },
    {
      key: 'employeeCode',
      header: 'Код',
      render: (row) => (
        <span className="whitespace-nowrap text-slate-600">{row.employeeCode}</span>
      ),
    },
    {
      key: 'registration',
      header: 'Регистр',
      render: (row) => <span className="text-slate-700">{row.registrationNumber ?? '-'}</span>,
    },
    {
      key: 'company',
      header: 'Байгууллага',
      render: (row) => <span className="text-slate-700">{row.company?.name ?? '-'}</span>,
    },
    {
      key: 'department',
      header: 'Хэлтэс',
      render: (row) => <span className="text-slate-700">{row.department?.name ?? '-'}</span>,
    },
    {
      key: 'position',
      header: 'Албан тушаал',
      render: (row) => <span className="text-slate-700">{row.position?.name ?? '-'}</span>,
    },
    {
      key: 'team',
      header: 'Баг',
      render: (row) => <span className="text-slate-700">{row.team?.name ?? '-'}</span>,
    },
    {
      key: 'phone',
      header: 'Утас',
      render: (row) => <span className="whitespace-nowrap text-slate-700">{row.phone ?? '-'}</span>,
    },
    {
      key: 'email',
      header: 'Имэйл',
      render: (row) => <span className="text-slate-700">{row.email ?? '-'}</span>,
    },
    {
      key: 'type',
      header: 'Төрөл',
      render: (row) => (
        <span className="text-slate-700">
          {row.employeeType ? EMPLOYEE_TYPE_LABELS[row.employeeType] : '-'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Төлөв',
      render: (row) => <EmployeeStatusBadge status={row.status} />,
    },
    {
      key: 'systemAccess',
      header: 'Системийн эрх',
      render: (row) => (
        <span className="whitespace-nowrap text-slate-700">
          {row.hasSystemAccess ? 'Эрхтэй' : '-'}
        </span>
      ),
    },
    {
      key: 'startDate',
      header: 'Ажилд орсон',
      render: (row) => (
        <span className="whitespace-nowrap text-slate-700">
          {row.employmentStartDate
            ? new Date(row.employmentStartDate).toLocaleDateString('mn-MN', {
                timeZone: 'Asia/Ulaanbaatar',
              })
            : '-'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Үйлдэл',
      align: 'right',
      render: (row) => {
        const items: RowActionItem[] = [
          { label: 'Харах', to: `/employees/${row.id}` },
        ];
        if (can(PERMISSIONS.EMPLOYEE_UPDATE)) {
          items.push({ label: 'Засах', to: `/employees/${row.id}/edit` });
        }
        return <RowActions items={items} />;
      },
    },
  ];

  const columnState = useTableColumns('employees', columns);

  return (
    <>
      <PageHeader
        title="Ажилтан"
        breadcrumbs={[{ label: 'Нүүр', to: '/dashboard' }, { label: 'Ажилтан' }]}
        actions={
          can(PERMISSIONS.EMPLOYEE_CREATE) ? (
            <Button onClick={() => navigate('/employees/new')}>Шинэ ажилтан</Button>
          ) : null
        }
      />

      <div className={FILTER_BAR}>
        <div className="min-w-[220px] flex-1">
          <label htmlFor="employee-search" className={FILTER_LABEL}>
            Хайлт
          </label>
          <SearchField
            id="employee-search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') updateParam('search', searchDraft.trim());
            }}
            onBlur={() => updateParam('search', searchDraft.trim())}
            placeholder="Нэр, овог, код, регистр, имэйл, утас, IC карт"
          />
        </div>

        <div>
          <label htmlFor="employee-status" className={FILTER_LABEL}>
            Төлөв
          </label>
          <select
            id="employee-status"
            value={searchParams.get('status') ?? ''}
            onChange={(event) => updateParam('status', event.target.value)}
            className={FILTER_SELECT}
          >
            <option value="">Бүх төлөв</option>
            {EMPLOYEE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {EMPLOYEE_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="employee-type" className={FILTER_LABEL}>
            Ажилтны төрөл
          </label>
          <select
            id="employee-type"
            value={searchParams.get('employeeType') ?? ''}
            onChange={(event) => updateParam('employeeType', event.target.value)}
            className={FILTER_SELECT}
          >
            <option value="">Бүх төрөл</option>
            {EMPLOYEE_TYPES.map((type) => (
              <option key={type} value={type}>
                {EMPLOYEE_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            Шүүлтүүр цэвэрлэх
          </Button>
        )}
      </div>

      <div className="mb-2 flex justify-end">
        <ColumnPicker controller={columnState} />
      </div>

      <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <DataTable
          columns={columnState.visibleColumns}
          rows={data?.items ?? []}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          onRetry={() => void refetch()}
          emptyTitle="Ажилтан олдсонгүй"
          emptyDescription={
            hasFilters
              ? 'Шүүлтүүрт тохирох ажилтан алга. Шүүлтүүрээ өөрчилж үзнэ үү.'
              : 'Одоогоор бүртгэлтэй ажилтан байхгүй байна.'
          }
          onRowClick={(row) => navigate(`/employees/${row.id}`)}
        />
        {data && (
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            onPageChange={(page) => updateParam('page', String(page))}
          />
        )}
      </div>
    </>
  );
}
