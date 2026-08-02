import {
  OBJECT_CATEGORIES,
  OBJECT_CATEGORY_LABELS,
  OBJECT_STATUSES,
  OBJECT_STATUS_LABELS,
  PERMISSIONS,
  RISK_LEVELS,
  RISK_LEVEL_LABELS,
  type CustomerDto,
  type ObjectCategory,
  type ObjectListItemDto,
  type ObjectListQuery,
  type ObjectStatus,
  type PaginatedData,
  type RiskLevel,
} from '@monhorus/shared';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Button } from '../../components/ui/Button';
import { DataTable, Pagination, type Column } from '../../components/ui/DataTable';
import { RiskBadge } from '../../components/ui/DomainBadges';
import { PageHeader } from '../../components/ui/PageHeader';
import { useAuth } from '../../contexts/auth-context';
import { ApiError } from '../../lib/api-client';
import { objectMasterService } from '../../services/object-master.service';
import { objectService } from '../../services/object.service';
import { LoadValue, ObjectCategoryBadge, ObjectStatusBadge, VarianceValue } from './ObjectBadges';

/**
 * Object master list.
 *
 * Objects live here, not inside a floor. The floor screen links to these records and never
 * creates one, which is why this page is reachable on its own and carries the create
 * action.
 */
export function ObjectListPage(): ReactElement {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const canManage = can(PERMISSIONS.OBJECT_MASTER_MANAGE);

  const query = useMemo<ObjectListQuery>(() => {
    const page = Number.parseInt(searchParams.get('page') ?? '1', 10);
    return {
      page: Number.isFinite(page) && page > 0 ? page : 1,
      limit: 20,
      ...(searchParams.get('search') ? { search: searchParams.get('search')! } : {}),
      ...(searchParams.get('customerId') ? { customerId: searchParams.get('customerId')! } : {}),
      ...(searchParams.get('category')
        ? { category: searchParams.get('category') as ObjectCategory }
        : {}),
      ...(searchParams.get('status')
        ? { status: searchParams.get('status') as ObjectStatus }
        : {}),
      ...(searchParams.get('riskLevel')
        ? { riskLevel: searchParams.get('riskLevel') as RiskLevel }
        : {}),
      ...(searchParams.get('unlinkedOnly') === 'true' ? { unlinkedOnly: true } : {}),
      sortBy: 'code',
      sortDir: 'asc',
    };
  }, [searchParams]);

  const [data, setData] = useState<PaginatedData<ObjectListItemDto> | null>(null);
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
      const result = await objectMasterService.list(JSON.parse(queryKey) as ObjectListQuery);
      if (requestId !== requestIdRef.current) return;
      setData(result);
    } catch (caught) {
      if (requestId !== requestIdRef.current) return;
      setError(caught instanceof ApiError ? caught.message : 'Объект ачаалж чадсангүй.');
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

  const hasFilters = ['search', 'customerId', 'category', 'status', 'riskLevel', 'unlinkedOnly'].some(
    (key) => searchParams.get(key),
  );

  const columns: ReadonlyArray<Column<ObjectListItemDto>> = [
    {
      key: 'object',
      header: 'Объект',
      render: (row) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-slate-900">{row.name}</div>
          <div className="truncate text-xs text-slate-500">
            {row.code}
            {row.objectType ? ` · ${row.objectType.name}` : ''}
          </div>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Ангилал',
      render: (row) => <ObjectCategoryBadge category={row.category} />,
    },
    {
      key: 'location',
      header: 'Байршил',
      render: (row) => (
        <div className="min-w-0 text-slate-700">
          <div className="truncate">{row.floorName ?? 'Давхарт холбогдоогүй'}</div>
          <div className="truncate text-xs text-slate-500">
            {row.buildingName ?? row.customerName ?? ''}
          </div>
        </div>
      ),
    },
    {
      key: 'load',
      header: 'Тооцоолсон ачаалал',
      align: 'right',
      render: (row) => <LoadValue value={row.calculatedLoad} />,
    },
    {
      key: 'measured',
      header: 'Хэмжсэн',
      align: 'right',
      render: (row) => (
        <span className="whitespace-nowrap text-slate-700">
          {row.measuredLoadKw === null ? '-' : `${row.measuredLoadKw} kW`}
        </span>
      ),
    },
    {
      key: 'variance',
      header: 'Зөрүү',
      align: 'right',
      render: (row) => <VarianceValue value={row.loadVariance} />,
    },
    {
      key: 'risk',
      header: 'Сүүлийн үнэлгээ',
      render: (row) =>
        row.latestAssessment ? (
          <RiskBadge level={row.latestAssessment.riskLevel} score={row.latestAssessment.score} />
        ) : (
          <span className="text-xs text-slate-400">Үнэлгээгүй</span>
        ),
    },
    {
      key: 'status',
      header: 'Төлөв',
      render: (row) => <ObjectStatusBadge status={row.status} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="Объектын бүртгэл"
        description="Самбар, хэлхээ, тоноглолын мастер бүртгэл. Давхар эдгээрээс сонгож холбоно."
        breadcrumbs={[{ label: 'Нүүр', to: '/dashboard' }, { label: 'Объектын бүртгэл' }]}
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate('/object-types')}>
              Тоноглолын төрөл
            </Button>
            {canManage && (
              <Button onClick={() => navigate('/objects-master/new')}>Шинэ объект</Button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
        <div className="min-w-[180px] flex-1">
          <label htmlFor="obj-search" className="mb-1 block text-xs font-medium text-slate-600">
            Хайлт
          </label>
          <input
            id="obj-search"
            type="search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') updateParam('search', searchDraft.trim());
            }}
            onBlur={() => updateParam('search', searchDraft.trim())}
            placeholder="Нэр эсвэл код"
            className="block w-full rounded-lg border-0 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-blue-600"
          />
        </div>

        <div>
          <label htmlFor="obj-customer" className="mb-1 block text-xs font-medium text-slate-600">
            Харилцагч
          </label>
          <select
            id="obj-customer"
            value={searchParams.get('customerId') ?? ''}
            onChange={(event) => updateParam('customerId', event.target.value)}
            className="rounded-lg border-0 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-blue-600"
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
          <label htmlFor="obj-category" className="mb-1 block text-xs font-medium text-slate-600">
            Ангилал
          </label>
          <select
            id="obj-category"
            value={searchParams.get('category') ?? ''}
            onChange={(event) => updateParam('category', event.target.value)}
            className="rounded-lg border-0 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-blue-600"
          >
            <option value="">Бүгд</option>
            {OBJECT_CATEGORIES.map((entry) => (
              <option key={entry} value={entry}>
                {OBJECT_CATEGORY_LABELS[entry]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="obj-status" className="mb-1 block text-xs font-medium text-slate-600">
            Төлөв
          </label>
          <select
            id="obj-status"
            value={searchParams.get('status') ?? ''}
            onChange={(event) => updateParam('status', event.target.value)}
            className="rounded-lg border-0 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-blue-600"
          >
            <option value="">Бүгд</option>
            {OBJECT_STATUSES.map((entry) => (
              <option key={entry} value={entry}>
                {OBJECT_STATUS_LABELS[entry]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="obj-risk" className="mb-1 block text-xs font-medium text-slate-600">
            Эрсдэл
          </label>
          <select
            id="obj-risk"
            value={searchParams.get('riskLevel') ?? ''}
            onChange={(event) => updateParam('riskLevel', event.target.value)}
            className="rounded-lg border-0 px-3 py-2 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-blue-600"
          >
            <option value="">Бүгд</option>
            {RISK_LEVELS.map((entry) => (
              <option key={entry} value={entry}>
                {RISK_LEVEL_LABELS[entry]}
              </option>
            ))}
          </select>
        </div>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={() => setSearchParams(new URLSearchParams())}>
            Шүүлтүүр цэвэрлэх
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          onRetry={() => void load()}
          onRowClick={(row) => navigate(`/objects-master/${row.id}`)}
          emptyTitle="Объект олдсонгүй"
          emptyDescription={
            hasFilters
              ? 'Шүүлтүүрт тохирох объект алга.'
              : 'Самбар, хэлхээ, тоноглолыг энд бүртгэнэ.'
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
