import {
  type ServiceRequestListItemDto,
  type ServiceRequestStatus,
} from '@monhorus/shared';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '../../components/ui/Button';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { RequestStatusBadge, SlaBadge } from '../../components/ui/DomainBadges';
import { PageHeader } from '../../components/ui/PageHeader';
import { SubNav } from '../../components/ui/SubNav';
import { useToast } from '../../components/ui/ToastProvider';
import { SERVICE_REQUEST_TABS } from '../../config/navigation';
import { ApiError } from '../../lib/api-client';
import { serviceRequestService } from '../../services/service-request.service';

/**
 * The statuses a request can still be taken in.
 *
 * These are the backend's `CLAIMABLE_STATUSES`. They are listed here to decide WHAT TO ASK
 * THE SERVER FOR — the list endpoint is paged, so fetching every status and discarding most
 * of it would let a busy month of completed work push the open queue off the page. They are
 * not a second opinion about who may claim: the claim endpoint re-asserts the status inside
 * its own atomic filter, so a row that goes stale between this read and the button press is
 * refused there rather than here.
 */
const OPEN_STATUSES: readonly ServiceRequestStatus[] = ['NEW', 'UNASSIGNED'];

/** One page per status is plenty for a queue nobody is holding; 100 is the server's cap. */
const PAGE_SIZE = 100;

/**
 * Work nobody holds.
 *
 * QUOTED FROM THE BACKEND, and both halves matter. `resolveAssignedWorkFilter` opens its
 * unclaimed branch with `{ assignedEmployees: { $size: 0 }, assignedTeam: null }`, and the
 * claim endpoint re-asserts exactly the same pair. A request that names only a TEAM is
 * somebody's work even though it names no individual, so testing the empty employee list
 * alone would drag every team-assigned job back into the open pool and offer a button the
 * server would then refuse.
 */
function isUnclaimed(row: ServiceRequestListItemDto): boolean {
  return row.assignedEmployees.length === 0 && row.assignedTeam === null;
}

/**
 * Нээлттэй ажил — the queue a technician takes their own work from.
 *
 * Separate from the request list because it answers a different question. The list is "what
 * is going on", filtered and paged and read by the office; this is "what can I pick up right
 * now", and every row on it is actionable. Gated on `service_request.claim`, the same key the
 * endpoint enforces, so the page and the button it offers agree about who may act.
 */
export function OpenServiceRequestsPage(): ReactElement {
  const navigate = useNavigate();
  const { notify } = useToast();

  const [rows, setRows] = useState<ServiceRequestListItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /**
   * The request whose claim is in flight, or null.
   *
   * An id rather than a boolean so only the row being taken is disabled, and a single value
   * rather than a set because claiming is deliberately one at a time — see `claim` below.
   */
  const [claimingId, setClaimingId] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    try {
      // One call per claimable status, in parallel, because the list endpoint takes a single
      // status rather than a set. The technician scope on the server already narrows this to
      // their own work plus the unclaimed pool.
      const pages = await Promise.all(
        OPEN_STATUSES.map((status) =>
          serviceRequestService.list({
            status,
            limit: PAGE_SIZE,
            sortBy: 'slaDueAt',
            sortDir: 'asc',
          }),
        ),
      );

      setRows(pages.flatMap((page) => page.items).filter(isUnclaimed));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Нээлттэй ажил ачаалж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Takes one request, then re-reads the queue.
   *
   * ONE AT A TIME, AND GUARDED. The backend orders concurrent claims with a single atomic
   * write and answers the loser 409, so a UI that let a second click race the first would be
   * inviting a refusal it could have prevented: the guard below and the per-row `disabled`
   * are what stop the same person double-claiming or firing at two rows at once.
   *
   * Refetched rather than spliced. A successful claim moves the request to ASSIGNED and puts
   * the caller on it, so it is no longer unclaimed and leaves this list — but so may rows
   * OTHER people claimed while this page sat open, and only the server knows which. Removing
   * just the one row would leave the rest of the queue stale.
   */
  async function claim(row: ServiceRequestListItemDto): Promise<void> {
    if (claimingId !== null) return;

    setClaimingId(row.id);
    try {
      await serviceRequestService.claim(row.id);
      notify(`${row.requestNumber} ажлыг өөртөө авлаа.`, 'success');
    } catch (caught) {
      // The server decides who wins a race, and it says so in words meant for the reader —
      // "somebody else already took this". Inventing a message here would be a second
      // opinion about an outcome only the server observed.
      notify(caught instanceof ApiError ? caught.message : 'Ажил авч чадсангүй.', 'error');
    } finally {
      setClaimingId(null);
      await load();
    }
  }

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
    { key: 'status', header: 'Төлөв', render: (row) => <RequestStatusBadge status={row.status} stage={row.stage} /> },
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
      /*
       * A BUTTON RATHER THAN THE USUAL `RowActions` MENU, ON PURPOSE.
       *
       * Every other action column in this app hides its actions behind a dropdown, which is
       * right when a row has several and none of them is the point of the screen. Here there
       * is exactly one action and it IS the point of the screen — the whole page exists so a
       * technician can take work — so burying it behind a menu would add a click to every
       * claim. It is also the only shape that can report itself busy: a claim is a race the
       * server settles, so the row has to show that this one is in flight, and a `menuitem`
       * has nowhere to put a spinner. The mobile app's open-request card is the same button
       * with the same label for the same reason.
       */
      key: 'actions',
      header: 'Үйлдэл',
      align: 'right',
      render: (row) => (
        <Button
          size="sm"
          loading={claimingId === row.id}
          // Every row is closed while any claim is in flight, not just the one being taken:
          // the guard in `claim` would refuse a second request anyway, and a button that
          // looks live but does nothing is worse than one that says it is busy.
          disabled={claimingId !== null && claimingId !== row.id}
          onClick={(event) => {
            // The row itself opens the request, which is not what this button is for.
            event.stopPropagation();
            void claim(row);
          }}
        >
          Өөртөө авах
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Нээлттэй ажил"
        description="Хариуцагчгүй хүсэлтүүд. Өөртөө авсан ажил тань энэ жагсаалтаас хасагдана."
        breadcrumbs={[
          { label: 'Нүүр', to: '/dashboard' },
          { label: 'Үйлчилгээний хүсэлт', to: '/service-requests' },
          { label: 'Нээлттэй ажил' },
        ]}
      />

      <SubNav items={SERVICE_REQUEST_TABS} />

      <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          numbering
          loading={loading}
          error={error}
          onRetry={() => void load()}
          ariaLabel="Нээлттэй ажил"
          emptyTitle="Нээлттэй ажил алга"
          emptyDescription="Хариуцагчгүй хүсэлт одоогоор байхгүй байна. Шинэ дуудлага ирвэл энд харагдана."
          onRowClick={(row) => navigate(`/service-requests/${row.id}`)}
        />
      </div>
    </>
  );
}
