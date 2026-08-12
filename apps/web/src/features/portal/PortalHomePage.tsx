import { PERMISSIONS, type ServiceRequestListItemDto } from '@monhorus/shared';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Button } from '../../components/ui/Button';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/States';
import { useAuth } from '../../contexts/auth-context';
import { ApiError } from '../../lib/api-client';
import { portalService } from '../../services/portal.service';
import { PortalStatusBadge, PortalUrgentBadge } from './PortalBadges';

/** Statuses a customer reads as "still open". Anything else is finished or abandoned. */
const OPEN_STATUSES = new Set([
  'NEW',
  'UNASSIGNED',
  'ASSIGNED',
  'ACCEPTED',
  'ON_THE_WAY',
  'ON_SITE',
  'IN_PROGRESS',
  'WAITING',
  'REPORT_SUBMITTED',
  'VERIFICATION',
  'REVISIT_REQUIRED',
]);

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' });
}

/**
 * The portal landing screen.
 *
 * Where a customer arrives after signing in, instead of the staff dashboard they are
 * forbidden from. It answers the two questions somebody opening this actually has — what is
 * outstanding, and how do I ask for something — and gets out of the way. It deliberately
 * does not attempt the staff dashboard's analytics: those are company-wide aggregates a
 * customer has no endpoint for and no business seeing.
 */
export function PortalHomePage(): ReactElement {
  const navigate = useNavigate();
  const { user, can } = useAuth();

  const canCreate = can(PERMISSIONS.PORTAL_SERVICE_REQUEST_CREATE);
  const canSeeSites = can(PERMISSIONS.PORTAL_BUILDING_VIEW);
  const canRequestWork = can(PERMISSIONS.PORTAL_PLANNED_WORK_CREATE);

  const [recent, setRecent] = useState<ServiceRequestListItemDto[] | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      // One page serves both the list and the count. A customer with more than 20 open
      // requests is better served by the list screen's filters than by a bigger number.
      const result = await portalService.listRequests({ page: 1, limit: 20 });
      setRecent([...result.items].slice(0, 5));
      setOpenCount(result.items.filter((item) => OPEN_STATUSES.has(item.status)).length);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Мэдээлэл ачаалж чадсангүй.');
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
        title={user?.customerName ? `Сайн байна уу, ${user.customerName}` : 'Нүүр'}
        description="Хүсэлтээ илгээж, явцыг нь хянана уу."
        actions={
          canCreate && (
            <Button onClick={() => navigate('/portal/requests/new')}>Шинэ хүсэлт</Button>
          )
        }
      />

      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <p className="text-xs font-medium text-slate-500">Хүлээгдэж буй хүсэлт</p>
            {loading ? (
              <Skeleton className="mt-2 h-8 w-16" />
            ) : (
              <p className="mt-1 text-2xl font-semibold text-slate-900">{openCount}</p>
            )}
            <Link
              to="/portal/requests"
              className="mt-2 inline-block text-xs font-medium text-blue-600 hover:underline"
            >
              Бүгдийг харах
            </Link>
          </div>

          {canRequestWork && (
            <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <p className="text-xs font-medium text-slate-500">Төлөвлөгөөт ажил</p>
              <p className="mt-1 text-sm text-slate-700">
                Урьдчилан сэргийлэх үзлэг, засварын хүсэлт илгээх. Батлагдсаны дараа ажилтан
                томилогдоно.
              </p>
              <Link
                to="/portal/planned-work/new"
                className="mt-2 inline-block text-xs font-medium text-blue-600 hover:underline"
              >
                Хүсэлт илгээх
              </Link>
            </div>
          )}

          {canSeeSites && (
            <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <p className="text-xs font-medium text-slate-500">Барилга, тоноглол</p>
              <p className="mt-1 text-sm text-slate-700">
                Давхрын төлөвлөгөө, тоноглолын байршил, үнэлгээ.
              </p>
              <Link
                to="/portal/sites"
                className="mt-2 inline-block text-xs font-medium text-blue-600 hover:underline"
              >
                Харах
              </Link>
            </div>
          )}
        </div>

        <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="border-b border-slate-200 px-5 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Сүүлийн хүсэлтүүд</h2>
          </div>

          {loading && (
            <div className="space-y-2 p-4" role="status" aria-label="Ачааллаж байна">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}

          {!loading && error && (
            <ErrorState
              description={error}
              action={
                <Button size="sm" variant="secondary" onClick={() => void load()}>
                  Дахин оролдох
                </Button>
              }
            />
          )}

          {!loading && !error && recent?.length === 0 && (
            <EmptyState
              title="Хүсэлт байхгүй"
              description="Танай байгууллага одоогоор хүсэлт илгээгээгүй байна."
              action={
                canCreate ? (
                  <Button size="sm" onClick={() => navigate('/portal/requests/new')}>
                    Шинэ хүсэлт
                  </Button>
                ) : undefined
              }
            />
          )}

          {!loading && !error && recent && recent.length > 0 && (
            <ul className="divide-y divide-slate-100">
              {recent.map((item) => (
                <li key={item.id}>
                  <Link
                    to={`/portal/requests/${item.id}`}
                    className="flex flex-wrap items-center gap-2 px-5 py-3 hover:bg-slate-50"
                  >
                    <span className="text-sm font-medium text-slate-900">
                      {item.requestNumber}
                    </span>
                    <span className="truncate text-xs text-slate-500">
                      {[item.building?.name, item.floor?.name].filter(Boolean).join(' · ')}
                    </span>
                    <span className="ml-auto flex items-center gap-2">
                      {item.isUrgent && <PortalUrgentBadge />}
                      <PortalStatusBadge status={item.status} />
                      <span className="text-xs text-slate-500">{formatDate(item.createdAt)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
