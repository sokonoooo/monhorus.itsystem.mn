import {
  PERMISSIONS,
  PLANNED_WORK_EFFECTIVE_STATUSES,
  PLANNED_WORK_STATUS_LABELS,
  type PaginatedData,
  type PlannedWorkEffectiveStatus,
  type PlannedWorkListItemDto,
} from '@monhorus/shared';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { DataTable, Pagination, type Column } from '../../components/ui/DataTable';
import { PageHeader } from '../../components/ui/PageHeader';
import { SearchField } from '../../components/ui/SearchField';
import { FILTER_BAR, FILTER_LABEL, FILTER_SELECT } from '../../components/ui/control-styles';
import { useAuth } from '../../contexts/auth-context';
import { ApiError } from '../../lib/api-client';
import { portalService } from '../../services/portal.service';
import {
  LateBadge,
  PlannedWorkStatusBadge,
  ProgressBar,
} from '../planned-work/PlannedWorkBadges';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' });
}

/**
 * The customer's own planned work, at every stage of its life.
 *
 * One list rather than a "requests" list and a separate "approved work" list, because they
 * are the same record: a customer raises it, it waits, it is approved or refused, and then
 * it is carried out. Splitting them would make the status the customer most wants to watch
 * — «Хүлээгдэж буй» — live on a different screen from the outcome.
 *
 * A SEPARATE SCREEN FROM `PlannedWorkListPage`: that one carries the assigned crew and the
 * team as columns, and its row actions drive the lifecycle. Neither is a customer's
 * business, and the row here is read-only — the lifecycle is driven from the detail screen.
 *
 * WHAT THE FILTERS ARE FOR. Since work starts as a draft and can come back rejected, this
 * list mixes two populations that read very differently: records waiting on the COMPANY, and
 * records waiting on the CUSTOMER. The second kind is easy to forget — a draft nobody ever
 * submitted looks much like a job that is quietly progressing — so it is counted in a banner
 * at the top rather than left to be spotted among finished work.
 */

/** Matches the other portal list, so the two feel like one screen with two tabs. */
const PAGE_SIZE = 20;

/** The two states in which the next move is the customer's own. */
const AWAITING_CUSTOMER: readonly PlannedWorkEffectiveStatus[] = ['DRAFT', 'REJECTED'];

export function PortalPlannedWorkListPage(): ReactElement {
  const navigate = useNavigate();
  const { can } = useAuth();

  const canCreate = can(PERMISSIONS.PORTAL_PLANNED_WORK_CREATE);

  const [searchParams, setSearchParams] = useSearchParams();
  const status = (searchParams.get('status') ?? '') as PlannedWorkEffectiveStatus | '';

  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const search = searchParams.get('search') ?? '';
  const [searchDraft, setSearchDraft] = useState(() => searchParams.get('search') ?? '');

  const [data, setData] = useState<PaginatedData<PlannedWorkListItemDto> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Exact counts of the work waiting on the customer, keyed by status. */
  const [awaiting, setAwaiting] = useState<Record<string, number>>({});

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setData(
        await portalService.listPlannedWork({
          page,
          limit: PAGE_SIZE,
          ...(search ? { search } : {}),
          ...(status ? { status } : {}),
        }),
      );
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Ажил ачаалж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }, [page, search, status]);

  /**
   * Counted with their own requests rather than tallied from the rows above.
   *
   * The list is one capped page and may be filtered, so counting it would understate the
   * banner exactly when there is most to miss. `total` off a one-row page is the real
   * figure, whatever the table happens to be showing.
   */
  const loadAwaiting = useCallback(async (): Promise<void> => {
    const counts = await Promise.all(
      AWAITING_CUSTOMER.map(async (entry) => {
        try {
          const page = await portalService.listPlannedWork({ page: 1, limit: 1, status: entry });
          return [entry, page.total] as const;
        } catch {
          // A failed count silently shows nothing; it must never break the list itself.
          return [entry, 0] as const;
        }
      }),
    );
    setAwaiting(Object.fromEntries(counts));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadAwaiting();
  }, [loadAwaiting]);

  /** Changing anything but the page returns to page 1 — page 4 of a narrower result is often empty. */
  function updateParam(key: string, value: string): void {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setSearchParams(next);
  }

  /**
   * The staff columns, minus the people.
   *
   * Deliberately the same shape, order and components as `PlannedWorkListPage` — the badge,
   * the progress bar and the lateness chip are imported from it rather than reimplemented,
   * so the two screens cannot drift apart visually. What is dropped is `Харилцагч` (a
   * customer knows who they are), `Хариуцагч` and `Баг`: who inside the company is on the
   * job is not a customer's business, and it is the one thing this list must never leak.
   */
  const columns: Column<PlannedWorkListItemDto>[] = [
    {
      key: 'work',
      header: 'Ажил',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900">{row.title}</p>
          <p className="truncate text-xs text-slate-500">{row.workNumber}</p>
        </div>
      ),
    },
    {
      key: 'building',
      header: 'Барилга',
      render: (row) => <span className="text-slate-700">{row.building?.name ?? '-'}</span>,
    },
    {
      key: 'plannedStart',
      header: 'Эхлэх',
      render: (row) => <span className="text-slate-700">{formatDate(row.plannedStartDate)}</span>,
    },
    {
      key: 'plannedEnd',
      header: 'Дуусах',
      render: (row) => <span className="text-slate-700">{formatDate(row.plannedEndDate)}</span>,
    },
    {
      key: 'status',
      header: 'Төлөв',
      render: (row) => <PlannedWorkStatusBadge status={row.effectiveStatus} />,
    },
    {
      key: 'late',
      header: 'Хоцролт',
      render: (row) =>
        row.completedLate ? (
          <LateBadge delayMinutes={row.delayMinutes} />
        ) : (
          <span className="text-slate-400">-</span>
        ),
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
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Төлөвлөгөөт ажил"
        description="Танай байгууллагад хийгдэх төлөвлөгөөт ажил, хүсэлтүүд."
        actions={
          canCreate && (
            <Button onClick={() => navigate('/portal/planned-work/new')}>Шинэ хүсэлт</Button>
          )
        }
      />

      {/*
        What is waiting on the customer, said once and plainly.
        Drafts and returned requests are the two states where nothing happens until THEY act,
        and both look unremarkable in a table of coloured chips. Each count links to its own
        filter, so the banner is a way in rather than only a notice.
      */}
      {(awaiting.DRAFT ?? 0) + (awaiting.REJECTED ?? 0) > 0 && (
        <Alert variant="warning" title="Таны хийх ажил байна">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {(awaiting.DRAFT ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => updateParam('status', 'DRAFT')}
                className="text-sm font-medium underline underline-offset-2"
              >
                Илгээгээгүй {awaiting.DRAFT} ноорог
              </button>
            )}
            {(awaiting.REJECTED ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => updateParam('status', 'REJECTED')}
                className="text-sm font-medium underline underline-offset-2"
              >
                Буцаагдсан {awaiting.REJECTED} хүсэлт
              </button>
            )}
          </div>
        </Alert>
      )}

      <div className={FILTER_BAR}>
        <div className="min-w-[200px] flex-1">
          <label htmlFor="portal-pw-search" className={FILTER_LABEL}>
            Хайлт
          </label>
          <SearchField
            id="portal-pw-search"
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
          <label htmlFor="portal-pw-status" className={FILTER_LABEL}>
            Төлөв
          </label>
          <select
            id="portal-pw-status"
            value={status}
            onChange={(event) => updateParam('status', event.target.value)}
            className={FILTER_SELECT}
          >
            <option value="">Бүх төлөв</option>
            {PLANNED_WORK_EFFECTIVE_STATUSES.map((entry) => (
              <option key={entry} value={entry}>
                {PLANNED_WORK_STATUS_LABELS[entry]}
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
          onRowClick={(row) => navigate(`/portal/planned-work/${row.id}`)}
          emptyTitle="Ажил байхгүй"
          emptyDescription={
            status
              ? 'Энэ төлөвт ажил алга. Өөр шүүлтүүр сонгоно уу.'
              : 'Танай байгууллагад төлөвлөгөөт ажил бүртгэгдээгүй байна.'
          }
          emptyAction={
            canCreate ? (
              <Button size="sm" onClick={() => navigate('/portal/planned-work/new')}>
                Шинэ хүсэлт
              </Button>
            ) : undefined
          }
        />
        {data && data.totalPages > 1 && (
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            onPageChange={(next) => {
              const params = new URLSearchParams(searchParams);
              params.set('page', String(next));
              setSearchParams(params);
            }}
          />
        )}
      </div>
    </div>
  );
}
