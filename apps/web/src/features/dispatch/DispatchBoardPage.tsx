import {
  PERMISSIONS,
  type DispatchBoardDto,
  type ServiceRequestListItemDto,
  type ServiceRequestStatus,
} from '@monhorus/shared';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '../../components/ui/Button';
import { SlaBadge, UrgentBadge } from '../../components/ui/DomainBadges';
import { PageHeader } from '../../components/ui/PageHeader';
import { SubNav } from '../../components/ui/SubNav';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/States';
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
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="truncate text-xs font-semibold text-slate-900">
          {request.requestNumber}
        </span>
        {request.isUrgent && <UrgentBadge />}
      </div>
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
 * Statuses where assignment is still meaningful.
 *
 * Keyed off the card's own status, not its column: the open column holds both NEW and
 * UNASSIGNED, so a column-level test could not say "assignable" for one and not the
 * other. NEW belongs here — the backend promotes NEW straight to ASSIGNED on assign
 * (assignServiceRequest), so a NEW card without the button was an unreachable action.
 */
const ASSIGNABLE_STATUSES = new Set<ServiceRequestStatus>([
  'NEW',
  'UNASSIGNED',
  'ASSIGNED',
  'ACCEPTED',
  'RETURNED',
  'REVISIT_REQUIRED',
]);

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
                    <h2 className="truncate text-xs font-semibold text-slate-700">
                      {column.label}
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
                            ASSIGNABLE_STATUSES.has(item.status)
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
