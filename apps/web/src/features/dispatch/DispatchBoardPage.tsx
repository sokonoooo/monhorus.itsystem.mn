import {
  PERMISSIONS,
  type DispatchBoardDto,
  type ServiceRequestListItemDto,
  type ServiceRequestStatus,
} from '@monhorus/shared';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '../../components/ui/Button';
import { SlaBadge } from '../../components/ui/DomainBadges';
import { PageHeader } from '../../components/ui/PageHeader';
import { SubNav } from '../../components/ui/SubNav';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/States';
import { STAGE_DOT_STYLES } from '../../components/ui/stage-palette';
import { SERVICE_REQUEST_TABS } from '../../config/navigation';
import { useAuth } from '../../contexts/auth-context';
import { ApiError } from '../../lib/api-client';
import { dispatchService } from '../../services/service-request.service';
import { AssignDrawer } from './AssignDrawer';

/**
 * Dispatch board.
 *
 * A card opens the request detail, and offers an assign action when the caller holds
 * dispatch.assign and the request's own status is one where assignment still means
 * something. Columns come from the server as descriptors, so a column may cover more
 * than one status and the board never re-derives the grouping itself.
 * Status transitions happen only on the detail page, through the validated backend
 * transition service.
 *
 * Drag and drop is deliberately not implemented: moving a card is not authorisation
 * to change a status, and both actions here are already keyboard accessible.
 */
function RequestCard({
  request,
  onOpen,
  onAssign,
}: {
  request: ServiceRequestListItemDto;
  onOpen: () => void;
  onAssign: (() => void) | null;
}): ReactElement {
  return (
    <div className="rounded-lg bg-white p-2.5 shadow-sm ring-1 ring-slate-200 transition-shadow hover:shadow">
      <button
        type="button"
        onClick={onOpen}
        className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
      >
      <span className="mb-1 block truncate text-xs font-semibold text-slate-900">
        {request.requestNumber}
      </span>
      <p className="mb-1 truncate text-xs text-slate-600">{request.customer?.name ?? '-'}</p>
      <p className="mb-1.5 truncate text-[11px] text-slate-500">
        {[request.building?.name, request.floor?.name].filter(Boolean).join(' · ') || '-'}
      </p>
      <SlaBadge state={request.slaState} remainingMinutes={request.slaRemainingMinutes} />
        {request.assignedEmployees.length > 0 && (
          <p className="mt-1.5 truncate text-[11px] text-slate-500">
            {request.assignedEmployees
              .map((employee) => `${employee.lastName} ${employee.firstName}`)
              .join(', ')}
          </p>
        )}
      </button>

      {onAssign && (
        <button
          type="button"
          onClick={onAssign}
          className="mt-2 w-full rounded-md bg-slate-900 px-2 py-1 text-[11px] font-medium text-white hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
        >
          {request.assignedEmployees.length > 0 || request.assignedTeam
            ? 'Дахин хуваарилах'
            : 'Хуваарилах'}
        </button>
      )}
    </div>
  );
}

/**
 * The two statuses a request can no longer be assigned from.
 *
 * Keyed off the card's own status, not its column: the open column holds both NEW and
 * UNASSIGNED, so a column-level test could not say "assignable" for one and not the
 * other.
 *
 * STATED AS A REFUSAL, BECAUSE THAT IS HOW THE SERVER STATES IT. This was a six-status
 * whitelist — NEW through ACCEPTED, plus RETURNED and REVISIT_REQUIRED — while
 * `assignServiceRequest` rejects exactly COMPLETED and CANCELLED and accepts everything
 * else. The six statuses in between were the ones a handover is actually NEEDED in: a
 * technician who is ON_THE_WAY, ON_SITE, IN_PROGRESS, WAITING, whose report is with the
 * office, or whose job is in VERIFICATION. None of those cards had the control, and the
 * detail page has none either, so a technician calling in sick mid-job could not be
 * replaced from anywhere in the product — an in-flight job could only be cancelled and
 * raised again, losing its history and its SLA clock.
 *
 * A whitelist and a blacklist are not interchangeable here. The whitelist had to be
 * widened by hand every time the workflow grew and silently withheld an action when
 * nobody did; this one says the same thing the API says, so the board can only be wrong
 * about a status if the API changes which ones it refuses.
 */
const UNASSIGNABLE_STATUSES = new Set<ServiceRequestStatus>(['COMPLETED', 'CANCELLED']);

/** Whether a dispatcher may still hand this request to somebody else. */
function isAssignable(status: ServiceRequestStatus): boolean {
  return !UNASSIGNABLE_STATUSES.has(status);
}

export function DispatchBoardPage(): ReactElement {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [assignTarget, setAssignTarget] = useState<ServiceRequestListItemDto | null>(null);

  const [board, setBoard] = useState<DispatchBoardDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setBoard(await dispatchService.board());
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Dispatch board ачаалж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageHeader
        title="Dispatch board"
        breadcrumbs={[{ label: 'Нүүр', to: '/dashboard' }, { label: 'Dispatch board' }]}
        actions={
          <Button variant="secondary" onClick={() => void load()} loading={loading}>
            Шинэчлэх
          </Button>
        }
      />

      <SubNav items={SERVICE_REQUEST_TABS} />

      {loading && !board && (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-64 w-64 shrink-0" />
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-xl bg-white ring-1 ring-slate-200">
          <ErrorState
            description={error}
            action={
              <Button size="sm" variant="secondary" onClick={() => void load()}>
                Дахин оролдох
              </Button>
            }
          />
        </div>
      )}

      {!error && board && (
        <>
          {board.columns.every((column) => column.total === 0) ? (
            <div className="rounded-xl bg-white ring-1 ring-slate-200">
              <EmptyState
                title="Идэвхтэй хүсэлт байхгүй"
                description="Одоогоор хуваарилах шаардлагатай үйлчилгээний хүсэлт алга."
              />
            </div>
          ) : (
            // Horizontal scroll lives inside this container; the page never scrolls sideways.
            <div className="flex gap-3 overflow-x-auto pb-3">
              {board.columns.map((column) => (
                <section
                  key={column.id}
                  className="flex w-64 shrink-0 flex-col rounded-xl bg-slate-200/50 p-2"
                  aria-label={column.label}
                >
                  <header className="mb-2 flex items-center justify-between gap-2 px-1">
                    <h2 className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-slate-700">
                      {/*
                        The stage's own colour, sent with the column. Painted here so a
                        column heading and the badge on the same request in the list read as
                        the same step; omitted rather than defaulted when the server sends
                        no colour, since a made-up one would say something untrue.
                      */}
                      {column.colour && (
                        <span
                          aria-hidden
                          className={`h-2 w-2 shrink-0 rounded-full ${STAGE_DOT_STYLES[column.colour]}`}
                        />
                      )}
                      <span className="truncate">{column.label}</span>
                    </h2>
                    <span className="shrink-0 rounded-full bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                      {column.total}
                    </span>
                  </header>

                  <div className="flex max-h-[calc(100vh-16rem)] flex-col gap-2 overflow-y-auto">
                    {column.items.length === 0 ? (
                      <p className="px-1 py-6 text-center text-[11px] text-slate-500">
                        Хоосон
                      </p>
                    ) : (
                      column.items.map((item) => (
                        <RequestCard
                          key={item.id}
                          request={item}
                          onOpen={() => navigate(`/service-requests/${item.id}`)}
                          onAssign={
                            can(PERMISSIONS.DISPATCH_ASSIGN) &&
                            isAssignable(item.status)
                              ? () => setAssignTarget(item)
                              : null
                          }
                        />
                      ))
                    )}

                    {column.total > column.items.length && (
                      <p className="px-1 py-1 text-center text-[11px] text-slate-500">
                        Дээрх {column.items.length} нь эхний хэсэг. Нийт {column.total}.
                      </p>
                    )}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      <AssignDrawer
        request={assignTarget}
        onClose={() => setAssignTarget(null)}
        onAssigned={() => void load()}
      />
    </>
  );
}
