import {
  PERMISSIONS,
  type CustomerDto,
  type PaginatedData,
  type ProjectDto,
  type ProjectListQuery,
} from '@monhorus/shared';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Button } from '../../components/ui/Button';
import { ColumnPicker } from '../../components/ui/ColumnPicker';
import { DataTable, Pagination, type Column } from '../../components/ui/DataTable';
import { PageHeader } from '../../components/ui/PageHeader';
import { SearchField } from '../../components/ui/SearchField';
import { FILTER_BAR, FILTER_LABEL, FILTER_SELECT } from '../../components/ui/control-styles';
import { useAuth } from '../../contexts/auth-context';
import { useTableColumns } from '../../hooks/use-table-columns';
import { ApiError } from '../../lib/api-client';
import { objectService } from '../../services/object.service';
import { projectService } from '../../services/project.service';
import { RiskSummaryCell } from './objects/ObjectBadges';

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' });
}

/** Archive state is shown rather than hidden, so an archived project stays findable. */
export function ActiveBadge({ isActive }: { isActive: boolean }): ReactElement {
  return isActive ? (
    <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-200">
      Идэвхтэй
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
      Архивласан
    </span>
  );
}

export function ProjectListPage(): ReactElement {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const canManage = can(PERMISSIONS.OBJECT_MANAGE);

  const query = useMemo<ProjectListQuery>(() => {
    const page = Number.parseInt(searchParams.get('page') ?? '1', 10);
    return {
      page: Number.isFinite(page) && page > 0 ? page : 1,
      limit: 20,
      ...(searchParams.get('search') ? { search: searchParams.get('search')! } : {}),
      ...(searchParams.get('customerId') ? { customerId: searchParams.get('customerId')! } : {}),
      ...(searchParams.get('isActive') ? { isActive: searchParams.get('isActive') === 'true' } : {}),
      sortBy: 'name',
      sortDir: 'asc',
    };
  }, [searchParams]);

  const [data, setData] = useState<PaginatedData<ProjectDto> | null>(null);
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
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
      const result = await projectService.listProjects(JSON.parse(queryKey) as ProjectListQuery);
      if (requestId !== requestIdRef.current) return;
      setData(result);
    } catch (caught) {
      if (requestId !== requestIdRef.current) return;
      setError(caught instanceof ApiError ? caught.message : 'Төсөл ачаалж чадсангүй.');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [queryKey]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    objectService
      .customers()
      .then((result) => {
        if (!cancelled) setCustomers(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  function updateParam(key: string, value: string): void {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setSearchParams(next);
  }

  const hasFilters = ['search', 'customerId', 'isActive'].some((key) => searchParams.get(key));

  const columns: ReadonlyArray<Column<ProjectDto>> = [
    {
      key: 'name',
      header: 'Төслийн нэр',
      render: (row) => <span className="truncate font-medium text-slate-900">{row.name}</span>,
    },
    {
      key: 'code',
      header: 'Код',
      render: (row) => <span className="whitespace-nowrap text-slate-600">{row.code}</span>,
    },
    {
      key: 'customer',
      header: 'Байгууллага',
      render: (row) => <span className="text-slate-700">{row.customerName ?? '-'}</span>,
    },
    {
      key: 'contract',
      header: 'Гэрээний №',
      render: (row) => <span className="text-slate-700">{row.contractNumber ?? '-'}</span>,
    },
    {
      key: 'period',
      header: 'Эхлэх - Дуусах',
      render: (row) => (
        <span className="whitespace-nowrap text-slate-700">
          {formatDate(row.startDate)} - {formatDate(row.endDate)}
        </span>
      ),
    },
    {
      key: 'buildings',
      header: 'Барилга',
      align: 'right',
      render: (row) => <span className="text-slate-700">{row.buildingCount}</span>,
    },
    {
      key: 'floors',
      header: 'Давхар',
      align: 'right',
      render: (row) => <span className="text-slate-700">{row.floorCount}</span>,
    },
    {
      key: 'objects',
      header: 'Объект',
      align: 'right',
      render: (row) => <span className="text-slate-700">{row.objectCount}</span>,
    },
    {
      key: 'risk',
      header: 'Үнэлгээ',
      render: (row) => <RiskSummaryCell summary={row.riskSummary} />,
    },
    { key: 'status', header: 'Төлөв', render: (row) => <ActiveBadge isActive={row.isActive} /> },
  ];

  const columnState = useTableColumns('projects', columns);

  return (
    <>
      <PageHeader
        title="Төсөл"
        breadcrumbs={[{ label: 'Нүүр', to: '/dashboard' }, { label: 'Төсөл' }]}
        actions={canManage && <Button onClick={() => navigate('/projects/new')}>Шинэ төсөл</Button>}
      />

      <div className={FILTER_BAR}>
        <div className="min-w-[200px] flex-1">
          <label htmlFor="prj-search" className={FILTER_LABEL}>
            Хайлт
          </label>
          <SearchField
            id="prj-search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') updateParam('search', searchDraft.trim());
            }}
            onBlur={() => updateParam('search', searchDraft.trim())}
            placeholder="Нэр эсвэл код"
          />
        </div>

        <div>
          <label htmlFor="prj-customer" className={FILTER_LABEL}>
            Байгууллага
          </label>
          <select
            id="prj-customer"
            value={searchParams.get('customerId') ?? ''}
            onChange={(event) => updateParam('customerId', event.target.value)}
            className={FILTER_SELECT}
          >
            <option value="">Бүгд</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="prj-active" className={FILTER_LABEL}>
            Төлөв
          </label>
          <select
            id="prj-active"
            value={searchParams.get('isActive') ?? ''}
            onChange={(event) => updateParam('isActive', event.target.value)}
            className={FILTER_SELECT}
          >
            <option value="">Бүгд</option>
            <option value="true">Идэвхтэй</option>
            <option value="false">Архивласан</option>
          </select>
        </div>

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
          loading={loading}
          error={error}
          onRetry={() => void load()}
          onRowClick={(row) => navigate(`/projects/${row.id}`)}
          emptyTitle="Төсөл олдсонгүй"
          emptyDescription={
            hasFilters ? 'Шүүлтүүрт тохирох төсөл алга.' : 'Эхлээд төсөл бүртгэнэ үү.'
          }
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
