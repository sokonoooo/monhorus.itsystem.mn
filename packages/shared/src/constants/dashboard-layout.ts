/**
 * Dashboard widget catalogue.
 *
 * The dashboard is one page shared by every role, and what matters on it differs by job:
 * a dispatcher wants today's queue, finance wants receivables. Rather than guessing an
 * order that suits nobody, each user chooses which widgets appear and in what order.
 *
 * The catalogue lives here so the backend can validate a saved layout against the same
 * list the frontend renders from, and a widget removed from the product cannot be
 * resurrected by an old stored preference.
 */
export const DASHBOARD_WIDGETS = [
  'TODAY',
  'REQUEST_METRICS',
  'TREND',
  'RISK',
  'REQUESTS_BY_STATUS',
  'REQUESTS_BY_TYPE',
  'WORKLOAD',
  'PLANNED_WORK',
  'FINANCE_CHART',
  'FINANCE_METRICS',
  'RESOURCES',
] as const;
export type DashboardWidgetKey = (typeof DASHBOARD_WIDGETS)[number];

export const DASHBOARD_WIDGET_LABELS: Record<DashboardWidgetKey, string> = {
  TODAY: 'Өнөөдрийн ажил',
  REQUEST_METRICS: 'Үйлчилгээний хүсэлтийн үзүүлэлт',
  TREND: 'Хүсэлтийн урсгал',
  RISK: 'Төхөөрөмжийн эрсдэл',
  REQUESTS_BY_STATUS: 'Хүсэлт төлвөөр',
  REQUESTS_BY_TYPE: 'Нээлттэй хүсэлт төрлөөр',
  WORKLOAD: 'Ажилтны ачаалал',
  PLANNED_WORK: 'Төлөвлөгөөт ажлын гүйцэтгэл',
  FINANCE_CHART: 'Нэхэмжлэлийн төлөв',
  FINANCE_METRICS: 'Санхүүгийн үзүүлэлт',
  RESOURCES: 'Нөөц ба бүртгэл',
};

export const DASHBOARD_WIDGET_DESCRIPTIONS: Record<DashboardWidgetKey, string> = {
  TODAY: 'Өнөөдөр дуусах, хугацаа хэтэрсэн, яаралтай ажлын жагсаалт.',
  REQUEST_METRICS: 'Шинэ, хуваарилагдаагүй, яаралтай, SLA зөрчсөн тоо.',
  TREND: 'Сүүлийн 14 хоногийн шинэ ба дууссан хүсэлт.',
  RISK: '5 түвшний эрсдэлийн хуваарилалт.',
  REQUESTS_BY_STATUS: 'Бүх хүсэлтийн төлвийн хуваарилалт.',
  REQUESTS_BY_TYPE: 'Дуусаагүй хүсэлт ажлын төрлөөр.',
  WORKLOAD: 'Ажилтан бүрийн идэвхтэй ба өнөөдөр дууссан ажил.',
  PLANNED_WORK: 'Төлөвлөгөөт ажлын дундаж гүйцэтгэл.',
  FINANCE_CHART: 'Нэхэмжлэлийн төлвийн хуваарилалт.',
  FINANCE_METRICS: 'Сарын орлого, авлага, хугацаа хэтэрсэн дүн.',
  RESOURCES: 'Ажилтан, харилцагч, төсөл, материалын тоо.',
};

/**
 * Which permission a widget needs.
 *
 * A layout is a display preference, never an access decision: the payload already omits
 * blocks the caller may not see, so a widget whose data is absent simply does not render.
 * This mapping only keeps the customise dialog from offering something that would always
 * be empty.
 */
export const DASHBOARD_WIDGET_PERMISSIONS: Record<DashboardWidgetKey, string> = {
  TODAY: 'service_request.view',
  REQUEST_METRICS: 'service_request.view',
  TREND: 'service_request.view',
  RISK: 'object_master.view',
  REQUESTS_BY_STATUS: 'service_request.view',
  REQUESTS_BY_TYPE: 'service_request.view',
  WORKLOAD: 'employee.view',
  PLANNED_WORK: 'planned_work.view',
  FINANCE_CHART: 'invoice.view',
  FINANCE_METRICS: 'invoice.view',
  RESOURCES: 'customer.view',
};

// -- User-defined widgets ------------------------------------------------------

/**
 * The layout key a user-built widget occupies.
 *
 * Deliberately outside `DASHBOARD_WIDGETS`: that list is the product's catalogue, and the
 * label, description and permission maps above are exhaustive over it. A custom widget has
 * no entry in any of them because its title comes from its own definition row, written by
 * the person who created it. A layout entry carrying this key therefore means nothing on
 * its own — it must also name the definition it draws.
 */
export const DASHBOARD_CUSTOM_WIDGET_KEY = 'CUSTOM';

export const DASHBOARD_LAYOUT_KEYS = [
  ...DASHBOARD_WIDGETS,
  DASHBOARD_CUSTOM_WIDGET_KEY,
] as const;
export type DashboardLayoutKey = (typeof DASHBOARD_LAYOUT_KEYS)[number];

/**
 * How many widgets one person may define.
 *
 * Each one costs its own aggregation on every dashboard load, so this is a cost ceiling
 * rather than a taste judgement, and it is what bounds the layout array now that its
 * length is no longer pinned to the catalogue.
 */
export const DASHBOARD_CUSTOM_WIDGET_LIMIT = 12;

/**
 * What a user-built widget can measure.
 *
 * One value at v1. It is still a list, and still shown as a chooser, because the shape of
 * the builder — metric, dimension, range, chart — is what makes the next measure an entry
 * here rather than a redesign.
 */
export const DASHBOARD_INSIGHT_METRICS = ['COUNT'] as const;
export type DashboardInsightMetric = (typeof DASHBOARD_INSIGHT_METRICS)[number];

export const DASHBOARD_INSIGHT_METRIC_LABELS: Record<DashboardInsightMetric, string> = {
  COUNT: 'Тоо',
};

/**
 * What a user-built widget can group by.
 *
 * A closed list, not a field picker. The backend holds the matching allowlist that turns
 * one of these into a stored field path; nothing a caller sends is ever used as a path,
 * which is the whole reason this is an enum and not a string.
 */
export const DASHBOARD_INSIGHT_DIMENSIONS = [
  'BUILDING',
  'PROJECT',
  'CUSTOMER',
  'FLOOR',
  'STATUS',
  'REQUEST_TYPE',
  'TEAM',
  'EMPLOYEE',
] as const;
export type DashboardInsightDimension = (typeof DASHBOARD_INSIGHT_DIMENSIONS)[number];

export const DASHBOARD_INSIGHT_DIMENSION_LABELS: Record<DashboardInsightDimension, string> = {
  BUILDING: 'Барилга',
  PROJECT: 'Төсөл',
  CUSTOMER: 'Харилцагч',
  FLOOR: 'Давхар',
  STATUS: 'Төлөв',
  REQUEST_TYPE: 'Хүсэлтийн төрөл',
  TEAM: 'Баг',
  EMPLOYEE: 'Ажилтан',
};

/**
 * The window a user-built widget counts over, applied to the creation date.
 *
 * Fixed day counts rather than calendar months: a window that is 28 days long in February
 * and 31 in March cannot be compared with the one before it, and "сүүлийн 2 сар" is read
 * as a span, not as two named months.
 */
export const DASHBOARD_INSIGHT_RANGES = [
  'LAST_7_DAYS',
  'LAST_30_DAYS',
  'LAST_2_MONTHS',
  'LAST_12_MONTHS',
] as const;
export type DashboardInsightRange = (typeof DASHBOARD_INSIGHT_RANGES)[number];

export const DASHBOARD_INSIGHT_RANGE_LABELS: Record<DashboardInsightRange, string> = {
  LAST_7_DAYS: 'Сүүлийн 7 хоног',
  LAST_30_DAYS: 'Сүүлийн 30 хоног',
  LAST_2_MONTHS: 'Сүүлийн 2 сар',
  LAST_12_MONTHS: 'Сүүлийн 12 сар',
};

export const DASHBOARD_INSIGHT_CHARTS = ['BAR', 'DONUT'] as const;
export type DashboardInsightChart = (typeof DASHBOARD_INSIGHT_CHARTS)[number];

export const DASHBOARD_INSIGHT_CHART_LABELS: Record<DashboardInsightChart, string> = {
  BAR: 'Баганан',
  DONUT: 'Дугуй',
};

/**
 * How much of the row a widget takes, counted in sixths.
 *
 * Six columns rather than two, because half and full alone cannot express the shape the
 * page is built around: a wide trend chart beside a narrow list, and three distributions
 * across one row. The renderer maps these onto column spans.
 */
export const DASHBOARD_WIDGET_SIZES = ['THIRD', 'HALF', 'TWO_THIRDS', 'FULL'] as const;
export type DashboardWidgetSize = (typeof DASHBOARD_WIDGET_SIZES)[number];

export const DASHBOARD_WIDGET_SIZE_LABELS: Record<DashboardWidgetSize, string> = {
  THIRD: 'Гуравны нэг',
  HALF: 'Хагас өргөн',
  TWO_THIRDS: 'Гуравны хоёр',
  FULL: 'Бүтэн өргөн',
};

export interface DashboardWidgetPreference {
  key: DashboardLayoutKey;
  /**
   * Which user-built definition this row draws. Set on a `CUSTOM` entry and on no other:
   * a built-in widget is fully identified by its key, a custom one by this id.
   */
  customWidgetId?: string | null;
  visible: boolean;
  size: DashboardWidgetSize;
}

/**
 * The order the dashboard ships with.
 *
 * The trend line leads at two thirds width with today's work as a narrow column beside it,
 * so the first screen answers "where is the volume going" and "what is outstanding" at
 * once. Two rows of distributions follow, and the plain counts sit at the bottom: a number
 * on its own says less than the same number in a series, so it should not open the page.
 */
export const DEFAULT_DASHBOARD_LAYOUT: readonly DashboardWidgetPreference[] = [
  { key: 'TREND', visible: true, size: 'TWO_THIRDS' },
  { key: 'TODAY', visible: true, size: 'THIRD' },
  { key: 'RISK', visible: true, size: 'THIRD' },
  { key: 'REQUESTS_BY_STATUS', visible: true, size: 'THIRD' },
  { key: 'WORKLOAD', visible: true, size: 'THIRD' },
  { key: 'REQUESTS_BY_TYPE', visible: true, size: 'THIRD' },
  { key: 'FINANCE_CHART', visible: true, size: 'THIRD' },
  { key: 'PLANNED_WORK', visible: true, size: 'THIRD' },
  { key: 'REQUEST_METRICS', visible: true, size: 'FULL' },
  { key: 'FINANCE_METRICS', visible: true, size: 'HALF' },
  { key: 'RESOURCES', visible: true, size: 'HALF' },
];

/**
 * Reconciles a stored layout with what actually exists.
 *
 * A widget the product has since removed is dropped, and one added since the layout was
 * saved is appended in its default state rather than silently missing. Without this, a
 * saved preference would quietly hide every new widget from the people who customised
 * their dashboard earliest.
 *
 * User-built widgets obey the same rule, measured against the caller's own live
 * definitions rather than the catalogue: an entry whose definition has been deleted is
 * dropped exactly as a retired built-in is, and neither can be resurrected by a stale
 * stored preference. `liveCustomWidgetIds` must therefore be the caller's definitions and
 * nobody else's — a definition is personal, so an id from another user is not "live" here.
 *
 * The one asymmetry is placement. A built-in appears because the product added it, so the
 * end of the board is the honest place for something the user never asked for. A custom
 * widget exists only because this user just built it, and burying it under eleven others
 * reads as the save having failed, so it goes first.
 */
export function reconcileDashboardLayout(
  stored: readonly DashboardWidgetPreference[],
  liveCustomWidgetIds: readonly string[] = [],
): DashboardWidgetPreference[] {
  const known = new Set<string>(DASHBOARD_WIDGETS);
  const live = new Set(liveCustomWidgetIds);
  const seenCustom = new Set<string>();

  const kept = stored.filter((entry) => {
    if (entry.key !== DASHBOARD_CUSTOM_WIDGET_KEY) return known.has(entry.key);

    const id = entry.customWidgetId ?? null;
    if (id === null || !live.has(id) || seenCustom.has(id)) return false;
    seenCustom.add(id);
    return true;
  });

  const present = new Set(kept.map((entry) => entry.key));
  const appended = DEFAULT_DASHBOARD_LAYOUT.filter((entry) => !present.has(entry.key));

  const introduced: DashboardWidgetPreference[] = liveCustomWidgetIds
    .filter((id) => !seenCustom.has(id))
    .map((id) => ({
      key: DASHBOARD_CUSTOM_WIDGET_KEY,
      customWidgetId: id,
      visible: true,
      size: 'THIRD',
    }));

  return [...introduced, ...kept, ...appended];
}
