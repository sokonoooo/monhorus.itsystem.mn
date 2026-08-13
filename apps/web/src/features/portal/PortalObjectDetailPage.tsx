import {
  PERMISSIONS,
  RISK_LEVEL_LABELS,
  type ObjectDetailDto,
} from '@monhorus/shared';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../../components/ui/PageHeader';
import { ErrorState, Skeleton } from '../../components/ui/States';
import { useAuth } from '../../contexts/auth-context';
import { ApiError } from '../../lib/api-client';
import { portalService } from '../../services/portal.service';

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' });
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
 * One piece of the customer's own equipment.
 *
 * NO HISTORY TIMELINE, DELIBERATELY. `GET /objects-master/:id/history` is gated on the
 * staff key `object_master.view`, and its own route comment says why it is staff-only: the
 * timeline folds in audit rows, internal service-request detail and deep links into staff
 * modules, and its report rows carry no status filter at all — so it would show findings
 * from reports still being reviewed. The Flutter customer app hides that section for the
 * same reason. This page shows the latest signed-off finding and stops there.
 */
export function PortalObjectDetailPage(): ReactElement {
  const { buildingId, floorId, objectId } = useParams<{
    buildingId: string;
    floorId: string;
    objectId: string;
  }>();
  const navigate = useNavigate();
  const { can } = useAuth();

  const canRaise = can(PERMISSIONS.PORTAL_SERVICE_REQUEST_CREATE);

  const [object, setObject] = useState<ObjectDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!objectId) return;
    setLoading(true);
    setError(null);
    try {
      setObject(await portalService.getObject(objectId));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Тоноглол ачаалж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }, [objectId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  if (error || !object) {
    return (
      <ErrorState
        description={error ?? 'Тоноглол олдсонгүй.'}
        action={<Button onClick={() => void load()}>Дахин оролдох</Button>}
      />
    );
  }

  const assessment = object.latestAssessment;
  const floorPath = `/portal/sites/${buildingId ?? ''}/floors/${floorId ?? ''}`;

  return (
    <>
      <PageHeader
        title={object.name}
        description={object.code}
        backTo={{ to: floorPath, label: 'Давхар руу буцах' }}
        breadcrumbs={[
          { label: 'Нүүр', to: '/portal' },
          { label: 'Миний барилга', to: '/portal/sites' },
          { label: 'Давхар', to: floorPath },
          { label: object.name },
        ]}
        actions={
          canRaise && (
            <Button
              variant="secondary"
              onClick={() =>
                navigate(
                  `/portal/requests/new?buildingId=${buildingId ?? ''}&floorId=${floorId ?? ''}`,
                )
              }
            >
              Хүсэлт илгээх
            </Button>
          )
        }
      />

      <div className="space-y-4">
        <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Row label="Код" value={object.code} />
            <Row label="Төрөл" value={object.objectType?.name ?? '-'} />
            <Row label="Давхар" value={object.floorName ?? '-'} />
          </dl>
        </div>

        <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Сүүлийн үнэлгээ</h2>

          {!assessment ? (
            <p className="text-sm text-slate-600">
              Энэ тоноглолд хараахан үнэлгээ хийгдээгүй байна.
            </p>
          ) : (
            <div className="space-y-4">
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <Row
                  label="Оноо"
                  value={assessment.score === null ? '-' : `${assessment.score}`}
                />
                <Row
                  label="Эрсдэлийн түвшин"
                  value={assessment.riskLevel ? RISK_LEVEL_LABELS[assessment.riskLevel] : '-'}
                />
                <Row label="Огноо" value={formatDateTime(assessment.assessedAt)} />
              </dl>

              {assessment.conclusion && (
                <div>
                  <p className="text-xs font-medium text-slate-500">Дүгнэлт</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">
                    {assessment.conclusion}
                  </p>
                </div>
              )}

              {assessment.recommendation && (
                <div>
                  <p className="text-xs font-medium text-slate-500">Зөвлөмж</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">
                    {assessment.recommendation}
                  </p>
                </div>
              )}

              {(assessment.repairRequired || assessment.revisitRequired) && (
                <Alert variant="warning">
                  {assessment.repairRequired && (
                    <span className="block">Засвар шаардлагатай.</span>
                  )}
                  {assessment.revisitRequired && (
                    <span className="block">
                      Дахин үзлэг шаардлагатай
                      {assessment.revisitDate
                        ? `: ${formatDateTime(assessment.revisitDate)}`
                        : ''}
                      .
                    </span>
                  )}
                </Alert>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
