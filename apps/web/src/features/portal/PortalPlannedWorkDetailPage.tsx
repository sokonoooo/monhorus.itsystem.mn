import type { PlannedWorkDto } from '@monhorus/shared';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../../components/ui/PageHeader';
import { ErrorState, Skeleton } from '../../components/ui/States';
import { ApiError } from '../../lib/api-client';
import { portalService } from '../../services/portal.service';
import { PortalWorkStatusBadge } from './PortalBadges';

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' });
}

function Row({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800">{value}</dd>
    </div>
  );
}

/**
 * One planned work, as its customer sees it.
 *
 * Shows where the request stands and nothing about how the company runs it. In particular
 * it does not render the crew, the sub-task breakdown, the pause history or the lifecycle
 * actions — the staff detail screen exists for that and is keyed on permissions no customer
 * holds.
 *
 * NOTE THE LIMIT THIS LEAVES: `GET /planned-work/:id` still SENDS the staff payload. The
 * omissions here are a presentation choice, not a boundary. Narrowing that DTO server-side
 * would be a further backend change and is deliberately not part of this one; it is worth
 * doing before the portal carries anything more sensitive than a work's own schedule.
 */
export function PortalPlannedWorkDetailPage(): ReactElement {
  const { plannedWorkId } = useParams<{ plannedWorkId: string }>();

  const [work, setWork] = useState<PlannedWorkDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!plannedWorkId) return;
    setLoading(true);
    setError(null);
    try {
      setWork(await portalService.getPlannedWork(plannedWorkId));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Ажил ачаалж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }, [plannedWorkId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  if (error || !work) {
    return (
      <ErrorState
        description={error ?? 'Ажил олдсонгүй.'}
        action={<Button onClick={() => void load()}>Дахин оролдох</Button>}
      />
    );
  }

  return (
    <>
      <PageHeader
        title={work.title}
        description={work.workNumber}
        backTo={{ to: '/portal/planned-work', label: 'Төлөвлөгөөт ажил руу буцах' }}
        breadcrumbs={[
          { label: 'Нүүр', to: '/portal' },
          { label: 'Төлөвлөгөөт ажил', to: '/portal/planned-work' },
          { label: work.workNumber },
        ]}
      />

      <div className="space-y-4">
        {/*
          The three states a customer actually acts on. Each says who is waiting on whom,
          rather than leaving them to infer it from a coloured chip.
        */}
        {work.lifecycleStatus === 'PENDING_APPROVAL' && (
          <Alert variant="warning" title="Батлахыг хүлээж байна">
            Хүсэлт хүлээн авсан. Эрх бүхий ажилтан хянаж байна — батлагдсаны дараа гүйцэтгэх
            ажилтан томилогдож, товлосон хугацаа баталгаажна.
          </Alert>
        )}

        {work.lifecycleStatus === 'CANCELLED' && (
          <Alert variant="error" title="Цуцлагдсан">
            {work.cancelReason ?? 'Энэ ажил цуцлагдсан байна.'}
          </Alert>
        )}

        {work.lifecycleStatus === 'PLANNED' && (
          <Alert variant="success" title="Батлагдсан">
            Ажил батлагдаж, төлөвлөгөөнд орлоо.
          </Alert>
        )}

        <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <div className="mb-4">
            <PortalWorkStatusBadge status={work.effectiveStatus} />
          </div>

          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Row label="Барилга" value={work.building?.name ?? '-'} />
            <Row label="Төсөл" value={work.project?.name ?? '-'} />
            <Row label="Эхлэх" value={formatDate(work.plannedStartDate)} />
            <Row label="Дуусах" value={formatDate(work.plannedEndDate)} />
            <Row label="Илгээсэн" value={formatDate(work.createdAt)} />
          </dl>

          {work.description && (
            <div className="mt-4">
              <p className="text-xs font-medium text-slate-500">Тайлбар</p>
              <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">
                {work.description}
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
