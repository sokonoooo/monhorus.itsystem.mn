import {
  PERMISSIONS,
  SERVICE_REQUEST_STATUSES,
  SERVICE_REQUEST_TRANSITIONS,
  type BuildingDto,
  type FloorDto,
  type PortalSummaryDto,
  type ServiceRequestListItemDto,
  type ServiceRequestStatus,
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
import { BUSINESS_TIME_ZONE } from '../../lib/business-day';
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

/**
 * Statuses a customer reads as "still open".
 *
 * DERIVED, NOT LISTED. This used to be eleven names typed out by hand, and it had already
 * drifted: `RETURNED` was missing. A returned request is a write-up the office sent back —
 * the job is unfinished and somebody is still on it — so the customer's own open list
 * dropped it while work continued, which reads as "finished" rather than as an omission.
 *
 * The transition map answers the question the hand-written set was trying to: a status with
 * nowhere left to go is where a request comes to rest, and everything else is somewhere it
 * is passing through. Today that terminal pair is COMPLETED and CANCELLED. A status added
 * to the workflow tomorrow lands on the correct side of this line without anyone
 * remembering that this file exists, which is the whole reason it is computed.
 */
const OPEN_STATUSES: ReadonlySet<ServiceRequestStatus> = new Set(
  SERVICE_REQUEST_STATUSES.filter((status) => SERVICE_REQUEST_TRANSITIONS[status].length > 0),
);

/**
 * How many buildings get drawn as a silhouette.
 *
 * Each one costs a floors request, so an estate of forty would fire forty on load. Six
 * covers the overwhelming majority in one screen; past that the card says how many it did
 * not draw and points at the list, because a truncation nobody is told about reads as
 * "that is all of them".
 */
const SILHOUETTE_LIMIT = 6;

/**
 * THREE ANSWERS, NEVER TWO.
 *
 * Every fetch on this screen used to be held as `T | null`, where `null` meant "still
 * loading" — and every failure handler set it to `[]` or back to `null`. So a rejected
 * buildings request became an EMPTY ESTATE: the tiles' `loading` predicate flipped false
 * and «Анхаарах тоноглол» printed a hard 0. A customer with a genuinely critical floor read
 * a clean bill of health off a transport error, which is the one thing this product must
 * never do — it may show an absence, it may not invent an all-clear.
 *
 * Failure is now a state of its own, so the render has to answer for it. Nothing here
 * prints a figure while `failed`.
 */
type Loaded<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'failed' }
  | { readonly status: 'ready'; readonly data: T };

const LOADING = { status: 'loading' } as const;
const FAILED = { status: 'failed' } as const;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('mn-MN', { timeZone: BUSINESS_TIME_ZONE });
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
  failed = false,
}: {
  label: string;
  value: number;
  note: string;
  fill: string;
  loading: boolean;
  /** The figure could not be read. A dash is printed, NEVER a number. */
  failed?: boolean;
}): ReactElement {
  return (
    <div className="rounded-lg bg-slate-50 px-4 py-3 ring-1 ring-inset ring-slate-200">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: fill }} />
        <span className="truncate text-xs text-slate-600">{label}</span>
      </div>
      {failed ? (
        // Hidden from the reader-out because it says nothing on its own; the note beneath
        // carries the meaning, and neither of them is a quantity.
        <p aria-hidden="true" className="mt-1.5 text-3xl font-semibold text-slate-300">
          —
        </p>
      ) : loading ? (
        <Skeleton className="mt-2 h-8 w-14" />
      ) : (
        <p className="mt-1.5 text-3xl font-semibold tabular-nums text-slate-900">{value}</p>
      )}
      <p className="mt-0.5 text-[11px] leading-snug text-slate-500">
        {failed ? 'Ачаалж чадсангүй' : note}
      </p>
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
  const [buildings, setBuildings] = useState<Loaded<readonly BuildingDto[]>>(LOADING);
  const [floorsOf, setFloorsOf] = useState<Record<string, Loaded<readonly FloorDto[]>>>({});
  const [summary, setSummary] = useState<Loaded<PortalSummaryDto>>(LOADING);
  const [pendingSurveys, setPendingSurveys] = useState<Loaded<readonly SurveyPendingItemDto[]>>(
    LOADING,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Bumped by the retry affordances. Each fetch reruns on its own counter so pressing
  // «Дахин оролдох» on one panel does not blank the two beside it that loaded fine.
  const [buildingsAttempt, setBuildingsAttempt] = useState(0);
  const [summaryAttempt, setSummaryAttempt] = useState(0);
  const [surveysAttempt, setSurveysAttempt] = useState(0);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      // Twenty, because five are drawn and the rest is headroom for the list link. This
      // page NEVER counts anything off this call: a page of records cannot be counted into
      // a total without understating it, and the tile above reads `/portal/summary`.
      const result = await portalService.listRequests({ page: 1, limit: 20 });
      setRecent([...result.items].slice(0, 5));
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
   * a per-floor standing, and the whole point of the drawing is which floor.
   *
   * A failure is STATED. It used to be swallowed into an empty estate on the grounds that
   * this screen's job is the request list, but the three equipment tiles are read off this
   * call, and «0 анхаарах тоноглол» is not a gap — it is an all-clear the server never gave.
   * The inner floors call is failed per building for the same reason: a card that says
   * «12 давхар» over «давхар бүртгэгдээгүй» is telling the customer two different things.
   */
  useEffect(() => {
    if (!canSeeSites) return undefined;
    let cancelled = false;
    setBuildings(LOADING);
    setFloorsOf({});

    portalService
      .listBuildings({ page: 1, limit: 100 })
      .then(async (page) => {
        if (cancelled) return;
        setBuildings({ status: 'ready', data: page.items });

        const drawn = page.items.slice(0, SILHOUETTE_LIMIT);
        const loaded = await Promise.all(
          drawn.map(async (building) => {
            try {
              const floors = await portalService.listFloors(building.id, { page: 1, limit: 100 });
              return [building.id, { status: 'ready', data: floors.items }] as const;
            } catch {
              return [building.id, FAILED] as const;
            }
          }),
        );
        if (!cancelled) setFloorsOf(Object.fromEntries(loaded));
      })
      .catch(() => {
        if (!cancelled) setBuildings(FAILED);
      });

    return () => {
      cancelled = true;
    };
  }, [canSeeSites, buildingsAttempt]);

  useEffect(() => {
    let cancelled = false;
    setSummary(LOADING);
    portalService
      .summary()
      .then((data) => {
        if (!cancelled) setSummary({ status: 'ready', data });
      })
      .catch(() => {
        // `null` used to mean both "loading" and "failed", so a rejected summary left the
        // three panels beneath spinning a skeleton for ever with nothing to press.
        if (!cancelled) setSummary(FAILED);
      });
    return () => {
      cancelled = true;
    };
  }, [summaryAttempt]);

  useEffect(() => {
    if (!canSubmitSurvey) return undefined;
    let cancelled = false;
    setPendingSurveys(LOADING);
    portalService
      .pendingSurveys()
      .then((items) => {
        if (cancelled) return;
        setPendingSurveys({
          status: 'ready',
          data: items.filter((item) =>
            item.employees.some((entry) => !entry.isRated && !entry.isSkipped),
          ),
        });
      })
      .catch(() => {
        // The card is the ONLY in-app route to the rating form, so a swallowed failure
        // removed the whole errand and said nothing.
        if (!cancelled) setPendingSurveys(FAILED);
      });
    return () => {
      cancelled = true;
    };
  }, [canSubmitSurvey, surveysAttempt]);

  const surveyList = pendingSurveys.status === 'ready' ? pendingSurveys.data : [];
  const firstSurvey = surveyList[0];

  /** Assessed equipment by band, and the two numbers the tiles quote from it. */
  const risk = useMemo(() => {
    const slices = buildings.status === 'ready' ? riskSlices(buildings.data, bands) : [];
    const ladder = riskLevelsInOrder(bands);
    // Best-first, so the head of the ladder is the healthy band and everything after it is
    // something a customer can act on. Reading the ladder rather than naming a level keeps
    // this correct when an administrator re-cuts or renames the bands.
    const healthyKey = ladder[0];
    const healthy = slices.find((slice) => slice.key === healthyKey)?.count ?? 0;
    const total = slices.reduce((sum, slice) => sum + slice.count, 0);
    return { slices, healthy, attention: total - healthy, total };
  }, [buildings, bands]);

  /**
   * How many requests are still open, across every one the organisation has.
   *
   * READ FROM THE SUMMARY, NOT FROM THE LIST. This tile used to count the open statuses
   * inside the twenty-record page fetched above, so a customer with sixty open requests was
   * shown twenty — and shown it as a fact, with no pager and nothing to suggest the figure
   * was the size of a page rather than the size of their workload. `requestsByStatus` is an
   * aggregate over every request the organisation has, which is the same source the stage
   * ring below already reads; the two now cannot disagree.
   */
  const openCount = useMemo((): number => {
    if (summary.status !== 'ready') return 0;
    return summary.data.requestsByStatus
      .filter((row) => OPEN_STATUSES.has(row.status))
      .reduce((sum, row) => sum + row.count, 0);
  }, [summary]);

  /** Requests folded into the operator's stages, so the ring names what the badges name. */
  const stageSlices = useMemo((): Slice[] => {
    if (summary.status !== 'ready') return [];
    const counts = new Map(summary.data.requestsByStatus.map((row) => [row.status, row.count]));
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
    if (summary.status !== 'ready' || !summary.data.riskByMonth) return [];
    const healthyKey = riskLevelsInOrder(bands)[0];
    return summary.data.riskByMonth.map((entry) => ({
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

  const buildingList = buildings.status === 'ready' ? buildings.data : [];
  const drawnBuildings = buildingList.slice(0, SILHOUETTE_LIMIT);
  const undrawn = Math.max(0, buildingList.length - drawnBuildings.length);
  const unassessed = buildings.status === 'ready' ? unassessedTotal(buildings.data) : 0;

  /** The retry every failed panel offers, in the chrome the error panels already use. */
  function retry(onRetry: () => void): ReactElement {
    return (
      <Button size="sm" variant="secondary" onClick={onRetry}>
        Дахин оролдох
      </Button>
    );
  }

  /**
   * One building's drawing — or what happened instead.
   *
   * Three outcomes, because the floors call has three: not back yet, refused, and answered.
   * The refused case is NOT the empty one: `BuildingSilhouette` prints «давхар
   * бүртгэгдээгүй» for an empty list, and printing that under a card headed «12 давхар» is
   * a contradiction the customer has to resolve on their own.
   */
  function silhouetteFor(building: BuildingDto): ReactElement {
    const floors = floorsOf[building.id];
    if (floors === undefined || floors.status === 'loading') {
      return <Skeleton className="h-24 w-full" />;
    }
    if (floors.status === 'failed') {
      return (
        <p className="py-6 text-center text-sm text-slate-500">
          Давхрын мэдээлэл ачаалж чадсангүй.
        </p>
      );
    }
    return (
      <BuildingSilhouette
        floors={floors.data}
        // The route the router actually declares. This pointed at `/portal/floors/:id`,
        // which nothing in the product serves, so every click on the drawing — the one
        // element on this screen that says WHERE — landed on the not-found page.
        onSelect={(floor) => navigate(`/portal/sites/${building.id}/floors/${floor.id}`)}
      />
    );
  }

  return (
    <>
      <PageHeader
        title={user?.customerName ? `Сайн байна уу, ${user.customerName}` : 'Нүүр'}
        description={
          buildingList.length > 0
            ? `${buildingList.length} барилга · ${buildingList.reduce((sum, item) => sum + item.floorCount, 0)} давхар · ${buildingList.reduce((sum, item) => sum + item.objectCount, 0)} тоноглол`
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
        {pendingSurveys.status === 'failed' && (
          <div
            role="alert"
            className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200"
          >
            <p className="text-sm font-semibold text-red-700">
              Үнэлгээний жагсаалт ачаалж чадсангүй
            </p>
            <p className="mt-1 text-sm text-slate-700">
              Үнэлгээ хүлээж буй ажил байгаа эсэхийг тодорхойлж чадсангүй. Дахин оролдоно уу.
            </p>
            <div className="mt-3">{retry(() => setSurveysAttempt((n) => n + 1))}</div>
          </div>
        )}

        {firstSurvey && (
          <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <p className="text-sm font-semibold text-slate-900">Үйлчилгээгээ үнэлнэ үү</p>
            <p className="mt-1 text-sm text-slate-700">
              {surveyList.length === 1
                ? `${firstSurvey.buildingName ?? firstSurvey.requestNumber} дэх ажил дууслаа. Ажилтныг үнэлээрэй.`
                : `${firstSurvey.buildingName ?? firstSurvey.requestNumber} болон бусад ${surveyList.length - 1} ажил үнэлгээ хүлээж байна.`}
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
            loading={summary.status === 'loading'}
            failed={summary.status === 'failed'}
          />
          {canSeeSites && (
            <>
              <Metric
                label="Анхаарах тоноглол"
                value={risk.attention}
                note={`Үнэлэгдсэн ${risk.total} тоноглолоос`}
                fill="#ea580c"
                loading={buildings.status === 'loading'}
                failed={buildings.status === 'failed'}
              />
              <Metric
                label="Хэвийн тоноглол"
                value={risk.healthy}
                note="Сүүлийн үзлэгээр"
                fill="#16a34a"
                loading={buildings.status === 'loading'}
                failed={buildings.status === 'failed'}
              />
              <Metric
                label="Үнэлгээ хийгээгүй"
                value={unassessed}
                note="Үзлэг хийгдээгүй тоноглол"
                fill="#94a3b8"
                loading={buildings.status === 'loading'}
                failed={buildings.status === 'failed'}
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
            {buildings.status === 'loading' ? (
              <Skeleton className="h-32 w-full" />
            ) : buildings.status === 'failed' ? (
              <ErrorState
                description="Барилгын жагсаалт ачаалж чадсангүй. Тоноглолын байдлыг харуулах боломжгүй байна."
                action={retry(() => setBuildingsAttempt((n) => n + 1))}
              />
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
                      {silhouetteFor(building)}
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
              {buildings.status === 'loading' ? (
                <Skeleton className="h-32 w-full" />
              ) : buildings.status === 'failed' ? (
                <ErrorState
                  description="Тоноглолын эрсдэлийн мэдээлэл ачаалж чадсангүй."
                  action={retry(() => setBuildingsAttempt((n) => n + 1))}
                />
              ) : (
                <>
                  <DonutChart
                    slices={risk.slices}
                    centreValue={risk.total}
                    centreLabel="тоноглол"
                    emptyMessage="Тоноглолын үнэлгээ бүртгэгдээгүй байна."
                  />
                  {unassessed > 0 && (
                    <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
                      Үнэлгээ хийгээгүй: {unassessed} тоноглол
                    </p>
                  )}
                </>
              )}
            </Panel>
          )}

          <Panel title="Хүсэлт үе шатаар" hint="Хүсэлт бүр үе шатны аль нэгэнд байрлана.">
            {summary.status === 'loading' ? (
              <Skeleton className="h-32 w-full" />
            ) : summary.status === 'failed' ? (
              <ErrorState
                description="Хүсэлтийн нэгтгэл ачаалж чадсангүй."
                action={retry(() => setSummaryAttempt((n) => n + 1))}
              />
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
            {summary.status === 'loading' ? (
              <Skeleton className="h-40 w-full" />
            ) : summary.status === 'failed' ? (
              <ErrorState
                description="Эрсдэлийн түүх ачаалж чадсангүй."
                action={retry(() => setSummaryAttempt((n) => n + 1))}
              />
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
