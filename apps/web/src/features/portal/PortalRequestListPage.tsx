import {
  PERMISSIONS,
  SERVICE_REQUEST_STATUSES,
  SERVICE_REQUEST_STATUS_LABELS,
  type ServiceRequestListItemDto,
  type ServiceRequestListQuery,
} from '@monhorus/shared';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Button } from '../../components/ui/Button';
import { DataTable, Pagination, type Column } from '../../components/ui/DataTable';
import { PageHeader } from '../../components/ui/PageHeader';
import { SearchField } from '../../components/ui/SearchField';
import { FILTER_BAR, FILTER_LABEL, FILTER_SELECT } from '../../components/ui/control-styles';
import { useAuth } from '../../contexts/auth-context';
import { ApiError } from '../../lib/api-client';
import { portalService } from '../../services/portal.service';
import { PortalStatusBadge, PortalUrgentBadge } from './PortalBadges';

const PAGE_SIZE = 20;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' });
}

/**
 * The customer's own requests, including the scheduled-maintenance ones they raise.
 *
 * A SEPARATE SCREEN FROM `ServiceRequestListPage`, and the difference is in the columns
 * rather than the data. That screen renders the assigned employees and the assigned team,
 * and mounts the dispatch tab beside itself; both answer "who inside this company is
 * working on it", which is not a customer's question. These rows carry what the person who
 * raised the request needs: what, where, how urgent, how far along, and when.
 *
 * The list is bounded server-side regardless — `GET /service-requests` applies
 * `customerScopeFilter` from the authenticated account, and a `customerId` in the query is
 * discarded rather than honoured. Nothing here is doing the securing.
 */
export function PortalRequestListPage(): ReactElement {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const canCreate = can(PERMISSIONS.PORTAL_SERVICE_REQUEST_CREATE);

  const [data, setData] = useState<{
    items: ServiceRequestListItemDto[];
    total: number;
    page: number;
    totalPages: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState(searchParams.get('search') ?? '');

  const page = Number(searchParams.get('page') ?? '1');
  const status = searchParams.get('status') ?? '';
  const search = searchParams.get('search') ?? '';

  function updateParam(key: string, value: string): void {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    // A narrower filter invalidates the cursor; page 4 of a shorter list reads as "empty".
    if (key !== 'page') next.delete('page');
    setSearchParams(next);
  }

  const requestIdRef = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    const query: ServiceRequestListQuery = {
      page: Number.isFinite(page) && page > 0 ? page : 1,
      limit: PAGE_SIZE,
      ...(status ? { status: status as ServiceRequestListQuery['status'] } : {}),
      ...(search ? { search } : {}),
    };

    try {
      const result = await portalService.listRequests(query);
      if (requestId !== requestIdRef.current) return;
      setData({
        items: [...result.items],
        total: result.total,
        page: result.page,
        totalPages: result.totalPages,
      });
    } catch (caught) {
      if (requestId !== requestIdRef.current) return;
      setError(caught instanceof ApiError ? caught.message : 'Хүсэлт ачаалж чадсангүй.');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [page, status, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: Column<ServiceRequestListItemDto>[] = [
    {
      key: 'requestNumber',
      header: 'Дугаар',
      render: (row) => <span className="font-medium text-slate-900">{row.requestNumber}</span>,
    },
    {
      key: 'location',
      header: 'Байршил',
      render: (row) => (
        <span className="text-slate-700">
          {[row.building?.name, row.floor?.name].filter(Boolean).join(' · ') || '-'}
        </span>
      ),
    },
    {
      key: 'urgent',
      header: 'Яаралтай',
      render: (row) =>
        row.isUrgent ? <PortalUrgentBadge /> : <span className="text-slate-400">-</span>,
    },
    {
      key: 'status',
      header: 'Төлөв',
      render: (row) => <PortalStatusBadge status={row.status} />,
    },
    {
      key: 'createdAt',
      header: 'Илгээсэн',
      render: (row) => <span className="text-slate-700">{formatDate(row.createdAt)}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Миний хүсэлт"
        description="Танай байгууллагаас илгээсэн хүсэлтүүд."
        actions={
          canCreate && (
            <Button onClick={() => navigate('/portal/requests/new')}>Шинэ хүсэлт</Button>
          )
        }
      />

      <div className={FILTER_BAR}>
        <div className="min-w-[200px] flex-1">
          <label htmlFor="portal-search" className={FILTER_LABEL}>
            Хайлт
          </label>
          <SearchField
            id="portal-search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') updateParam('search', searchDraft.trim());
            }}
            onBlur={() => updateParam('search', searchDraft.trim())}
            placeholder="Хүсэлтийн дугаар"
          />
        </div>

        <div>
          <label htmlFor="portal-status" className={FILTER_LABEL}>
            Төлөв
          </label>
          <select
            id="portal-status"
            value={status}
            onChange={(event) => updateParam('status', event.target.value)}
            className={FILTER_SELECT}
          >
            <option value="">Бүх төлөв</option>
            {SERVICE_REQUEST_STATUSES.map((value) => (
              <option key={value} value={value}>
                {SERVICE_REQUEST_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(row) => row.id}
          numbering={{ page, limit: PAGE_SIZE }}
          loading={loading}
          error={error}
          onRetry={() => void load()}
          onRowClick={(row) => navigate(`/portal/requests/${row.id}`)}
          emptyTitle="Хүсэлт олдсонгүй"
          emptyDescription="Танай байгууллага одоогоор хүсэлт илгээгээгүй байна."
        />
        {data && data.totalPages > 1 && (
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            onPageChange={(next) => updateParam('page', String(next))}
          />
        )}
      </div>
    </>
  );
}
