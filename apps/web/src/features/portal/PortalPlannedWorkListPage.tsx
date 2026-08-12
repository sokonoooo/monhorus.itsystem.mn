import {
  PERMISSIONS,
  type PlannedWorkListItemDto,
} from '@monhorus/shared';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '../../components/ui/Button';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { PageHeader } from '../../components/ui/PageHeader';
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
 * business, and the row here is deliberately read-only — every write path on planned work
 * except creation is keyed on a `planned_work.*` permission no customer holds.
 */
export function PortalPlannedWorkListPage(): ReactElement {
  const navigate = useNavigate();
  const { can } = useAuth();

  const canCreate = can(PERMISSIONS.PORTAL_PLANNED_WORK_CREATE);

  const [items, setItems] = useState<PlannedWorkListItemDto[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const result = await portalService.listPlannedWork({ page: 1, limit: 50 });
      setItems([...result.items]);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Ажил ачаалж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
    <>
      <PageHeader
        title="Төлөвлөгөөт ажил"
        description="Танай байгууллагад хийгдэх төлөвлөгөөт ажил, хүсэлтүүд."
        actions={
          canCreate && (
            <Button onClick={() => navigate('/portal/planned-work/new')}>Шинэ хүсэлт</Button>
          )
        }
      />

      <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <DataTable
          columns={columns}
          rows={items ?? []}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          onRetry={() => void load()}
          onRowClick={(row) => navigate(`/portal/planned-work/${row.id}`)}
          emptyTitle="Ажил байхгүй"
          emptyDescription="Танай байгууллагад төлөвлөгөөт ажил бүртгэгдээгүй байна."
          emptyAction={
            canCreate ? (
              <Button size="sm" onClick={() => navigate('/portal/planned-work/new')}>
                Шинэ хүсэлт
              </Button>
            ) : undefined
          }
        />
      </div>
    </>
  );
}
