import {
  PLANNED_WORK_EFFECTIVE_STATUSES,
  PLANNED_WORK_STATUS_LABELS,
  type PaginatedData,
  type PlannedWorkEffectiveStatus,
  type PlannedWorkListItemDto,
} from '@monhorus/shared';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';

import { ColumnPicker } from '../../components/ui/ColumnPicker';
import { DataTable, Pagination, type Column } from '../../components/ui/DataTable';
import { SearchField } from '../../components/ui/SearchField';
import { FILTER_LABEL, FILTER_SEARCH_SLOT, FILTER_SELECT } from '../../components/ui/control-styles';
import { useTableColumns } from '../../hooks/use-table-columns';
import { ApiError } from '../../lib/api-client';
import { plannedWorkService } from '../../services/planned-work.service';

const PAGE_SIZE = 20;

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' });
}

/** Quantity-weighted progress, coloured by how far along it is. */
function ProgressCell({ percent }: { percent: number }): ReactElement {
  const tone = percent >= 100 ? 'bg-green-600' : percent >= 50 ? 'bg-blue-600' : 'bg-amber-500';
  return (
    <div className="min-w-[110px]">
      <div className="mb-1 text-xs font-medium tabular-nums text-slate-900">{percent}%</div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full rounded-full ${tone}`}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
    </div>
  );
}

/** The customer's planned works and how far each has got. */
export function CustomerPlannedWorkTab({ customerId }: { customerId: string }): ReactElement {
  const navigate = useNavigate();

  // Paging and filtering live in component state, NOT in the URL as they do on
  // CustomerListPage. This is a tab inside CustomerDetailPage, which already owns the query
  // string for tab selection; three sibling tabs each writing `page`/`search` there would
  // overwrite one another and collide with the parent's `tab` param.
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [status, setStatus] = useState<PlannedWorkEffectiveStatus | ''>('');

  const [data, setData] = useState<PaginatedData<PlannedWorkListItemDto> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requestIdRef = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      // Search and status go to the server: only the current page is ever in hand here,
      // so filtering client-side would filter one page out of many.
      const result = await plannedWorkService.list({
        customerId,
        page,
        limit: PAGE_SIZE,
        ...(search ? { search } : {}),
        ...(status ? { status } : {}),
      });
      if (requestId !== requestIdRef.current) return;
      setData(result);
    } catch (caught) {
      if (requestId !== requestIdRef.current) return;
      setError(caught instanceof ApiError ? caught.message : 'Төлөвлөгөөт ажил ачаалж чадсангүй.');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [customerId, page, search, status]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Any narrowing returns to page 1; page 4 of the old result is empty under the new one. */
  function commitSearch(value: string): void {
    setSearch(value);
    setPage(1);
  }

  const rows = data?.items ?? [];
  const hasFilters = search !== '' || status !== '';

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
      key: 'project',
      header: 'Төсөл',
      render: (row) => <span className="text-slate-700">{row.project?.name ?? '-'}</span>,
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
      key: 'progress',
      header: 'Гүйцэтгэл',
      render: (row) => <ProgressCell percent={row.progressPercent} />,
    },
    {
      key: 'status',
      header: 'Төлөв',
      render: (row) => (
        <span
          className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
            row.effectiveStatus === 'OVERDUE'
              ? 'bg-red-50 text-red-700 ring-red-200'
              : row.effectiveStatus === 'COMPLETED'
                ? 'bg-green-50 text-green-700 ring-green-200'
                : 'bg-slate-100 text-slate-600 ring-slate-200'
          }`}
        >
          {PLANNED_WORK_STATUS_LABELS[row.effectiveStatus]}
        </span>
      ),
    },
  ];

  const columnState = useTableColumns('customer-planned-work', columns);

  return (
    <div className="space-y-2">
      {/* The controls are CustomerListPage's, but without its FILTER_BAR card: this tab
          already sits inside CustomerDetailPage's white card and a second one would nest. */}
      <div className="flex flex-wrap items-end gap-3">
        <div className={FILTER_SEARCH_SLOT}>
          <label htmlFor="customer-planned-work-search" className={FILTER_LABEL}>
            Хайлт
          </label>
          <SearchField
            id="customer-planned-work-search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitSearch(searchDraft.trim());
            }}
            onBlur={() => commitSearch(searchDraft.trim())}
            placeholder="Ажлын нэр, дугаар"
          />
        </div>

        <div>
          <label htmlFor="customer-planned-work-status" className={FILTER_LABEL}>
            Төлөв
          </label>
          <select
            id="customer-planned-work-status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as PlannedWorkEffectiveStatus | '');
              setPage(1);
            }}
            className={FILTER_SELECT}
          >
            <option value="">Бүх төлөв</option>
            {PLANNED_WORK_EFFECTIVE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {PLANNED_WORK_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <div className="ml-auto">
          <ColumnPicker controller={columnState} />
        </div>
      </div>

      {/* Already inside CustomerDetailPage's white card, so this takes the ring-only
          treatment the sibling tabs use rather than nesting a second white card. */}
      <div className="overflow-hidden rounded-lg ring-1 ring-slate-200">
        <DataTable
          columns={columnState.visibleColumns}
          rows={rows}
          rowKey={(row) => row.id}
          // Numbered off the response rather than the query, so a request in flight can
          // never number the rows on screen against the page they did not come from.
          numbering={{ page: data?.page ?? 1, limit: data?.limit ?? PAGE_SIZE }}
          loading={loading}
          error={error}
          onRetry={() => void load()}
          onRowClick={(row) => navigate(`/planned-work/${row.id}`)}
          emptyTitle="Төлөвлөгөөт ажил алга"
          emptyDescription={
            hasFilters
              ? 'Шүүлтүүрт тохирох төлөвлөгөөт ажил алга.'
              : 'Энэ харилцагчид төлөвлөгөөт ажил бүртгэгдээгүй байна.'
          }
        />
        {data && (
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            onPageChange={setPage}
          />
        )}
      </div>
    </div>
  );
}
