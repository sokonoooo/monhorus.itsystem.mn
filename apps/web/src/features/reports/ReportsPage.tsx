import {
  KPI_KEYS,
  PERMISSIONS,
  REPORT_DESCRIPTIONS,
  REPORT_KEYS,
  REPORT_LABELS,
  type KpiSummaryDto,
  type KpiValueDto,
  type ReportCellValue,
  type ReportColumnDto,
  type ReportKey,
  type ReportQuery,
  type ReportResultDto,
} from '@monhorus/shared';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Alert } from '../../components/ui/Alert';
import { Pagination } from '../../components/ui/DataTable';
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/States';
import { useToast } from '../../components/ui/ToastProvider';
import {
  FILTER_BAR,
  FILTER_INPUT,
  FILTER_LABEL,
  FILTER_SELECT,
} from '../../components/ui/control-styles';
import { useAuth } from '../../contexts/auth-context';
import { ApiError } from '../../lib/api-client';
import { monthStartDateInput, todayDateInput } from '../../lib/calendar-date';
import { reportService } from '../../services/report.service';

/** First day of the current month, as a `yyyy-mm-dd` value for a date input. */
function monthStart(): string {
  return monthStartDateInput();
}

function today(): string {
  return todayDateInput();
}

/**
 * Renders a cell according to the column's declared format.
 *
 * Null prints as a dash rather than as a zero: a report must never make a missing figure
 * look like a measured one.
 */
function formatCell(value: ReportCellValue, column: ReportColumnDto): string {
  if (value === null || value === undefined || value === '') return '-';

  switch (column.format) {
    case 'MONEY':
    case 'NUMBER':
      return typeof value === 'number' ? value.toLocaleString('mn-MN') : String(value);
    case 'PERCENT':
      return typeof value === 'number' ? `${value}%` : String(value);
    case 'DATE':
      return new Date(String(value)).toLocaleDateString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' });
    case 'DATETIME':
      return new Date(String(value)).toLocaleString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' });
    default:
      return String(value);
  }
}

function formatKpi(kpi: KpiValueDto): string {
  if (kpi.value === null) return '-';
  switch (kpi.unit) {
    case 'PERCENT':
      return `${kpi.value}%`;
    case 'HOURS':
      return `${kpi.value} цаг`;
    case 'MONEY':
      return kpi.value.toLocaleString('mn-MN');
    default:
      return kpi.value.toLocaleString('mn-MN');
  }
}

function KpiCard({ kpi }: { kpi: KpiValueDto }): ReactElement {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200" title={kpi.formula}>
      <div className="text-xs text-slate-500">{kpi.label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{formatKpi(kpi)}</div>
      <div className="mt-1 text-xs text-slate-400">{kpi.purpose}</div>
      {kpi.denominator !== null && (
        <div className="mt-0.5 text-xs text-slate-400">
          {kpi.numerator ?? 0} / {kpi.denominator}
        </div>
      )}
    </div>
  );
}

/**
 * Section 15.2 report catalogue and section 15.3 KPIs.
 *
 * Columns arrive with the rows, so one table serves all nine reports and adding a report
 * to the backend needs no change here. Export is CSV with a UTF-8 BOM, which Excel opens
 * directly, plus the browser print dialog for PDF (rule 17.20).
 */
/**
 * Rows per page on screen.
 *
 * Twenty-five rather than the endpoint's own default of a thousand: that default belongs
 * to the CSV export, which has no pager and must carry the whole report in one response.
 */
const REPORT_PAGE_SIZE = 25;

/** What an export asks for: one response carrying the whole report, as it always has. */
const REPORT_EXPORT_LIMIT = 1000;

export function ReportsPage(): ReactElement {
  const { can } = useAuth();
  const { notify } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const canExport = can(PERMISSIONS.REPORT_EXPORT);

  const reportKey = (searchParams.get('report') as ReportKey | null) ?? 'SLA';
  const dateFrom = searchParams.get('dateFrom') ?? monthStart();
  const dateTo = searchParams.get('dateTo') ?? today();
  // In the url so a page is linkable and survives a reload, like every filter here.
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);

  const query = useMemo<ReportQuery>(
    () => ({
      dateFrom: `${dateFrom}T00:00:00.000Z`,
      dateTo: `${dateTo}T23:59:59.999Z`,
      page,
      // A page-sized window. The endpoint's own default is far higher because that is
      // what the CSV export wants — an export has no pager and must carry the whole
      // report — but a screen has one, so it asks for what it can show.
      limit: REPORT_PAGE_SIZE,
    }),
    [dateFrom, dateTo, page],
  );

  const [report, setReport] = useState<ReportResultDto | null>(null);
  const [kpis, setKpis] = useState<KpiSummaryDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const requestIdRef = useRef(0);
  const queryKey = JSON.stringify({ reportKey, query });

  const load = useCallback(async (): Promise<void> => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const parsed = JSON.parse(queryKey) as { reportKey: ReportKey; query: ReportQuery };
      const [result, kpiResult] = await Promise.all([
        reportService.run(parsed.reportKey, parsed.query),
        reportService.kpis(parsed.query.dateFrom!, parsed.query.dateTo!),
      ]);
      if (requestId !== requestIdRef.current) return;
      setReport(result);
      setKpis(kpiResult);
    } catch (caught) {
      if (requestId !== requestIdRef.current) return;
      setError(caught instanceof ApiError ? caught.message : 'Тайлан ачаалж чадсангүй.');
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
    // Any filter change puts the reader back on page one. Page four of the old filter is
    // rarely a page of the new one, and is often past its end — which would answer with an
    // empty table for a filter that actually matches plenty.
    if (key !== 'page') next.delete('page');
    setSearchParams(next);
  }

  async function handleExport(): Promise<void> {
    setExporting(true);
    try {
      // Deliberately NOT `query`: an export has no pager, so it carries the whole report
      // rather than the window the screen happens to be showing. The high limit is the
      // one this page has always exported with; only the page is dropped.
      const { page: _page, ...whole } = query;
      await reportService.downloadCsv(reportKey, { ...whole, limit: REPORT_EXPORT_LIMIT });
      notify('CSV файл татагдлаа.', 'success');
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : 'Татаж чадсангүй.', 'error');
    } finally {
      setExporting(false);
    }
  }

  const orderedKpis = kpis
    ? KPI_KEYS.map((key) => kpis.values.find((value) => value.key === key)).filter(
        (value): value is KpiValueDto => value !== undefined,
      )
    : [];

  return (
    <>
      <PageHeader
        title="Тайлан"
        breadcrumbs={[{ label: 'Нүүр', to: '/dashboard' }, { label: 'Тайлан' }]}
        actions={
          <>
            {canExport && (
              <Button variant="secondary" onClick={() => void handleExport()} loading={exporting}>
                Excel (CSV) татах
              </Button>
            )}
            <Button variant="secondary" onClick={() => window.print()}>
              PDF хэвлэх
            </Button>
          </>
        }
      />

      {orderedKpis.length > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
          {orderedKpis.map((kpi) => (
            <KpiCard key={kpi.key} kpi={kpi} />
          ))}
        </div>
      )}

      <div className={FILTER_BAR}>
        <div className="min-w-[240px] flex-1">
          <label htmlFor="report-key" className={FILTER_LABEL}>
            Тайлангийн төрөл
          </label>
          <select
            id="report-key"
            value={reportKey}
            onChange={(event) => updateParam('report', event.target.value)}
            className={`${FILTER_SELECT} w-full`}
          >
            {REPORT_KEYS.map((key) => (
              <option key={key} value={key}>
                {REPORT_LABELS[key]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="report-from" className={FILTER_LABEL}>
            Эхлэх огноо
          </label>
          <input
            id="report-from"
            type="date"
            value={dateFrom}
            onChange={(event) => updateParam('dateFrom', event.target.value)}
            className={FILTER_INPUT}
          />
        </div>

        <div>
          <label htmlFor="report-to" className={FILTER_LABEL}>
            Дуусах огноо
          </label>
          <input
            id="report-to"
            type="date"
            value={dateTo}
            onChange={(event) => updateParam('dateTo', event.target.value)}
            className={FILTER_INPUT}
          />
        </div>
      </div>

      <p className="mb-3 text-xs text-slate-500">{REPORT_DESCRIPTIONS[reportKey]}</p>

      {report?.truncatedAt !== null && report?.truncatedAt !== undefined && (
        <div className="mb-3">
          <Alert variant="warning">
            Мөрийн тоо {report.truncatedAt}-аар хязгаарлагдсан. Огнооны хязгаарыг нарийсгана уу.
          </Alert>
        </div>
      )}

      {loading ? (
        <Skeleton className="h-96 w-full" />
      ) : error ? (
        <ErrorState description={error} />
      ) : !report || report.rows.length === 0 ? (
        <EmptyState
          title="Мэдээлэл алга"
          description="Сонгосон хугацаанд тохирох бичлэг олдсонгүй."
        />
      ) : (
        <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
            <h2 className="text-sm font-semibold text-slate-900">{report.label}</h2>
            <span className="text-xs text-slate-500">Нийт {report.total} мөр</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th className="w-12 whitespace-nowrap px-4 py-2 text-right font-medium">
                    №
                  </th>
                  {report.columns.map((column) => (
                    <th
                      key={column.key}
                      className={`whitespace-nowrap px-4 py-2 font-medium ${
                        column.align === 'right' ? 'text-right' : 'text-left'
                      }`}
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.rows.map((row, index) => (
                  <tr key={index} className="hover:bg-slate-50">
                    <td className="px-4 py-2 text-right tabular-nums text-slate-500">
                      {(report.page - 1) * report.limit + index + 1}
                    </td>
                    {report.columns.map((column) => (
                      <td
                        key={column.key}
                        className={`px-4 py-2 ${
                          column.align === 'right'
                            ? 'text-right tabular-nums text-slate-700'
                            : 'text-slate-700'
                        }`}
                      >
                        {formatCell(row[column.key] ?? null, column)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {report.totals && (
                <tfoot className="border-t border-slate-200 bg-slate-50 font-medium">
                  <tr>
                    {/* Empty cell under №, or every total sits one column to the left. */}
                    <td className="px-4 py-2" />
                    {report.columns.map((column) => (
                      <td
                        key={column.key}
                        className={`px-4 py-2 ${
                          column.align === 'right'
                            ? 'text-right tabular-nums text-slate-900'
                            : 'text-slate-900'
                        }`}
                      >
                        {report.totals?.[column.key] === undefined ||
                        report.totals?.[column.key] === null
                          ? ''
                          : formatCell(report.totals[column.key] ?? null, column)}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {/*
            The same pager the nine DataTable lists use, so paging behaves identically
            wherever a reader meets it. It hides itself on a single-page report.
          */}
          <Pagination
            page={report.page}
            totalPages={report.totalPages}
            total={report.total}
            onPageChange={(next) => updateParam('page', String(next))}
          />
        </div>
      )}
    </>
  );
}
