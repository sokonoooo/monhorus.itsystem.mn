import {
  PERMISSIONS,
  PLANNED_WORK_EFFECTIVE_STATUSES,
  PLANNED_WORK_REPORT_STATUSES,
  PLANNED_WORK_REPORT_STATUS_LABELS,
  PLANNED_WORK_STATUS_LABELS,
  type PaginatedData,
  type PlannedWorkEffectiveStatus,
  type PlannedWorkListItemDto,
  type PlannedWorkListQuery,
  type PlannedWorkReportStatus,
} from '@monhorus/shared';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Button } from '../../components/ui/Button';
import { ColumnPicker } from '../../components/ui/ColumnPicker';
import { DataTable, Pagination, type Column } from '../../components/ui/DataTable';
import { PageHeader } from '../../components/ui/PageHeader';
import { SearchField } from '../../components/ui/SearchField';
import {
  FILTER_BAR,
  FILTER_INPUT,
  FILTER_LABEL,
  FILTER_SELECT,
} from '../../components/ui/control-styles';
import { useAuth } from '../../contexts/auth-context';
import { useTableColumns } from '../../hooks/use-table-columns';
import { ApiError } from '../../lib/api-client';
import { plannedWorkService } from '../../services/planned-work.service';
import {
  LateBadge,
  PlannedWorkStatusBadge,
  ProgressBar,
  ReportStatusBadge,
} from './PlannedWorkBadges';

/** Asia/Ulaanbaatar display of a UTC timestamp. */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' });
}

export function PlannedWorkListPage(): ReactElement {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const canCreate = can(PERMISSIONS.PLANNED_WORK_CREATE);

  const query = useMemo<PlannedWorkListQuery>(() => {
    const page = Number.parseInt(searchParams.get('page') ?? '1', 10);
    return {
      page: Number.isFinite(page) && page > 0 ? page : 1,
      limit: 20,
      ...(searchParams.get('search') ? { search: searchParams.get('search')! } : {}),
      ...(searchParams.get('status')
        ? { status: searchParams.get('status') as PlannedWorkEffectiveStatus }
        : {}),
      ...(searchParams.get('reportStatus')
        ? { reportStatus: searchParams.get('reportStatus') as PlannedWorkReportStatus }
        : {}),
      ...(searchParams.get('from') ? { from: searchParams.get('from')! } : {}),
      ...(searchParams.get('to') ? { to: searchParams.get('to')! } : {}),
      sortBy: 'plannedStartDate',
      sortDir: 'desc',
    };
  }, [searchParams]);

  const [data, setData] = useState<PaginatedData<PlannedWorkListItemDto> | null>(null);
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
      const result = await plannedWorkService.list(
        JSON.parse(queryKey) as PlannedWorkListQuery,
      );
      if (requestId !== requestIdRef.current) return;
      setData(result);
    } catch (caught) {
      if (requestId !== requestIdRef.current) return;
      setError(
        caught instanceof ApiError ? caught.message : 'Төлөвлөгөөт ажил ачаалж чадсангүй.',
      );
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

  const hasFilters = ['search', 'status', 'reportStatus', 'from', 'to'].some((key) =>
    searchParams.get(key),
  );

  const columns: ReadonlyArray<Column<PlannedWorkListItemDto>> = [
    {
      key: 'work',
      header: 'Ажил',
      render: (row) => <span className="truncate font-medium text-slate-900">{row.title}</span>,
    },
    {
      key: 'workNumber',
      header: 'Ажлын №',
      render: (row) => <span className="whitespace-nowrap text-slate-600">{row.workNumber}</span>,
    },
    {
      key: 'building',
      header: 'Барилга',
      render: (row) => <span className="text-slate-700">{row.building.name}</span>,
    },
    {
      key: 'customer',
      header: 'Харилцагч',
      render: (row) => <span className="text-slate-700">{row.customer.name}</span>,
    },
    {
      key: 'plannedStart',
      header: 'Эхлэх',
      render: (row) => (
        <span className="whitespace-nowrap text-slate-700">{formatDate(row.plannedStartDate)}</span>
      ),
    },
    {
      key: 'plannedEnd',
      header: 'Дуусах',
      render: (row) => (
        <span className="whitespace-nowrap text-slate-700">{formatDate(row.plannedEndDate)}</span>
      ),
    },
    {
      key: 'status',
      header: 'Төлөв',
      // The effective status is authoritative and already accounts for OVERDUE.
      render: (row) => <PlannedWorkStatusBadge status={row.effectiveStatus} />,
    },
    {
      key: 'late',
      header: 'Хоцролт',
      render: (row) =>
        row.completedLate ? <LateBadge delayMinutes={row.delayMinutes} /> : <span>-</span>,
    },
    {
      key: 'progress',
      header: 'Биелэлт',
      render: (row) => (
        <ProgressBar
          percent={row.progressPercent}
          completedQuantity={row.completedQuantity}
          totalQuantity={row.totalQuantity}
        />
      ),
    },
    {
      key: 'report',
      header: 'Тайлан',
      render: (row) =>
        row.reportStatus ? <ReportStatusBadge status={row.reportStatus} /> : <span>-</span>,
    },
    {
      key: 'assigned',
      header: 'Хариуцагч',
      render: (row) => (
        <span className="text-slate-700">
          {row.assignedEmployees.length > 0
            ? row.assignedEmployees.map((employee) => employee.name).join(', ')
            : '-'}
        </span>
      ),
    },
    {
      key: 'team',
      header: 'Баг',
      render: (row) => <span className="text-slate-700">{row.assignedTeam?.name ?? '-'}</span>,
    },
  ];

  const columnState = useTableColumns('planned-work', columns);

  return (
    <>
      <PageHeader
        title="Төлөвлөгөөт ажил"
        breadcrumbs={[{ label: 'Нүүр', to: '/dashboard' }, { label: 'Төлөвлөгөөт ажил' }]}
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate('/calendar')}>
              Calendar
            </Button>
            {canCreate && (
              <Button onClick={() => navigate('/planned-work/new')}>Шинэ ажил</Button>
            )}
          </>
        }
      />

      <div className={FILTER_BAR}>
        <div className="min-w-[200px] flex-1">
          <label htmlFor="pw-search" className={FILTER_LABEL}>
            Хайлт
          </label>
          <SearchField
            id="pw-search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') updateParam('search', searchDraft.trim());
            }}
            onBlur={() => updateParam('search', searchDraft.trim())}
            placeholder="Ажлын дугаар эсвэл нэр"
          />
        </div>

        <div>
          <label htmlFor="pw-status" className={FILTER_LABEL}>
            Төлөв
          </label>
          <select
            id="pw-status"
            value={searchParams.get('status') ?? ''}
            onChange={(event) => updateParam('status', event.target.value)}
            className={FILTER_SELECT}
          >
            <option value="">Бүх төлөв</option>
            {PLANNED_WORK_EFFECTIVE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {PLANNED_WORK_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="pw-report" className={FILTER_LABEL}>
            Тайлангийн төлөв
          </label>
          <select
            id="pw-report"
            value={searchParams.get('reportStatus') ?? ''}
            onChange={(event) => updateParam('reportStatus', event.target.value)}
            className={FILTER_SELECT}
          >
            <option value="">Бүгд</option>
            {PLANNED_WORK_REPORT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {PLANNED_WORK_REPORT_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="pw-from" className={FILTER_LABEL}>
            Эхлэх
          </label>
          <input
            id="pw-from"
            type="date"
            value={searchParams.get('from') ?? ''}
            onChange={(event) => updateParam('from', event.target.value)}
            className={FILTER_INPUT}
          />
        </div>

        <div>
          <label htmlFor="pw-to" className={FILTER_LABEL}>
            Дуусах
          </label>
          <input
            id="pw-to"
            type="date"
            value={searchParams.get('to') ?? ''}
            onChange={(event) => updateParam('to', event.target.value)}
            className={FILTER_INPUT}
          />
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
          onRowClick={(row) => navigate(`/planned-work/${row.id}`)}
          emptyTitle="Төлөвлөгөөт ажил олдсонгүй"
          emptyDescription={
            hasFilters
              ? 'Шүүлтүүрт тохирох ажил алга.'
              : 'Одоогоор бүртгэлтэй төлөвлөгөөт ажил байхгүй байна.'
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
