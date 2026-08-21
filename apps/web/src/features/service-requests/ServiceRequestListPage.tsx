import {
  PERMISSIONS,
  SLA_STATES,
  SLA_STATE_LABELS,
  type ServiceRequestListItemDto,
  type ServiceRequestStatus,
  type SlaState,
  type ServiceRequestListQuery,
} from '@monhorus/shared';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Button } from '../../components/ui/Button';
import { ColumnPicker } from '../../components/ui/ColumnPicker';
import { DataTable, Pagination, type Column } from '../../components/ui/DataTable';
import { RequestStatusBadge, SlaBadge } from '../../components/ui/DomainBadges';
import { PageHeader } from '../../components/ui/PageHeader';
import { RowActions } from '../../components/ui/RowActions';
import { SearchField } from '../../components/ui/SearchField';
import { SubNav } from '../../components/ui/SubNav';
import { FILTER_BAR, FILTER_LABEL, FILTER_SELECT } from '../../components/ui/control-styles';
import { SERVICE_REQUEST_TABS } from '../../config/navigation';
import { useAuth } from '../../contexts/auth-context';
import { useRequestStages } from '../../hooks/use-request-stages';
import { useTableColumns } from '../../hooks/use-table-columns';
import { ApiError } from '../../lib/api-client';
import {
  serviceRequestService,
} from '../../services/service-request.service';

export function ServiceRequestListPage(): ReactElement {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const stages = useRequestStages();

  const query = useMemo<ServiceRequestListQuery>(() => {
    const page = Number.parseInt(searchParams.get('page') ?? '1', 10);
    const stage = searchParams.get('stage');
    const status = searchParams.get('status');
    const slaState = searchParams.get('slaState');
    const search = searchParams.get('search');
    const isUrgent = searchParams.get('isUrgent');

    return {
      page: Number.isFinite(page) && page > 0 ? page : 1,
      limit: 20,
      ...(search ? { search } : {}),
      ...(stage ? { stage } : {}),
      // `status` is no longer offered by the dropdown, but a bookmark or a link pasted into
      // a chat still carries one. The server takes it as the narrower of the two, so an old
      // link keeps filtering exactly as it did.
      ...(status ? { status: status as ServiceRequestStatus } : {}),
      ...(slaState ? { slaState: slaState as SlaState } : {}),
      ...(isUrgent === 'true' ? { isUrgent: true } : {}),
    };
  }, [searchParams]);

  const [data, setData] = useState<Awaited<
    ReturnType<typeof serviceRequestService.list>
  > | null>(null);
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
      const result = await serviceRequestService.list(
        JSON.parse(queryKey) as ServiceRequestListQuery,
      );
      if (requestId !== requestIdRef.current) return;
      setData(result);
    } catch (caught) {
      if (requestId !== requestIdRef.current) return;
      setError(caught instanceof ApiError ? caught.message : 'Хүсэлт ачаалж чадсангүй.');
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

  /**
   * Picking a stage also drops any `status` the URL arrived with.
   *
   * The server takes the exact status as the narrower of the two, so a leftover one from a
   * pasted link would quietly outrank the choice just made on screen.
   */
  function selectStage(value: string): void {
    const next = new URLSearchParams(searchParams);
    next.delete('status');
    next.delete('page');
    if (value) next.set('stage', value);
    else next.delete('stage');
    setSearchParams(next);
  }

  const hasFilters = ['search', 'stage', 'status', 'requestType', 'slaState', 'isUrgent'].some(
    (key) => searchParams.get(key),
  );

  const columns: ReadonlyArray<Column<ServiceRequestListItemDto>> = [
    {
      key: 'number',
      header: 'Дугаар',
      render: (row) => (
        <span className="whitespace-nowrap font-medium text-slate-900">{row.requestNumber}</span>
      ),
    },
    {
      key: 'customer',
      header: 'Харилцагч',
      render: (row) => <span className="text-slate-700">{row.customer?.name ?? '-'}</span>,
    },
    {
      key: 'project',
      header: 'Төсөл',
      render: (row) => <span className="text-slate-700">{row.project?.name ?? '-'}</span>,
    },
    {
      key: 'building',
      header: 'Барилга',
      render: (row) => <span className="text-slate-700">{row.building?.name ?? '-'}</span>,
    },
    {
      key: 'floor',
      header: 'Давхар',
      render: (row) => <span className="text-slate-700">{row.floor?.name ?? '-'}</span>,
    },
    {
      key: 'room',
      header: 'Өрөө',
      render: (row) => <span className="text-slate-700">{row.room?.name ?? '-'}</span>,
    },
    {
      key: 'device',
      header: 'Төхөөрөмж',
      render: (row) => <span className="text-slate-700">{row.device?.name ?? '-'}</span>,
    },
    {
      key: 'assignee',
      header: 'Хариуцагч',
      render: (row) => {
        if (row.assignedEmployees.length === 0) {
          // A team-only assignment is still assigned, so the placeholder is reserved for
          // a request nobody is on.
          return row.assignedTeam ? (
            <span className="text-slate-400">-</span>
          ) : (
            <span className="text-xs text-slate-400">Хуваарилагдаагүй</span>
          );
        }
        return (
          <span className="text-slate-700">
            {row.assignedEmployees
              .slice(0, 2)
              .map((employee) => `${employee.lastName} ${employee.firstName}`)
              .join(', ')}
            {row.assignedEmployees.length > 2 ? ` +${row.assignedEmployees.length - 2}` : ''}
          </span>
        );
      },
    },
    {
      key: 'team',
      header: 'Баг',
      render: (row) => <span className="text-slate-700">{row.assignedTeam?.name ?? '-'}</span>,
    },
    {
      key: 'status',
      header: 'Төлөв',
      render: (row) => <RequestStatusBadge status={row.status} stage={row.stage} />,
    },
    {
      key: 'sla',
      header: 'SLA',
      render: (row) => <SlaBadge state={row.slaState} remainingMinutes={row.slaRemainingMinutes} />,
    },
    {
      key: 'created',
      header: 'Үүссэн',
      render: (row) => (
        <span className="whitespace-nowrap text-slate-700">
          {new Date(row.createdAt).toLocaleString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' })}
        </span>
      ),
    },
    {
      key: 'createdBy',
      header: 'Үүсгэсэн',
      render: (row) => <span className="text-slate-700">{row.createdByName ?? '-'}</span>,
    },
    {
      key: 'actions',
      header: 'Үйлдэл',
      align: 'right',
      render: (row) => (
        <RowActions
          items={[{ label: 'Харах', to: `/service-requests/${row.id}` }]}
        />
      ),
    },
  ];

  const columnState = useTableColumns('service-requests', columns);

  return (
    <>
      <PageHeader
        title="Үйлчилгээний хүсэлт"
        breadcrumbs={[{ label: 'Нүүр', to: '/dashboard' }, { label: 'Үйлчилгээний хүсэлт' }]}
        actions={
          can(PERMISSIONS.SERVICE_REQUEST_CREATE) ? (
            <Button onClick={() => navigate('/service-requests/new')}>Шинэ хүсэлт</Button>
          ) : null
        }
      />

      <SubNav items={SERVICE_REQUEST_TABS} />

      <div className={FILTER_BAR}>
        <div className="min-w-[200px] flex-1">
          <label htmlFor="request-search" className={FILTER_LABEL}>
            Хайлт
          </label>
          <SearchField
            id="request-search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') updateParam('search', searchDraft.trim());
            }}
            onBlur={() => updateParam('search', searchDraft.trim())}
            placeholder="Дугаар, тайлбар, холбоо барих хүн"
          />
        </div>

        {/*
          Stages, not statuses. Fourteen engine statuses in a dropdown asked the operator to
          know that ON_SITE and IN_PROGRESS are the same step of the job; the nine stages are
          the steps the business actually recognises, and the server expands the key back to
          the statuses it covers. Hidden stages are configured to stay out of pickers.
        */}
        <div>
          <label htmlFor="request-stage" className={FILTER_LABEL}>
            Төлөв
          </label>
          <select
            id="request-stage"
            value={searchParams.get('stage') ?? ''}
            onChange={(event) => selectStage(event.target.value)}
            className={FILTER_SELECT}
          >
            <option value="">Бүх төлөв</option>
            {stages
              .filter((stage) => !stage.hidden)
              .map((stage) => (
                <option key={stage.key} value={stage.key}>
                  {stage.label}
                </option>
              ))}
          </select>
        </div>

        <div>
          <label htmlFor="request-sla" className={FILTER_LABEL}>
            SLA төлөв
          </label>
          <select
            id="request-sla"
            value={searchParams.get('slaState') ?? ''}
            onChange={(event) => updateParam('slaState', event.target.value)}
            className={FILTER_SELECT}
          >
            <option value="">Бүгд</option>
            {SLA_STATES.map((state) => (
              <option key={state} value={state}>
                {SLA_STATE_LABELS[state]}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={searchParams.get('isUrgent') === 'true'}
            onChange={(event) => updateParam('isUrgent', event.target.checked ? 'true' : '')}
            className="h-4 w-4 rounded border-slate-300"
          />
          Зөвхөн яаралтай
        </label>

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
          emptyTitle="Хүсэлт олдсонгүй"
          emptyDescription={
            hasFilters
              ? 'Шүүлтүүрт тохирох хүсэлт алга.'
              : 'Одоогоор бүртгэгдсэн үйлчилгээний хүсэлт байхгүй байна.'
          }
          onRowClick={(row) => navigate(`/service-requests/${row.id}`)}
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
