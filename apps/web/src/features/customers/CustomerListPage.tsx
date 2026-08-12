import { PERMISSIONS, type CustomerDto, type PaginatedData } from '@monhorus/shared';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Button } from '../../components/ui/Button';
import { ColumnPicker } from '../../components/ui/ColumnPicker';
import { DataTable, Pagination, type Column } from '../../components/ui/DataTable';
import { PageHeader } from '../../components/ui/PageHeader';
import { RowActions, type RowActionItem } from '../../components/ui/RowActions';
import { SearchField } from '../../components/ui/SearchField';
import { FILTER_BAR, FILTER_LABEL, FILTER_SELECT } from '../../components/ui/control-styles';
import { useAuth } from '../../contexts/auth-context';
import { useTableColumns } from '../../hooks/use-table-columns';
import { ApiError } from '../../lib/api-client';
import { objectService, type CustomerListQuery } from '../../services/object.service';

export function CustomerListPage(): ReactElement {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const query = useMemo<CustomerListQuery>(() => {
    const page = Number.parseInt(searchParams.get('page') ?? '1', 10);
    const search = searchParams.get('search');
    const isActive = searchParams.get('isActive');
    const hasAgreement = searchParams.get('hasActiveAgreement');
    const sortBy = searchParams.get('sortBy');
    const sortDir = searchParams.get('sortDir');

    return {
      page: Number.isFinite(page) && page > 0 ? page : 1,
      limit: 20,
      ...(search ? { search } : {}),
      ...(isActive ? { isActive: isActive === 'true' } : {}),
      ...(hasAgreement ? { hasActiveAgreement: hasAgreement === 'true' } : {}),
      sortBy: (sortBy as CustomerListQuery['sortBy']) ?? 'name',
      sortDir: (sortDir as CustomerListQuery['sortDir']) ?? 'asc',
    };
  }, [searchParams]);

  const [data, setData] = useState<PaginatedData<CustomerDto> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState(() => searchParams.get('search') ?? '');

  const requestIdRef = useRef(0);
  const queryKey = JSON.stringify(query);

  const load = useCallback(async (): Promise<void> => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await objectService.listCustomers(JSON.parse(queryKey) as CustomerListQuery);
      if (requestId !== requestIdRef.current) return;
      setData(result);
    } catch (caught) {
      if (requestId !== requestIdRef.current) return;
      setError(caught instanceof ApiError ? caught.message : 'Харилцагч ачаалж чадсангүй.');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [queryKey]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateParam(key: string, value: string): void {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setSearchParams(next);
  }

  function toggleSort(field: NonNullable<CustomerListQuery['sortBy']>): void {
    const next = new URLSearchParams(searchParams);
    const currentDir = searchParams.get('sortDir') ?? 'asc';
    next.set('sortBy', field);
    next.set('sortDir', searchParams.get('sortBy') === field && currentDir === 'asc' ? 'desc' : 'asc');
    next.delete('page');
    setSearchParams(next);
  }

  const hasFilters = ['search', 'isActive', 'hasActiveAgreement'].some((key) =>
    searchParams.get(key),
  );

  const sortIndicator = (field: string): string =>
    searchParams.get('sortBy') === field
      ? (searchParams.get('sortDir') ?? 'asc') === 'asc'
        ? ' ↑'
        : ' ↓'
      : '';

  const columns: ReadonlyArray<Column<CustomerDto>> = [
    {
      key: 'name',
      header: `Байгууллага${sortIndicator('name')}`,
      render: (row) => <span className="truncate font-medium text-slate-900">{row.name}</span>,
    },
    {
      key: 'code',
      header: 'Код',
      render: (row) => <span className="whitespace-nowrap text-slate-600">{row.code}</span>,
    },
    {
      key: 'registrationNumber',
      header: 'РД',
      render: (row) => (
        <span className="whitespace-nowrap text-slate-700">{row.registrationNumber ?? '-'}</span>
      ),
    },
    {
      key: 'taxNumber',
      header: 'ТТД',
      render: (row) => (
        <span className="whitespace-nowrap text-slate-700">{row.taxNumber ?? '-'}</span>
      ),
    },
    {
      key: 'contactPerson',
      header: 'Холбоо барих хүн',
      render: (row) => <span className="text-slate-700">{row.contactPerson ?? '-'}</span>,
    },
    {
      key: 'phone',
      header: 'Утас',
      render: (row) => (
        <span className="whitespace-nowrap text-slate-700">{row.phone ?? '-'}</span>
      ),
    },
    {
      key: 'email',
      header: 'Имэйл',
      render: (row) => <span className="text-slate-700">{row.email ?? '-'}</span>,
    },
    {
      key: 'responsible',
      header: 'Хариуцсан ажилтан',
      render: (row) => (
        <span className="text-slate-700">{row.responsibleEmployeeName ?? '-'}</span>
      ),
    },
    {
      key: 'projects',
      header: 'Төсөл',
      align: 'right',
      render: (row) => <span className="text-slate-700">{row.projectCount ?? 0}</span>,
    },
    {
      key: 'buildings',
      header: 'Барилга',
      align: 'right',
      render: (row) => <span className="text-slate-700">{row.buildingCount ?? 0}</span>,
    },
    {
      key: 'agreement',
      header: 'Үйлчилгээний нөхцөл',
      align: 'center',
      render: (row) =>
        (row.activeAgreementCount ?? 0) > 0 ? (
          <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-200">
            {row.activeAgreementCount} идэвхтэй
          </span>
        ) : (
          <span className="text-xs text-slate-400">Байхгүй</span>
        ),
    },
    {
      key: 'status',
      header: 'Төлөв',
      render: (row) =>
        row.isActive ? (
          <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-200">
            Идэвхтэй
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
            Идэвхгүй
          </span>
        ),
    },
    {
      key: 'actions',
      header: 'Үйлдэл',
      align: 'right',
      render: (row) => {
        const items: RowActionItem[] = [
          { label: 'Харах', to: `/customers/${row.id}` },
        ];
        if (can(PERMISSIONS.CUSTOMER_MANAGE)) {
          items.push({ label: 'Засах', to: `/customers/${row.id}/edit` });
        }
        return <RowActions items={items} />;
      },
    },
  ];

  const columnState = useTableColumns('customers', columns);

  return (
    <>
      <PageHeader
        title="Харилцагч"
        breadcrumbs={[{ label: 'Нүүр', to: '/dashboard' }, { label: 'Харилцагч' }]}
        actions={
          can(PERMISSIONS.CUSTOMER_MANAGE) ? (
            <Button onClick={() => navigate('/customers/new')}>Шинэ харилцагч</Button>
          ) : null
        }
      />

      <div className={FILTER_BAR}>
        <div className="min-w-[220px] flex-1">
          <label htmlFor="customer-search" className={FILTER_LABEL}>
            Хайлт
          </label>
          <SearchField
            id="customer-search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') updateParam('search', searchDraft.trim());
            }}
            onBlur={() => updateParam('search', searchDraft.trim())}
            placeholder="Нэр, код, РД, ТТД, утас, имэйл, хаяг"
          />
        </div>

        <div>
          <label htmlFor="customer-active" className={FILTER_LABEL}>
            Төлөв
          </label>
          <select
            id="customer-active"
            value={searchParams.get('isActive') ?? ''}
            onChange={(event) => updateParam('isActive', event.target.value)}
            className={FILTER_SELECT}
          >
            <option value="">Бүгд</option>
            <option value="true">Идэвхтэй</option>
            <option value="false">Идэвхгүй</option>
          </select>
        </div>

        <div>
          <label htmlFor="customer-agreement" className={FILTER_LABEL}>
            Үйлчилгээний нөхцөл
          </label>
          <select
            id="customer-agreement"
            value={searchParams.get('hasActiveAgreement') ?? ''}
            onChange={(event) => updateParam('hasActiveAgreement', event.target.value)}
            className={FILTER_SELECT}
          >
            <option value="">Бүгд</option>
            <option value="true">Идэвхтэй нөхцөлтэй</option>
            <option value="false">Нөхцөлгүй</option>
          </select>
        </div>

        <Button variant="ghost" size="sm" onClick={() => toggleSort('name')}>
          Нэрээр эрэмбэлэх
        </Button>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={() => setSearchParams(new URLSearchParams())}>
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
          // Numbered off the response rather than the query, so a request in flight can
          // never number the rows on screen against the page they did not come from.
          numbering={{ page: data?.page ?? 1, limit: data?.limit ?? 20 }}
          loading={loading}
          error={error}
          onRetry={() => void load()}
          emptyTitle="Харилцагч олдсонгүй"
          emptyDescription={
            hasFilters
              ? 'Шүүлтүүрт тохирох харилцагч алга.'
              : 'Одоогоор бүртгэлтэй харилцагч байхгүй байна.'
          }
          onRowClick={(row) => navigate(`/customers/${row.id}`)}
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
