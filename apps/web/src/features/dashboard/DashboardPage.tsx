import {
  DASHBOARD_CUSTOM_WIDGET_KEY,
  DASHBOARD_INSIGHT_DIMENSION_LABELS,
  DASHBOARD_INSIGHT_RANGE_LABELS,
  DASHBOARD_WIDGET_LABELS,
  DEFAULT_DASHBOARD_LAYOUT,
  RISK_LEVEL_LABELS,
  type DashboardCustomWidgetDto,
  type DashboardInsightDto,
  type DashboardSummaryDto,
  type DashboardWidgetPreference,
  type DashboardWidgetSize,
  type RiskLevel,
} from '@monhorus/shared';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import {
  BarChart,
  CATEGORICAL_COLOURS,
  CHART_COLOURS,
  DonutChart,
  GroupedBarChart,
  LineChart,
  ProgressChart,
  StatTile,
  WidgetCard,
  type ChartDatum,
} from '../../components/charts/Charts';
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../../components/ui/PageHeader';
import { ErrorState, Skeleton } from '../../components/ui/States';
import { ApiError } from '../../lib/api-client';
import { dashboardService } from '../../services/org.service';
import { CustomiseDashboardDrawer } from './CustomiseDashboardDrawer';
import { TodayPanel } from './TodayPanel';

/** Section 10 assigns each band its colour; the chart reuses them rather than inventing any. */
const RISK_COLOURS: Record<RiskLevel, string> = {
  NORMAL: CHART_COLOURS.green,
  ATTENTION: CHART_COLOURS.amber,
  SCHEDULE_REPAIR: CHART_COLOURS.orange,
  CRITICAL: CHART_COLOURS.red,
  OUT_OF_SERVICE: CHART_COLOURS.black,
};

const INVOICE_COLOURS: Record<string, string> = {
  DRAFT: CHART_COLOURS.slate,
  SENT: CHART_COLOURS.blue,
  OVERDUE: CHART_COLOURS.red,
  PAID: CHART_COLOURS.green,
};

/**
 * A widget size as column spans.
 *
 * Six columns at xl so a two-thirds chart and a one-third list can share the top row. A
 * laptop cannot carry three charts across, so lg collapses the vocabulary to halves and
 * whole rows, and below that everything stacks: a donut in a sixth of a narrow window is
 * not a smaller chart, it is an unreadable one.
 */
const SIZE_SPANS: Record<DashboardWidgetSize, string> = {
  THIRD: 'lg:col-span-1 xl:col-span-2',
  HALF: 'lg:col-span-1 xl:col-span-3',
  TWO_THIRDS: 'lg:col-span-2 xl:col-span-4',
  FULL: 'lg:col-span-2 xl:col-span-6',
};

/** Wraps a stat tile so the number itself opens the matching filtered list. */
function MetricLink({ to, children }: { to: string; children: ReactNode }): ReactElement {
  return (
    <Link
      to={to}
      className="group/tile block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
    >
      {children}
    </Link>
  );
}

/**
 * The loading state, drawn as the grid it is about to become.
 *
 * Three stacked bars told the reader nothing about what was coming and made the real
 * layout arrive as a jump. This mirrors the shipped arrangement, so the page settles into
 * roughly the shape it already showed.
 */
function DashboardSkeleton(): ReactElement {
  return (
    <div className="space-y-5" role="status" aria-label="Ачааллаж байна">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-6">
        {DEFAULT_DASHBOARD_LAYOUT.map((entry) => (
          <div key={entry.key} className={SIZE_SPANS[entry.size]}>
            <Skeleton
              className={
                entry.key === 'TREND' || entry.key === 'TODAY' ? 'h-[22rem] w-full' : 'h-52 w-full'
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Хяналтын самбар, requirements section 15.1.
 *
 * Charts first: the page opens with the fourteen-day trend and the day's outstanding work,
 * then the distributions, and the plain counts sit at the bottom where a figure with no
 * comparison belongs.
 *
 * The order and visibility of every block come from the caller's own saved layout, because
 * one shared page serves every role and what matters differs by job. A widget whose data
 * the payload omitted simply does not render: the layout is a display preference and never
 * an access decision.
 */
/**
 * One saved question, drawn.
 *
 * Fetched per widget rather than with the summary: each is an independent aggregation the
 * caller defined, and a board with several should show the ones that resolved instead of
 * waiting for the slowest. A failure is reported in place, because a widget that silently
 * disappears reads as the definition having been lost.
 */
function CustomWidgetCard({ widget }: { widget: DashboardCustomWidgetDto }): ReactElement {
  const [insight, setInsight] = useState<DashboardInsightDto | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setInsight(null);
    setFailed(null);

    dashboardService
      .insight(widget.id)
      .then((result) => {
        if (!cancelled) setInsight(result);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setFailed(caught instanceof ApiError ? caught.message : 'Тооцоолж чадсангүй.');
      });

    return () => {
      cancelled = true;
    };
  }, [widget.id]);

  const hint = `${DASHBOARD_INSIGHT_DIMENSION_LABELS[widget.dimension]} · ${
    DASHBOARD_INSIGHT_RANGE_LABELS[widget.range]
  }`;

  if (failed) {
    return (
      <WidgetCard title={widget.title} hint={hint}>
        <p className="py-6 text-center text-xs text-slate-500">{failed}</p>
      </WidgetCard>
    );
  }

  if (!insight) {
    return (
      <WidgetCard title={widget.title} hint={hint}>
        <Skeleton className="h-40 w-full" />
      </WidgetCard>
    );
  }

  const data: ChartDatum[] = insight.slices.map((slice, index) => ({
    key: slice.key,
    label: slice.label,
    value: slice.count,
    colour: CATEGORICAL_COLOURS[index % CATEGORICAL_COLOURS.length]!,
  }));

  const emptyMessage = 'Сонгосон хугацаанд бүртгэл алга.';

  return widget.chart === 'DONUT' ? (
    <DonutChart
      title={widget.title}
      hint={hint}
      data={data}
      centreLabel="нийт"
      emptyMessage={emptyMessage}
    />
  ) : (
    <BarChart title={widget.title} hint={hint} data={data} emptyMessage={emptyMessage} />
  );
}

export function DashboardPage(): ReactElement {
  const [summary, setSummary] = useState<DashboardSummaryDto | null>(null);
  const [widgets, setWidgets] = useState<readonly DashboardWidgetPreference[]>(
    DEFAULT_DASHBOARD_LAYOUT,
  );
  const [customWidgets, setCustomWidgets] = useState<readonly DashboardCustomWidgetDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [customiseOpen, setCustomiseOpen] = useState(false);
  // Bumped when a definition is created or deleted, so the board reloads rather than
  // trying to patch a layout the server has already reconciled.
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    Promise.all([dashboardService.summary(), dashboardService.layout()])
      .then(([summaryResult, layoutResult]) => {
        if (cancelled) return;
        setSummary(summaryResult);
        setWidgets(layoutResult.widgets);
        setCustomWidgets(layoutResult.customWidgets);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught instanceof ApiError ? caught.message : 'Хяналтын самбар ачаалж чадсангүй.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  if (loading) return <DashboardSkeleton />;

  if (error || !summary) return <ErrorState description={error ?? 'Мэдээлэл олдсонгүй.'} />;

  const riskData: ChartDatum[] = (summary.risk?.byLevel ?? []).map((entry) => ({
    key: entry.level,
    label: RISK_LEVEL_LABELS[entry.level],
    value: entry.count,
    colour: RISK_COLOURS[entry.level],
  }));

  const statusData: ChartDatum[] = (summary.requestsByStatus ?? []).map((slice, index) => ({
    key: slice.key,
    label: slice.label,
    value: slice.count,
    colour: CATEGORICAL_COLOURS[index % CATEGORICAL_COLOURS.length] ?? CHART_COLOURS.blue,
  }));


  const financeData: ChartDatum[] = (summary.finance?.byStatus ?? []).map((slice) => ({
    key: slice.key,
    label: slice.label,
    value: slice.count,
    colour: INVOICE_COLOURS[slice.key] ?? CHART_COLOURS.slate,
  }));

  const currency = summary.finance?.currency ?? 'MNT';

  /**
   * One widget.
   *
   * Returns null when the payload carried no data for it, which is how a caller without
   * the permission behind a block sees nothing rather than an empty frame.
   */
  function renderWidget(entry: DashboardWidgetPreference): ReactElement | null {
    if (entry.key === DASHBOARD_CUSTOM_WIDGET_KEY) {
      const definition = customWidgets.find((widget) => widget.id === entry.customWidgetId);
      // Reconciliation drops a row whose definition is gone, so this only happens in the
      // window between a delete and the reload; rendering nothing is the honest answer.
      return definition ? <CustomWidgetCard widget={definition} /> : null;
    }

    const key = entry.key;
    if (!summary) return null;

    switch (key) {
      case 'TODAY':
        return summary.today ? (
          <TodayPanel today={summary.today} isScoped={summary.isScoped} />
        ) : null;

      case 'REQUEST_METRICS':
        return summary.requests ? (
          <WidgetCard
            title={DASHBOARD_WIDGET_LABELS.REQUEST_METRICS}
            hint={
              summary.isScoped
                ? 'Зөвхөн танд хуваарилагдсан хүсэлт.'
                : 'Одоогийн байдлаар.'
            }
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MetricLink to="/service-requests?status=NEW">
                <StatTile label="Шинэ хүсэлт" value={summary.requests.newRequests} />
              </MetricLink>
              <MetricLink to="/service-requests/dispatch">
                <StatTile
                  label="Хуваарилагдаагүй"
                  value={summary.requests.unassignedRequests}
                  tone={summary.requests.unassignedRequests > 0 ? 'warning' : 'default'}
                />
              </MetricLink>
              <MetricLink to="/service-requests?isUrgent=true">
                <StatTile
                  label="Яаралтай"
                  value={summary.requests.urgentRequests}
                  tone={summary.requests.urgentRequests > 0 ? 'danger' : 'default'}
                />
              </MetricLink>
              <StatTile
                label="SLA зөрчсөн"
                value={summary.requests.slaBreached}
                tone={summary.requests.slaBreached > 0 ? 'danger' : 'default'}
              />
            </div>
          </WidgetCard>
        ) : null;

      case 'TREND':
        return summary.trend ? (
          <LineChart
            title="Хүсэлтийн урсгал"
            hint={
              summary.isScoped
                ? 'Сүүлийн 14 хоногт танд хуваарилагдсан шинэ ба дууссан хүсэлт.'
                : 'Сүүлийн 14 хоногийн шинэ ба дууссан хүсэлт.'
            }
            hero
            labels={summary.trend.map((point) => point.date)}
            series={[
              {
                key: 'created',
                label: 'Шинэ',
                colour: CHART_COLOURS.blue,
                values: summary.trend.map((point) => point.created),
              },
              {
                key: 'completed',
                label: 'Дууссан',
                colour: CHART_COLOURS.green,
                values: summary.trend.map((point) => point.completed),
              },
            ]}
          />
        ) : null;

      case 'RISK':
        return summary.risk ? (
          <DonutChart
            title="Төхөөрөмжийн эрсдэл"
            hint={`Үнэлгээгүй ${summary.risk.unassessedObjects} объект. Нэгдсэн оноо гаргахгүй.`}
            data={riskData}
            centreLabel="үнэлгээтэй"
            emptyMessage="Үнэлгээ бүртгэгдээгүй байна."
          />
        ) : null;

      case 'REQUESTS_BY_STATUS':
        return summary.requestsByStatus ? (
          <DonutChart
            title="Хүсэлт төлвөөр"
            hint={
              // "Бүх" — every request — is the one word that must not survive onto a
              // bounded board: the donut beside it is drawn from the caller's own work.
              summary.isScoped
                ? 'Танд хуваарилагдсан хүсэлтийн төлвийн хуваарилалт.'
                : 'Бүх хүсэлтийн төлвийн хуваарилалт.'
            }
            data={statusData}
            centreLabel="хүсэлт"
          />
        ) : null;

      case 'WORKLOAD':
        return summary.workload ? (
          <GroupedBarChart
            title="Ажилтны ачаалал"
            hint="Идэвхтэй ажил ба өнөөдөр дууссан ажил."
            rows={summary.workload.map((row) => ({
              key: row.employeeId,
              label: row.employeeName,
              primary: row.activeCount,
              secondary: row.completedToday,
            }))}
            primaryLabel="Идэвхтэй"
            secondaryLabel="Өнөөдөр дууссан"
            emptyMessage="Хуваарилагдсан ажил алга."
          />
        ) : null;

      case 'PLANNED_WORK':
        return summary.plannedWork ? (
          <ProgressChart
            title="Төлөвлөгөөт ажлын гүйцэтгэл"
            hint={`${summary.isScoped ? 'Танд хуваарилагдсан. ' : ''}Нийт ${summary.plannedWork.total}, явцтай ${summary.plannedWork.inProgress}, хугацаа хэтэрсэн ${summary.plannedWork.overdue}.`}
            percent={summary.plannedWork.averageProgress}
            caption={`${summary.plannedWork.completed} дууссан`}
          />
        ) : null;

      case 'FINANCE_CHART':
        return summary.finance ? (
          <DonutChart
            title="Нэхэмжлэлийн төлөв"
            hint={`Энэ сарын орлого ${summary.finance.monthRevenue.toLocaleString('mn-MN')} ${currency}.`}
            data={financeData}
            centreLabel="нэхэмжлэл"
            emptyMessage="Нэхэмжлэл үүсээгүй байна."
          />
        ) : null;

      case 'FINANCE_METRICS':
        return summary.finance ? (
          <WidgetCard title={DASHBOARD_WIDGET_LABELS.FINANCE_METRICS} hint={`Валют: ${currency}.`}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatTile
                label="Энэ сарын орлого"
                value={`${summary.finance.monthRevenue.toLocaleString('mn-MN')} ${currency}`}
              />
              <MetricLink to="/invoices?status=SENT">
                <StatTile
                  label="Авлага"
                  value={`${summary.finance.receivableTotal.toLocaleString('mn-MN')} ${currency}`}
                />
              </MetricLink>
              <MetricLink to="/invoices?status=OVERDUE">
                <StatTile
                  label="Хугацаа хэтэрсэн"
                  value={`${summary.finance.overdueTotal.toLocaleString('mn-MN')} ${currency}`}
                  tone={summary.finance.overdueTotal > 0 ? 'danger' : 'default'}
                />
              </MetricLink>
            </div>
          </WidgetCard>
        ) : null;

      case 'RESOURCES':
        return summary.employees || summary.customers ? (
          <WidgetCard title={DASHBOARD_WIDGET_LABELS.RESOURCES} hint="Бүртгэлийн нийт тоо.">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {summary.employees && (
                <>
                  <MetricLink to="/employees?status=ACTIVE">
                    <StatTile
                      label="Идэвхтэй ажилтан"
                      value={summary.employees.totalActiveEmployees}
                    />
                  </MetricLink>
                  <StatTile
                    label="Боломжтой ажилтан"
                    value={summary.employees.availableEmployees}
                  />
                </>
              )}
              {summary.customers && (
                <>
                  <MetricLink to="/customers">
                    <StatTile label="Нийт харилцагч" value={summary.customers.totalCustomers} />
                  </MetricLink>
                  <StatTile
                    label="Идэвхтэй үйлчилгээний нөхцөл"
                    value={summary.customers.activeServiceAgreements}
                  />
                  <MetricLink to="/projects">
                    <StatTile label="Нийт төсөл" value={summary.customers.totalProjects} />
                  </MetricLink>
                  <StatTile label="Нийт барилга" value={summary.customers.totalBuildings} />
                  <StatTile label="Нийт давхар" value={summary.customers.totalFloors} />
                </>
              )}
            </div>
          </WidgetCard>
        ) : null;

      default:
        return null;
    }
  }

  const rendered = widgets
    .filter((entry) => entry.visible)
    .map((entry) => ({ entry, element: renderWidget(entry) }))
    .filter((item) => item.element !== null);

  return (
    <>
      <PageHeader
        /**
         * The heading names whose figures these are, in both directions.
         *
         * Naming the organisation out loud on the unbounded board is the deliberate half:
         * a bounded caller and an unbounded one otherwise read the identical word over
         * two quite different sets of numbers, and the reader has no way to tell which
         * they are looking at. The employee app settled this the same way.
         */
        title={summary.isScoped ? 'Миний хяналтын самбар' : 'Байгууллагын хяналтын самбар'}
        description={`${
          summary.isScoped
            ? 'Зөвхөн танд болон таны багт хуваарилагдсан ажил.'
            : 'Байгууллагын нийт үзүүлэлт.'
        } Шинэчлэгдсэн: ${new Date(summary.generatedAt).toLocaleString('mn-MN', {
          timeZone: 'Asia/Ulaanbaatar',
        })}`}
        actions={
          <Button variant="secondary" onClick={() => setCustomiseOpen(true)}>
            Тохируулах
          </Button>
        }
      />

      {rendered.length === 0 ? (
        <div className="rounded-xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
          <p className="text-sm text-slate-600">Харагдах хэсэг сонгогдоогүй байна.</p>
          <div className="mt-3">
            <Button onClick={() => setCustomiseOpen(true)}>Тохируулах</Button>
          </div>
        </div>
      ) : (
        // Only the widgets that carried data are placed, so a block the caller may not see
        // leaves no gap: the ones after it simply move up a slot.
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-6">
          {rendered.map(({ entry, element }) => (
            <div
              key={`${entry.key}-${entry.customWidgetId ?? ''}`}
              className={SIZE_SPANS[entry.size]}
            >
              {element}
            </div>
          ))}
        </div>
      )}

      <CustomiseDashboardDrawer
        open={customiseOpen}
        widgets={widgets}
        customWidgets={customWidgets}
        onClose={() => setCustomiseOpen(false)}
        onSaved={(saved) => {
          setWidgets(saved);
          setCustomiseOpen(false);
        }}
        onWidgetsChanged={() => setReloadToken((token) => token + 1)}
      />
    </>
  );
}
