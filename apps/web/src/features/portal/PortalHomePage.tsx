import {
  PERMISSIONS,
  type BuildingDto,
  type FloorDto,
  type PortalSummaryDto,
  type ServiceRequestListItemDto,
  type SurveyPendingItemDto,
} from '@monhorus/shared';
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { Button } from '../../components/ui/Button';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/States';
import { riskLabelOf, riskLevelsInOrder, riskPaletteOf } from '../../components/ui/risk-palette';
import { STAGE_CHART_FILLS } from '../../components/ui/stage-palette';
import { useAuth } from '../../contexts/auth-context';
import { useRequestStages } from '../../hooks/use-request-stages';
import { useRiskBands } from '../../hooks/use-risk-bands';
import { ApiError } from '../../lib/api-client';
import { portalService } from '../../services/portal.service';
import { PortalStatusBadge } from './PortalBadges';
import { BuildingSilhouette } from './BuildingSilhouette';
import {
  DonutChart,
  StackedMonths,
  riskSlices,
  unassessedTotal,
  type Slice,
  type StackedMonth,
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

/**
 * How many buildings get drawn as a silhouette.
 *
 * Each one costs a floors request, so an estate of forty would fire forty on load. Six
 * covers the overwhelming majority in one screen; past that the card says how many it did
 * not draw and points at the list, because a truncation nobody is told about reads as
 * "that is all of them".
 */
const SILHOUETTE_LIMIT = 6;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' });
}

/** A card, in the chrome every panel in the product uses. */
function Panel({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: ReactElement | false;
  children: ReactElement | readonly ReactElement[];
}): ReactElement {
  return (
    <div className="flex h-full flex-col rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {hint && <p className="mt-0.5 text-xs leading-snug text-slate-500">{hint}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </div>
  );
}

/**
 * One headline number.
 *
 * The colour sits on a square beside the label rather than flooding the tile: four
 * saturated panels in a row compete with the charts beneath them, which are the part of
 * this page that actually carries the shape of the data.
 */
function Metric({
  label,
  value,
  note,
  fill,
  loading,
}: {
  label: string;
  value: number;
  note: string;
  fill: string;
  loading: boolean;
}): ReactElement {
  return (
    <div className="rounded-lg bg-slate-50 px-4 py-3 ring-1 ring-inset ring-slate-200">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: fill }} />
        <span className="truncate text-xs text-slate-600">{label}</span>
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-14" />
      ) : (
        <p className="mt-1.5 text-3xl font-semibold tabular-nums text-slate-900">{value}</p>
      )}
      <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{note}</p>
    </div>
  );
}

/**
 * The portal landing screen.
 *
 * Where a customer arrives after signing in, instead of the staff dashboard they are
 * forbidden from. It answers, in order: is anything wrong with my equipment, where is it,
 * what is outstanding, and how do I ask for something.
 *
 * It draws the SAME picture the rest of the product draws — the silhouette is the one from
 * the site pages and the mobile app, the bands are the operator's configured ladder, the
 * stages are the operator's configured grouping — so nothing here is a second opinion. The
 * only figures it does not read from a list endpoint are the two month series, which come
 * from `/portal/summary` because a page of records cannot be counted into a history
 * without understating it.
 */
export function PortalHomePage(): ReactElement {
  const navigate = useNavigate();
  const { user, can } = useAuth();

  const canCreate = can(PERMISSIONS.PORTAL_SERVICE_REQUEST_CREATE);
  const canSeeSites = can(PERMISSIONS.PORTAL_BUILDING_VIEW);
  const canRequestWork = can(PERMISSIONS.PORTAL_PLANNED_WORK_CREATE);
  const canSubmitSurvey = can(PERMISSIONS.PORTAL_SURVEY_SUBMIT);

  // The band names and hues the charts are drawn with, and the stage grouping the ring
  // folds statuses into — both the operator's, so a rename in Тохиргоо lands here too.
  const bands = useRiskBands();
  const stages = useRequestStages();

  const [recent, setRecent] = useState<ServiceRequestListItemDto[] | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const [buildings, setBuildings] = useState<BuildingDto[] | null>(null);
  const [floorsOf, setFloorsOf] = useState<Record<string, readonly FloorDto[]>>({});
  const [summary, setSummary] = useState<PortalSummaryDto | null>(null);
  const [pendingSurveys, setPendingSurveys] = useState<SurveyPendingItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
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
   * The buildings, and the floors of the first few.
   *
   * The floors are what the silhouette is drawn from — a building carries a roll-up but not
   * a per-floor standing, and the whole point of the drawing is which floor. Failures are
   * silent for the reason the charts' are: this screen's job is the request list, and a
   * picture that cannot load should leave a gap rather than an error.
   */
  useEffect(() => {
    if (!canSeeSites) return undefined;
    let cancelled = false;

    portalService
      .listBuildings({ page: 1, limit: 100 })
      .then(async (page) => {
        if (cancelled) return;
        setBuildings([...page.items]);

        const drawn = page.items.slice(0, SILHOUETTE_LIMIT);
        const loaded = await Promise.all(
          drawn.map(async (building) => {
            try {
              const floors = await portalService.listFloors(building.id, { page: 1, limit: 100 });
              return [building.id, floors.items] as const;
            } catch {
              return [building.id, [] as readonly FloorDto[]] as const;
            }
          }),
        );
        if (!cancelled) setFloorsOf(Object.fromEntries(loaded));
      })
      .catch(() => {
        if (!cancelled) setBuildings([]);
      });

    return () => {
      cancelled = true;
    };
  }, [canSeeSites]);

  useEffect(() => {
    let cancelled = false;
    portalService
      .summary()
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  /** Assessed equipment by band, and the two numbers the tiles quote from it. */
  const risk = useMemo(() => {
    const slices = buildings ? riskSlices(buildings, bands) : [];
    const ladder = riskLevelsInOrder(bands);
    // Best-first, so the head of the ladder is the healthy band and everything after it is
    // something a customer can act on. Reading the ladder rather than naming a level keeps
    // this correct when an administrator re-cuts or renames the bands.
    const healthyKey = ladder[0];
    const healthy = slices.find((slice) => slice.key === healthyKey)?.count ?? 0;
    const total = slices.reduce((sum, slice) => sum + slice.count, 0);
    return { slices, healthy, attention: total - healthy, total };
  }, [buildings, bands]);

  /** Requests folded into the operator's stages, so the ring names what the badges name. */
  const stageSlices = useMemo((): Slice[] => {
    if (!summary) return [];
    const counts = new Map(summary.requestsByStatus.map((row) => [row.status, row.count]));
    return stages
      .filter((stage) => !stage.hidden)
      .map((stage) => ({
        key: stage.key,
        label: stage.label,
        count: stage.statuses.reduce((sum, status) => sum + (counts.get(status) ?? 0), 0),
        fill: STAGE_CHART_FILLS[stage.colour],
      }))
      .filter((slice) => slice.count > 0);
  }, [summary, stages]);

  const requestTotal = stageSlices.reduce((sum, slice) => sum + slice.count, 0);

  /**
   * The band history, healthy band dropped.
   *
   * On a real estate the healthy band is the overwhelming majority, and stacked against it
   * every band a customer can act on collapses into the top few pixels — the same reason
   * the bar chart leaves UNASSESSED off.
   */
  const riskMonths = useMemo((): StackedMonth[] => {
    if (!summary?.riskByMonth) return [];
    const healthyKey = riskLevelsInOrder(bands)[0];
    return summary.riskByMonth.map((entry) => ({
      month: entry.month,
      parts: entry.counts
        .filter((row) => row.level !== healthyKey)
        .map((row) => ({
          key: row.level,
          label: riskLabelOf(row.level, bands),
          count: row.count,
          fill: riskPaletteOf(row.level, bands).fill,
        })),
    }));
  }, [summary, bands]);

  const drawnBuildings = (buildings ?? []).slice(0, SILHOUETTE_LIMIT);
  const undrawn = Math.max(0, (buildings?.length ?? 0) - drawnBuildings.length);

  return (
    <>
      <PageHeader
        title={user?.customerName ? `Сайн байна уу, ${user.customerName}` : 'Нүүр'}
        description={
          buildings && buildings.length > 0
            ? `${buildings.length} барилга · ${buildings.reduce((sum, item) => sum + item.floorCount, 0)} давхар · ${buildings.reduce((sum, item) => sum + item.objectCount, 0)} тоноглол`
            : 'Хүсэлтээ илгээж, явцыг нь хянана уу.'
        }
        actions={
          canCreate && (
            <Button onClick={() => navigate('/portal/requests/new')}>Шинэ хүсэлт</Button>
          )
        }
      />

      <div className="space-y-4">
        {/*
          The survey prompt, first because it is the only thing on this page that asks
          something OF the customer rather than telling them something.
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

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric
            label="Хүлээгдэж буй хүсэлт"
            value={openCount}
            note="Хаагдаагүй байгаа"
            fill="#2563eb"
            loading={loading}
          />
          {canSeeSites && (
            <>
              <Metric
                label="Анхаарах тоноглол"
                value={risk.attention}
                note={`Үнэлэгдсэн ${risk.total} тоноглолоос`}
                fill="#ea580c"
                loading={buildings === null}
              />
              <Metric
                label="Хэвийн тоноглол"
                value={risk.healthy}
                note="Сүүлийн үзлэгээр"
                fill="#16a34a"
                loading={buildings === null}
              />
              <Metric
                label="Үнэлгээ хийгээгүй"
                value={buildings ? unassessedTotal(buildings) : 0}
                note="Үзлэг хийгдээгүй тоноглол"
                fill="#94a3b8"
                loading={buildings === null}
              />
            </>
          )}
        </div>

        {/*
          The building drawing, first among the panels: it is the only thing here that says
          WHERE, and a customer who sees a red floor stops reading the rest.
        */}
        {canSeeSites && (
          <Panel
            title="Барилгын харагдац"
            hint="Багана бүр нэг давхар. Өндөр нь давхрын байрлал, өнгө нь тухайн давхрын хамгийн муу эрсдэлийн түвшин."
            action={
              <Link
                to="/portal/sites"
                className="text-xs font-medium text-blue-600 hover:underline"
              >
                Бүгдийг харах
              </Link>
            }
          >
            {buildings === null ? (
              <Skeleton className="h-32 w-full" />
            ) : drawnBuildings.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">
                Барилга бүртгэгдээгүй байна.
              </p>
            ) : (
              <div className="space-y-5">
                <div className="grid grid-cols-1 gap-x-10 gap-y-6 xl:grid-cols-2">
                  {drawnBuildings.map((building) => (
                    <div key={building.id} className="min-w-0">
                      <div className="mb-2 flex items-baseline justify-between gap-3">
                        <Link
                          to={`/portal/sites/${building.id}`}
                          className="truncate text-sm font-medium text-slate-900 hover:underline"
                        >
                          {building.name}
                        </Link>
                        <span className="shrink-0 text-xs text-slate-500">
                          {building.floorCount} давхар · {building.objectCount} тоноглол
                        </span>
                      </div>
                      {floorsOf[building.id] === undefined ? (
                        <Skeleton className="h-24 w-full" />
                      ) : (
                        <BuildingSilhouette
                          floors={floorsOf[building.id] ?? []}
                          onSelect={(floor) => navigate(`/portal/floors/${floor.id}`)}
                        />
                      )}
                    </div>
                  ))}
                </div>
                {/*
                  Said out loud. A drawing that quietly stops at six reads as the whole
                  estate, and a customer would have no reason to look for the rest.
                */}
                {undrawn > 0 && (
                  <p className="border-t border-slate-100 pt-3 text-xs text-slate-500">
                    Өөр {undrawn} барилга зурагдаагүй байна.{' '}
                    <Link to="/portal/sites" className="font-medium text-blue-600 hover:underline">
                      Бүгдийг харах
                    </Link>
                  </p>
                )}
              </div>
            )}
          </Panel>
        )}

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {canSeeSites && (
            <Panel title="Тоноглолын эрсдэл" hint="Сүүлийн үзлэгийн оноогоор түвшин тогтоогдоно.">
              {buildings === null ? (
                <Skeleton className="h-32 w-full" />
              ) : (
                <>
                  <DonutChart
                    slices={risk.slices}
                    centreValue={risk.total}
                    centreLabel="тоноглол"
                    emptyMessage="Тоноглолын үнэлгээ бүртгэгдээгүй байна."
                  />
                  {unassessedTotal(buildings) > 0 && (
                    <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
                      Үнэлгээ хийгээгүй: {unassessedTotal(buildings)} тоноглол
                    </p>
                  )}
                </>
              )}
            </Panel>
          )}

          <Panel title="Хүсэлт үе шатаар" hint="Хүсэлт бүр үе шатны аль нэгэнд байрлана.">
            {summary === null ? (
              <Skeleton className="h-32 w-full" />
            ) : (
              <DonutChart
                slices={stageSlices}
                centreValue={requestTotal}
                centreLabel="нийт хүсэлт"
                emptyMessage="Хүсэлт бүртгэгдээгүй байна."
              />
            )}
          </Panel>
        </div>

        {canSeeSites && (
          <Panel
            title="Эрсдэлийн бүтэц"
            hint="Анхаарал шаардаж буй тоноглол сүүлийн зургаан сард."
          >
            {summary === null ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <StackedMonths
                months={riskMonths}
                emptyMessage="Анхаарал шаардсан тоноглол бүртгэгдээгүй байна."
              />
            )}
          </Panel>
        )}

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.5fr_1fr]">
          <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h2 className="text-sm font-semibold text-slate-900">Сүүлийн хүсэлтүүд</h2>
              <Link
                to="/portal/requests"
                className="text-xs font-medium text-blue-600 hover:underline"
              >
                Бүгдийг харах
              </Link>
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
                        <PortalStatusBadge status={item.status} stage={item.stage} />
                        <span className="text-xs text-slate-500">
                          {formatDate(item.createdAt)}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Panel title="Түргэн холбоос">
            <ul className="space-y-2">
              {canRequestWork && (
                <li>
                  <Link
                    to="/portal/planned-work/new"
                    className="block rounded-lg bg-slate-50 px-4 py-3 ring-1 ring-inset ring-slate-200 hover:bg-slate-100"
                  >
                    <span className="text-sm font-medium text-slate-900">
                      Төлөвлөгөөт ажлын хүсэлт
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      Урьдчилан сэргийлэх үзлэг, засвар
                    </span>
                  </Link>
                </li>
              )}
              {canSeeSites && (
                <li>
                  <Link
                    to="/portal/sites"
                    className="block rounded-lg bg-slate-50 px-4 py-3 ring-1 ring-inset ring-slate-200 hover:bg-slate-100"
                  >
                    <span className="text-sm font-medium text-slate-900">Барилга, тоноглол</span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      Давхрын төлөвлөгөө, тоноглолын байршил
                    </span>
                  </Link>
                </li>
              )}
              <li>
                <Link
                  to="/portal/requests"
                  className="block rounded-lg bg-slate-50 px-4 py-3 ring-1 ring-inset ring-slate-200 hover:bg-slate-100"
                >
                  <span className="text-sm font-medium text-slate-900">Хүсэлтийн түүх</span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    Бүх хүсэлт, төлөв, шүүлт
                  </span>
                </Link>
              </li>
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
