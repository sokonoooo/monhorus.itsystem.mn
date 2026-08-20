import { type PaginatedData } from '@monhorus/shared';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Button } from '../../components/ui/Button';
import { ColumnPicker } from '../../components/ui/ColumnPicker';
import { DataTable, Pagination, type Column } from '../../components/ui/DataTable';
import { Drawer } from '../../components/ui/Drawer';
import { PageHeader } from '../../components/ui/PageHeader';
import { RowActions } from '../../components/ui/RowActions';
import { SearchField } from '../../components/ui/SearchField';
import {
  FILTER_BAR,
  FILTER_INPUT,
  FILTER_LABEL,
  FILTER_SELECT,
} from '../../components/ui/control-styles';
import { useTableColumns } from '../../hooks/use-table-columns';
import { ApiError } from '../../lib/api-client';
import {
  auditService,
  type AuditEntryDto,
  type AuditFacets,
  type AuditQuery,
} from '../../services/audit.service';

/** Mongolian labels for the audit vocabulary in requirements 14.4. */
const ACTION_LABELS: Record<string, string> = {
  Created: 'Үүсгэсэн',
  Updated: 'Шинэчилсэн',
  StatusChanged: 'Төлөв өөрчилсөн',
  Assigned: 'Хуваарилсан',
  Submitted: 'Илгээсэн',
  Approved: 'Баталсан',
  Returned: 'Буцаасан',
  Closed: 'Хаасан',
  Cancelled: 'Цуцалсан',
  PasscodeReset: 'Нууц үг шинэчилсэн',
  PasswordChanged: 'Нууц үг сольсон',
  LoginSucceeded: 'Нэвтэрсэн',
  LoginFailed: 'Нэвтрэх оролдлого',
  LoggedOut: 'Гарсан',
  AccountLocked: 'Бүртгэл хаагдсан',
  TokenReuseDetected: 'Token дахин ашиглалт',
  PLANNED_WORK_BECAME_OVERDUE: 'Хугацаа хэтэрсэн (систем)',
  PLANNED_WORK_RESCHEDULED: 'Хугацаа сунгасан',
  PLANNED_WORK_ARCHIVED: 'Архивласан',
  REPORT_CREATED: 'Тайлан үүссэн',
  REPORT_UPDATED: 'Тайлан шинэчилсэн',
  REPORT_SUBMITTED: 'Тайлан илгээсэн',
  REPORT_RETURNED: 'Тайлан буцаасан',
  REPORT_APPROVED: 'Тайлан баталсан',
};

const ENTITY_LABELS: Record<string, string> = {
  User: 'Хэрэглэгч',
  Employee: 'Ажилтан',
  Customer: 'Харилцагч',
  Work: 'Ажил/Хүсэлт',
  Equipment: 'Объект/Төхөөрөмж',
  Permission: 'Role/Permission',
  PlannedWork: 'Төлөвлөгөөт ажил',
  PlannedWorkTask: 'Дэд ажил',
  PlannedWorkReport: 'Ажлын тайлан',
};

function JsonBlock({ label, value }: { label: string; value: unknown }): ReactElement | null {
  if (value === null || value === undefined) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-slate-600">{label}</p>
      <pre className="overflow-x-auto rounded-lg bg-slate-50 p-2.5 text-[11px] leading-relaxed text-slate-800 ring-1 ring-slate-200">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

/**
 * Audit log browser.
 *
 * Read-only by construction: the backend exposes no mutating route and the model
 * blocks every update and delete path, so there is deliberately no delete action here.
 * Salary-sensitive rows are filtered out server-side for callers without
 * employee.view_salary.
 */
export function AuditLogPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();

  const query = useMemo<AuditQuery>(() => {
    const page = Number.parseInt(searchParams.get('page') ?? '1', 10);
    return {
      page: Number.isFinite(page) && page > 0 ? page : 1,
      limit: 25,
      ...(searchParams.get('entityType') ? { entityType: searchParams.get('entityType')! } : {}),
      ...(searchParams.get('action') ? { action: searchParams.get('action')! } : {}),
      ...(searchParams.get('search') ? { search: searchParams.get('search')! } : {}),
      ...(searchParams.get('from') ? { from: searchParams.get('from')! } : {}),
      ...(searchParams.get('to') ? { to: searchParams.get('to')! } : {}),
    };
  }, [searchParams]);

  const [data, setData] = useState<PaginatedData<AuditEntryDto> | null>(null);
  const [facets, setFacets] = useState<AuditFacets>({ entityTypes: [], actions: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState(() => searchParams.get('search') ?? '');
  const [detail, setDetail] = useState<AuditEntryDto | null>(null);

  const requestIdRef = useRef(0);
  const queryKey = JSON.stringify(query);

  const load = useCallback(async (): Promise<void> => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await auditService.list(JSON.parse(queryKey) as AuditQuery);
      if (requestId !== requestIdRef.current) return;
      setData(result);
    } catch (caught) {
      if (requestId !== requestIdRef.current) return;
      setError(caught instanceof ApiError ? caught.message : 'Audit log ачаалж чадсангүй.');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [queryKey]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    auditService
      .facets()
      .then(setFacets)
      .catch(() => undefined);
  }, []);

  function updateParam(key: string, value: string): void {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setSearchParams(next);
  }

  const hasFilters = ['entityType', 'action', 'search', 'from', 'to'].some((key) =>
    searchParams.get(key),
  );

  const columns: ReadonlyArray<Column<AuditEntryDto>> = [
    {
      key: 'occurredAt',
      header: 'Хугацаа',
      render: (row) => (
        <span className="whitespace-nowrap text-slate-700">
          {new Date(row.occurredAt).toLocaleString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' })}
        </span>
      ),
    },
    {
      key: 'actor',
      header: 'Хэрэглэгч',
      render: (row) => <span className="truncate text-slate-900">{row.actorName ?? 'Систем'}</span>,
    },
    {
      key: 'actorRole',
      header: 'Эрх',
      render: (row) => <span className="truncate text-slate-700">{row.actorRole ?? '-'}</span>,
    },
    {
      key: 'action',
      header: 'Үйлдэл',
      render: (row) => (
        <span className="whitespace-nowrap text-slate-800">
          {ACTION_LABELS[row.action] ?? row.action}
        </span>
      ),
    },
    {
      key: 'entity',
      header: 'Обьект',
      render: (row) => (
        <span className="truncate text-slate-800">
          {ENTITY_LABELS[row.entityType] ?? row.entityType}
        </span>
      ),
    },
    {
      key: 'entityId',
      header: 'Обьектын ID',
      render: (row) => (
        <span className="truncate font-mono text-[10px] text-slate-400">{row.entityId ?? '-'}</span>
      ),
    },
    {
      key: 'fields',
      header: 'Өөрчлөгдсөн',
      render: (row) =>
        row.changedFields.length === 0 ? (
          <span className="text-xs text-slate-400">-</span>
        ) : (
          <span className="text-xs text-slate-700">{row.changedFields.join(', ')}</span>
        ),
    },
    {
      key: 'reason',
      header: 'Шалтгаан',
      render: (row) => (
        <span className="text-xs text-slate-600">{row.reason ?? '-'}</span>
      ),
    },
    {
      // Labelled rather than blank so the column picker has something to name it by.
      key: 'actions',
      header: 'Дэлгэрэнгүй',
      align: 'right',
      render: (row) => (
        <RowActions items={[{ label: 'Дэлгэрэнгүй', onSelect: () => setDetail(row) }]} />
      ),
    },
  ];

  const columnState = useTableColumns('audit', columns);

  return (
    <>
      <PageHeader
        title="Audit log"
        breadcrumbs={[{ label: 'Нүүр', to: '/dashboard' }, { label: 'Audit log' }]}
      />

      <div className={FILTER_BAR}>
        <div className="min-w-[200px] flex-1">
          <label htmlFor="audit-search" className={FILTER_LABEL}>
            Хайлт
          </label>
          <SearchField
            id="audit-search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') updateParam('search', searchDraft.trim());
            }}
            onBlur={() => updateParam('search', searchDraft.trim())}
            placeholder="Хэрэглэгч, шалтгаан, обьект"
          />
        </div>

        <div>
          <label htmlFor="audit-entity" className={FILTER_LABEL}>
            Обьектын төрөл
          </label>
          <select
            id="audit-entity"
            value={searchParams.get('entityType') ?? ''}
            onChange={(event) => updateParam('entityType', event.target.value)}
            className={FILTER_SELECT}
          >
            <option value="">Бүгд</option>
            {facets.entityTypes.map((entity) => (
              <option key={entity} value={entity}>
                {ENTITY_LABELS[entity] ?? entity}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="audit-action" className={FILTER_LABEL}>
            Үйлдэл
          </label>
          <select
            id="audit-action"
            value={searchParams.get('action') ?? ''}
            onChange={(event) => updateParam('action', event.target.value)}
            className={FILTER_SELECT}
          >
            <option value="">Бүгд</option>
            {facets.actions.map((action) => (
              <option key={action} value={action}>
                {ACTION_LABELS[action] ?? action}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="audit-from" className={FILTER_LABEL}>
            Эхлэх
          </label>
          <input
            id="audit-from"
            type="date"
            value={searchParams.get('from') ?? ''}
            onChange={(event) => updateParam('from', event.target.value)}
            className={FILTER_INPUT}
          />
        </div>

        <div>
          <label htmlFor="audit-to" className={FILTER_LABEL}>
            Дуусах
          </label>
          <input
            id="audit-to"
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
          // Numbered off the response rather than the query, so a request in flight can
          // never number the rows on screen against the page they did not come from.
          numbering={{ page: data?.page ?? 1, limit: data?.limit ?? 25 }}
          loading={loading}
          error={error}
          onRetry={() => void load()}
          emptyTitle="Бүртгэл олдсонгүй"
          emptyDescription={
            hasFilters ? 'Шүүлтүүрт тохирох бүртгэл алга.' : 'Audit log хоосон байна.'
          }
          onRowClick={(row) => setDetail(row)}
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

      <Drawer
        open={detail !== null}
        title={detail ? `${ACTION_LABELS[detail.action] ?? detail.action}` : ''}
        onClose={() => setDetail(null)}
        width="lg"
        footer={
          <Button variant="secondary" onClick={() => setDetail(null)}>
            Хаах
          </Button>
        }
      >
        {detail && (
          <div className="space-y-4 text-sm">
            <dl className="space-y-1.5">
              {[
                ['Хугацаа', new Date(detail.occurredAt).toLocaleString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' })],
                ['Хэрэглэгч', detail.actorName ?? 'Систем'],
                ['Эрх', detail.actorRole ?? '-'],
                ['Обьектын төрөл', ENTITY_LABELS[detail.entityType] ?? detail.entityType],
                ['Обьектын ID', detail.entityId ?? '-'],
                ['Шалтгаан', detail.reason ?? '-'],
                ['IP', detail.ip ?? '-'],
                ['Төхөөрөмж', detail.userAgent ?? '-'],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3 border-b border-slate-100 py-1.5">
                  <dt className="shrink-0 text-xs text-slate-500">{label}</dt>
                  <dd className="min-w-0 break-all text-right text-slate-900">{value}</dd>
                </div>
              ))}
            </dl>

            {detail.changedFields.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold text-slate-600">Өөрчлөгдсөн талбар</p>
                <p className="text-slate-800">{detail.changedFields.join(', ')}</p>
              </div>
            )}

            <JsonBlock label="Өмнөх утга" value={detail.oldValue} />
            <JsonBlock label="Шинэ утга" value={detail.newValue} />
          </div>
        )}
      </Drawer>
    </>
  );
}
