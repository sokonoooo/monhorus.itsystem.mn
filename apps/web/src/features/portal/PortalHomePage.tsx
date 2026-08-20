import {
  PERMISSIONS,
  PLANNED_WORK_STATUS_LABELS,
  type BuildingDto,
  type ServiceRequestListItemDto,
  type SurveyPendingItemDto,
} from '@monhorus/shared';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Button } from '../../components/ui/Button';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/States';
import { useAuth } from '../../contexts/auth-context';
import { ApiError } from '../../lib/api-client';
import { portalService } from '../../services/portal.service';
import { PortalStatusBadge } from './PortalBadges';
import {
  BarChart,
  CHARTED_WORK_STATUSES,
  riskHeadline,
  riskSlices,
  unassessedTotal,
  workSlices,
} from './PortalCharts';

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
  const canSubmitSurvey = can(PERMISSIONS.PORTAL_SURVEY_SUBMIT);

  const [recent, setRecent] = useState<ServiceRequestListItemDto[] | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const [buildings, setBuildings] = useState<BuildingDto[] | null>(null);
  const [workTotals, setWorkTotals] = useState<Record<string, number> | null>(null);
  const [pendingSurveys, setPendingSurveys] = useState<SurveyPendingItemDto[]>([]);
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

  /**
   * The two charts' data.
   *
   * Both are counts the server already publishes. The risk bands come off each building's
   * own `riskSummary`, summed here; the work totals are read as `total` from one-row
   * queries per status, which is exact whatever the page size is — counting a fetched page
   * would understate every figure the moment a customer has more work than fits on one.
   *
   * Neither failure takes the page down: the screen's job is the request list above, and a
   * chart that cannot load should leave a gap, not an error.
   */
  useEffect(() => {
    if (!canSeeSites) return undefined;
    let cancelled = false;
    portalService
      .listBuildings({ page: 1, limit: 100 })
      .then((page) => {
        if (!cancelled) setBuildings([...page.items]);
      })
      .catch(() => {
        if (!cancelled) setBuildings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canSeeSites]);

  useEffect(() => {
    if (!canRequestWork) return undefined;
    let cancelled = false;
    void Promise.all(
      CHARTED_WORK_STATUSES.map(async (status) => {
        try {
          const page = await portalService.listPlannedWork({ page: 1, limit: 1, status });
          return [status, page.total] as const;
        } catch {
          return [status, 0] as const;
        }
      }),
    ).then((entries) => {
      if (!cancelled) setWorkTotals(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [canRequestWork]);

  /**
   * The requests still waiting on this customer's verdict.
   *
   * Behind the permission because the endpoint is: `/surveys/pending` requires
   * `portal.survey.submit`, so an account without it would be answered 403 and the prompt
   * would render an error where there is no problem. A failure is silent for the same
   * reason the charts' are — the page's job is the request list, and a prompt that cannot
   * load should leave no trace rather than an error.
   *
   * Filtered on an OUTSTANDING technician rather than on the item's presence: the list is a
   * snapshot and the phone may have answered since, and a prompt shown to somebody with
   * nothing left to answer is worse than no prompt.
   */
  useEffect(() => {
    if (!canSubmitSurvey) return undefined;
    let cancelled = false;
    portalService
      .pendingSurveys()
      .then((items) => {
        if (cancelled) return;
        setPendingSurveys(
          items.filter((item) =>
            item.employees.some((entry) => !entry.isRated && !entry.isSkipped),
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setPendingSurveys([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canSubmitSurvey]);

  const firstSurvey = pendingSurveys[0];

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
        {/*
          The survey prompt, first because it is the only thing on this page that asks
          something OF the customer rather than telling them something. It names one request
          and links straight to its form; the rest are counted, not listed, because a home
          screen that turns into a queue of chores is one nobody opens twice.

          Not an `Alert`: this is a standing invitation on a landing page, not a notice about
          a failure, and the two should not look alike.
        */}
        {firstSurvey && (
          <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <p className="text-sm font-semibold text-slate-900">Үйлчилгээгээ үнэлнэ үү</p>
            <p className="mt-1 text-sm text-slate-700">
              {pendingSurveys.length === 1
                ? `${firstSurvey.buildingName ?? firstSurvey.requestNumber} дэх ажил дууслаа. Ажилтныг үнэлээрэй.`
                : `${firstSurvey.buildingName ?? firstSurvey.requestNumber} болон бусад ${pendingSurveys.length - 1} ажил үнэлгээ хүлээж байна.`}
            </p>
            <Button
              className="mt-3"
              onClick={() =>
                navigate(`/portal/requests/${firstSurvey.serviceRequestId}/survey`)
              }
            >
              Үнэлгээ өгөх
            </Button>
          </div>
        )}

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

        {/*
          The two charts, above the recent list because they answer the wider question
          first: a customer opens this to find out whether anything needs them, and only
          then which particular request it was.
        */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {canSeeSites && (
            <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <h2 className="text-sm font-semibold text-slate-900">Тоноглолын эрсдэл</h2>
              {/* Worst state first — the sentence, then the distribution behind it. */}
              <p className="mt-1 mb-4 text-sm text-slate-600">
                {buildings === null
                  ? 'Ачааллаж байна…'
                  : riskHeadline(riskSlices(buildings), unassessedTotal(buildings))}
              </p>
              {buildings === null ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <>
                  <BarChart
                    slices={riskSlices(buildings)}
                    emptyMessage="Тоноглолын үнэлгээ бүртгэгдээгүй байна."
                  />
                  {/*
                    Stated, not charted — see `riskSlices`. On one scale this number buries
                    every band a customer can act on.
                  */}
                  {unassessedTotal(buildings) > 0 && (
                    <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
                      Үнэлгээ хийгээгүй: {unassessedTotal(buildings)} тоноглол
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {canRequestWork && (
            <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <h2 className="text-sm font-semibold text-slate-900">Төлөвлөгөөт ажлын төлөв</h2>
              <p className="mt-1 mb-4 text-sm text-slate-600">
                Танай байгууллагын ажил төлөвөөр.
              </p>
              {workTotals === null ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <BarChart
                  slices={workSlices(workTotals, PLANNED_WORK_STATUS_LABELS)}
                  emptyMessage="Төлөвлөгөөт ажил бүртгэгдээгүй байна."
                />
              )}
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
