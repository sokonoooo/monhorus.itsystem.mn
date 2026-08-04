import {
  REPORT_SOURCE_TYPES,
  REPORT_SOURCE_TYPE_LABELS,
  REPORT_STATUSES,
  REPORT_STATUS_LABELS,
  REPORT_TYPES,
  REPORT_TYPE_LABELS,
  RISK_LEVELS,
  RISK_LEVEL_LABELS,
  type CustomerDto,
  type InspectionListItemDto,
  type InspectionListQuery,
  type InspectionSummaryDto,
  type PaginatedData,
  type ProjectDto,
  type ReportType,
  type RiskLevel,
} from '@monhorus/shared';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

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
import { useTableColumns } from '../../hooks/use-table-columns';
import { ApiError } from '../../lib/api-client';
import { objectService } from '../../services/object.service';
import { projectService } from '../../services/project.service';
import { useRiskBands } from '../../hooks/use-risk-bands';
import { inspectionService } from '../../services/report.service';
import { RiskLegend, ScoreBar } from '../projects/objects/ObjectBadges';

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' });
}

const BAND_TONES: Record<RiskLevel, string> = {
  NORMAL: 'text-green-700',
  ATTENTION: 'text-amber-700',
  SCHEDULE_REPAIR: 'text-orange-700',
  CRITICAL: 'text-red-700',
  OUT_OF_SERVICE: 'text-stone-800',
};

function CountCard({
  label,
  value,
  tone = 'text-slate-900',
}: {
  label: string;
  value: number;
  tone?: string;
}): ReactElement {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${tone}`}>
        {value.toLocaleString('mn-MN')}
      </div>
    </div>
  );
}

/**
 * Consolidated device conclusion report (Нэгдсэн төхөөрөмжийн тайлан).
 *
 * A cross-cutting read over the append-only assessment history: one row per conclusion,
 * filterable across every project, building and floor. There is no approval workflow here
 * because an assessment is immutable once written (requirements 10.1, rule 17.15), so a
 * row on this screen is a settled fact rather than a draft awaiting sign-off.
 *
 * Counts are per band and per object, never a single rolled-up score: section 19.2 leaves
 * the aggregation method unapproved.
 */
export function InspectionListPage(): ReactElement {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const query = useMemo<InspectionListQuery>(() => {
    const page = Number.parseInt(searchParams.get('page') ?? '1', 10);
    return {
      page: Number.isFinite(page) && page > 0 ? page : 1,
      limit: 25,
      ...(searchParams.get('search') ? { search: searchParams.get('search')! } : {}),
      ...(searchParams.get('customerId') ? { customerId: searchParams.get('customerId')! } : {}),
      ...(searchParams.get('projectId') ? { projectId: searchParams.get('projectId')! } : {}),
      ...(searchParams.get('type')
        ? { type: searchParams.get('type') as ReportType }
        : {}),
      ...(searchParams.get('riskLevel')
        ? { riskLevel: searchParams.get('riskLevel') as RiskLevel }
        : {}),
      ...(searchParams.get('dateFrom') ? { dateFrom: `${searchParams.get('dateFrom')}T00:00:00.000Z` } : {}),
      ...(searchParams.get('dateTo') ? { dateTo: `${searchParams.get('dateTo')}T23:59:59.999Z` } : {}),
    };
  }, [searchParams]);

  const [data, setData] = useState<PaginatedData<InspectionListItemDto> | null>(null);
  const [summary, setSummary] = useState<InspectionSummaryDto | null>(null);
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [projects, setProjects] = useState<ProjectDto[]>([]);
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
      const parsed = JSON.parse(queryKey) as InspectionListQuery;
      const [page, counts] = await Promise.all([
        inspectionService.list(parsed),
        inspectionService.summary(parsed),
      ]);
      if (requestId !== requestIdRef.current) return;
      setData(page);
      setSummary(counts);
    } catch (caught) {
      if (requestId !== requestIdRef.current) return;
      setError(caught instanceof ApiError ? caught.message : 'Дүгнэлт ачаалж чадсангүй.');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [queryKey]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      objectService.customers(),
      projectService.listProjects({ limit: 100, isActive: true }),
    ])
      .then(([customerList, projectPage]) => {
        if (cancelled) return;
        setCustomers(customerList);
        setProjects(projectPage.items as ProjectDto[]);
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

  const bands = useRiskBands();

  const countOf = (level: RiskLevel): number =>
    summary?.counts.find((entry) => entry.level === level)?.count ?? 0;

  const columns: ReadonlyArray<Column<InspectionListItemDto>> = [
    {
      key: 'reportNumber',
      header: 'Тайлан №',
      render: (row) => (
        <span className="whitespace-nowrap font-medium text-slate-900">{row.reportNumber}</span>
      ),
    },
    {
      key: 'type',
      header: 'Эх сурвалж',
      render: (row) => (
        <span className="whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
          {REPORT_TYPE_LABELS[row.type]}
        </span>
      ),
    },
    {
      key: 'objectName',
      header: 'Төхөөрөмж',
      // Always present: a row is one equipment result, and a report naming no equipment
      // produces no row at all rather than a row with an empty cell.
      render: (row) => <span className="truncate text-slate-900">{row.objectName}</span>,
    },
    {
      key: 'objectCode',
      header: 'Код',
      render: (row) => (
        <span className="whitespace-nowrap text-slate-600">{row.objectCode ?? '-'}</span>
      ),
    },
    {
      key: 'object',
      header: 'Тоноглол',
      // A row is now one equipment result rather than one report, so the object is named
      // outright. `siblingCount` says how many findings share the parent report, which is
      // what stops several rows from the same visit reading as unrelated records.
      render: (row) => (
        <div className="min-w-0">
          <span className="block truncate text-slate-900">{row.objectName}</span>
          {row.siblingCount > 1 && (
            <span className="block text-[11px] text-slate-500">
              {row.reportNumber} · {row.siblingCount} тоноглолын нэг
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'location',
      header: 'Байршил',
      render: (row) => <span className="text-slate-700">{row.locationPath}</span>,
    },
    {
      key: 'score',
      header: 'Үнэлгээ',
      render: (row) => <ScoreBar level={row.riskLevel} score={row.score} />,
    },
    {
      key: 'conclusion',
      header: 'Дүгнэлт',
      render: (row) => (
        <span className="line-clamp-2 text-xs text-slate-700">{row.conclusion ?? '-'}</span>
      ),
    },
    {
      key: 'recommendation',
      header: 'Зөвлөмж',
      render: (row) => (
        <span className="line-clamp-2 text-xs text-slate-600">{row.recommendation ?? '-'}</span>
      ),
    },
    {
      key: 'assessedBy',
      header: 'Хариуцсан',
      render: (row) => (
        <span className="truncate text-slate-700">
          {row.approvedByName ?? row.createdByName ?? '-'}
        </span>
      ),
    },
    {
      key: 'occurredAt',
      header: 'Огноо',
      render: (row) => (
        <span className="whitespace-nowrap text-slate-600">{formatDate(row.occurredAt)}</span>
      ),
    },
    {
      key: 'status',
      header: 'Төлөв',
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          <span className="whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
            {REPORT_STATUS_LABELS[row.status]}
          </span>
          {row.riskLevel ? (
            <span className={`whitespace-nowrap text-xs ${BAND_TONES[row.riskLevel]}`}>
              {RISK_LEVEL_LABELS[row.riskLevel]}
            </span>
          ) : (
            // A report that recorded a visit without scoring has no band to show.
            <span className="whitespace-nowrap text-xs text-slate-400">Үнэлгээгүй</span>
          )}
        </div>
      ),
    },
  ];

  const columnState = useTableColumns('inspections', columns);

  return (
    <>
      <PageHeader
        title="Үзлэг ба дүгнэлт"
        breadcrumbs={[{ label: 'Нүүр', to: '/dashboard' }, { label: 'Үзлэг ба дүгнэлт' }]}
      />

      {summary && (
        <div
          role="group"
          aria-label="Үнэлгээний тоо"
          className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4"
        >
          <CountCard label="Нийт төхөөрөмж" value={summary.totalObjects} />
          <CountCard label="Хэвийн" value={countOf('NORMAL')} tone="text-green-700" />
          <CountCard label="Анхаарах" value={countOf('ATTENTION')} tone="text-amber-700" />
          <CountCard
            label="Засвар шаардлагатай"
            value={summary.repairRequiredCount}
            tone="text-red-700"
          />
        </div>
      )}

      {summary && (
        <p className="mb-4 text-xs text-slate-500">
          Үнэлгээгүй {summary.unassessedObjects} объект. Барилга, давхрын нэгдсэн үнэлгээний
          арга батлагдаагүй тул нэгдсэн оноо гаргахгүй.
        </p>
      )}

      <div className={FILTER_BAR}>
        <div className="min-w-[220px] flex-1">
          <label htmlFor="inspection-search" className={FILTER_LABEL}>
            Хайлт
          </label>
          <SearchField
            id="inspection-search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') updateParam('search', searchDraft.trim());
            }}
            onBlur={() => updateParam('search', searchDraft.trim())}
            placeholder="Төхөөрөмж, код, дүгнэлтээр хайх"
          />
        </div>

        <div>
          <label htmlFor="inspection-customer" className={FILTER_LABEL}>
            Харилцагч
          </label>
          <select
            id="inspection-customer"
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
          <label htmlFor="inspection-type" className={FILTER_LABEL}>
            Эх сурвалж
          </label>
          <select
            id="inspection-type"
            value={searchParams.get('type') ?? ''}
            onChange={(event) => updateParam('type', event.target.value)}
            className={FILTER_SELECT}
          >
            <option value="">Бүгд</option>
            {REPORT_TYPES.map((entry) => (
              <option key={entry} value={entry}>
                {REPORT_TYPE_LABELS[entry]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="inspection-source" className={FILTER_LABEL}>
            Үүсгэсэн бичлэг
          </label>
          <select
            id="inspection-source"
            value={searchParams.get('sourceType') ?? ''}
            onChange={(event) => updateParam('sourceType', event.target.value)}
            className={FILTER_SELECT}
          >
            <option value="">Бүгд</option>
            {REPORT_SOURCE_TYPES.map((entry) => (
              <option key={entry} value={entry}>
                {REPORT_SOURCE_TYPE_LABELS[entry]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="inspection-status" className={FILTER_LABEL}>
            Төлөв
          </label>
          <select
            id="inspection-status"
            value={searchParams.get('status') ?? ''}
            onChange={(event) => updateParam('status', event.target.value)}
            className={FILTER_SELECT}
          >
            <option value="">Бүгд</option>
            {REPORT_STATUSES.map((entry) => (
              <option key={entry} value={entry}>
                {REPORT_STATUS_LABELS[entry]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="inspection-project" className={FILTER_LABEL}>
            Төсөл
          </label>
          <select
            id="inspection-project"
            value={searchParams.get('projectId') ?? ''}
            onChange={(event) => updateParam('projectId', event.target.value)}
            className={FILTER_SELECT}
          >
            <option value="">Бүгд</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="inspection-risk" className={FILTER_LABEL}>
            Эрсдэл
          </label>
          <select
            id="inspection-risk"
            value={searchParams.get('riskLevel') ?? ''}
            onChange={(event) => updateParam('riskLevel', event.target.value)}
            className={FILTER_SELECT}
          >
            <option value="">Бүгд</option>
            {RISK_LEVELS.map((level) => (
              <option key={level} value={level}>
                {RISK_LEVEL_LABELS[level]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="inspection-from" className={FILTER_LABEL}>
            Эхлэх огноо
          </label>
          <input
            id="inspection-from"
            type="date"
            value={searchParams.get('dateFrom') ?? ''}
            onChange={(event) => updateParam('dateFrom', event.target.value)}
            className={FILTER_INPUT}
          />
        </div>

        <div>
          <label htmlFor="inspection-to" className={FILTER_LABEL}>
            Дуусах огноо
          </label>
          <input
            id="inspection-to"
            type="date"
            value={searchParams.get('dateTo') ?? ''}
            onChange={(event) => updateParam('dateTo', event.target.value)}
            className={FILTER_INPUT}
          />
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        {/* Null means the thresholds could not be read. The legend then says nothing
            rather than printing the shipped defaults as though they were in force. */}
        {bands === null ? <span /> : <RiskLegend bands={bands} />}
        <ColumnPicker controller={columnState} />
      </div>

      <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <DataTable
          columns={columnState.visibleColumns}
          rows={data?.items ?? []}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          onRowClick={(row) =>
            row.floorId ? navigate(`/floors/${row.floorId}/objects/${row.objectId}`) : undefined
          }
          emptyTitle="Дүгнэлт алга"
          emptyDescription="Шүүлтэд тохирох дүгнэлт олдсонгүй."
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
