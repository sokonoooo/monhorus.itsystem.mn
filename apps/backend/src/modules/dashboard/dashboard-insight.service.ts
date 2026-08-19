import {
  DASHBOARD_CUSTOM_WIDGET_LIMIT,
  PERMISSIONS,
  SERVICE_REQUEST_STATUS_LABELS,
  type DashboardCustomWidgetDto,
  type DashboardCustomWidgetInput,
  type DashboardInsightDimension,
  type DashboardInsightDto,
  type DashboardInsightRange,
  type DashboardSlice,
} from '@monhorus/shared';
import { Types, type HydratedDocument } from 'mongoose';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import type { AuthContext } from '../../common/types/express';
import { localDateString } from '../../common/utils/day-bounds.util';
import { env } from '../../config/env';
import { hasPermission } from '../../middlewares/authorize.middleware';
import { ServiceRequest } from '../service-request/service-request.model';
import {
  DashboardCustomWidget,
  type IDashboardCustomWidget,
} from './dashboard-custom-widget.model';

/**
 * User-built dashboard widgets, and the figures behind them.
 *
 * The saved definition names a dimension, never a field. This module holds the only map
 * from one to the other, so nothing a caller sends is ever used as a path or an
 * expression — that is the entire reason the dimension is a closed enum rather than a
 * string, and it must stay that way if the list is ever extended.
 */

type Doc<T> = T & { _id: Types.ObjectId };

/**
 * How a dimension is grouped and how its buckets are named.
 *
 * `REF` buckets hold an id and need the referenced document's name; `ENUM` buckets are
 * already the value and only need the vocabulary the rest of the app prints. `unwind` is
 * set where the field holds several values at once.
 */
interface DimensionSource {
  path: string;
  kind: 'REF' | 'ENUM';
  /** Collection to resolve a REF bucket's display name from. */
  from?: string;
  /** Label vocabulary for an ENUM bucket. */
  labels?: Readonly<Record<string, string>>;
  unwind?: boolean;
}

const DIMENSION_SOURCES: Record<DashboardInsightDimension, DimensionSource> = {
  BUILDING: { path: 'building', kind: 'REF', from: 'objectnodes' },
  PROJECT: { path: 'project', kind: 'REF', from: 'objectnodes' },
  CUSTOMER: { path: 'customer', kind: 'REF', from: 'customers' },
  FLOOR: { path: 'floor', kind: 'REF', from: 'objectnodes' },
  STATUS: { path: 'status', kind: 'ENUM', labels: SERVICE_REQUEST_STATUS_LABELS },
  TEAM: { path: 'assignedTeam', kind: 'REF', from: 'teams' },
  // A request can carry several assignees, so it is counted once per assignee rather than
  // once overall. The buckets therefore sum to more than `total` on shared work, which is
  // the honest reading of "how much is on each person".
  EMPLOYEE: { path: 'assignedEmployees', kind: 'REF', from: 'employees', unwind: true },
};

/**
 * Fixed day counts rather than calendar months.
 *
 * A window that is 28 days long in February and 31 in March cannot be compared with the
 * one before it, so "сүүлийн 2 сар" is read as a span of days.
 */
const RANGE_DAYS: Record<DashboardInsightRange, number> = {
  LAST_7_DAYS: 7,
  LAST_30_DAYS: 30,
  LAST_2_MONTHS: 60,
  LAST_12_MONTHS: 365,
};

/**
 * How many buckets a chart shows before the tail is folded together.
 *
 * An installation can have dozens of buildings and a donut with forty slices communicates
 * nothing. The remainder is kept as one bucket rather than dropped, so the parts still
 * add up to the total the caller is shown.
 */
const TOP_N = 8;
const REMAINDER_LABEL = 'Бусад';

function toDto(widget: Doc<IDashboardCustomWidget>): DashboardCustomWidgetDto {
  return {
    id: String(widget._id),
    title: widget.title,
    metric: widget.metric,
    dimension: widget.dimension,
    range: widget.range,
    chart: widget.chart,
    createdAt: widget.createdAt.toISOString(),
  };
}

/**
 * Loads one of the caller's definitions.
 *
 * Owner is part of the query rather than checked afterwards, and somebody else's
 * definition is reported as missing rather than forbidden — the same anti-enumeration
 * convention the customer scope uses, for the same reason: a "forbidden" answer would
 * confirm the id exists.
 */
async function ownedWidget(
  widgetId: string,
  actor: AuthContext,
): Promise<HydratedDocument<IDashboardCustomWidget>> {
  const widget = await DashboardCustomWidget.findOne({
    _id: new Types.ObjectId(widgetId),
    owner: new Types.ObjectId(actor.userId),
  });
  if (!widget) throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Хэсэг олдсонгүй.');
  return widget;
}

export async function listCustomWidgets(actor: AuthContext): Promise<DashboardCustomWidgetDto[]> {
  const widgets = await DashboardCustomWidget.find({
    owner: new Types.ObjectId(actor.userId),
  }).sort({ createdAt: 1 });
  return widgets.map(toDto);
}

export async function createCustomWidget(
  input: DashboardCustomWidgetInput,
  actor: AuthContext,
): Promise<DashboardCustomWidgetDto> {
  const owned = await DashboardCustomWidget.countDocuments({
    owner: new Types.ObjectId(actor.userId),
  });
  if (owned >= DASHBOARD_CUSTOM_WIDGET_LIMIT) {
    throw AppError.conflict(
      ERROR_CODES.VALIDATION_ERROR,
      `Хамгийн ихдээ ${DASHBOARD_CUSTOM_WIDGET_LIMIT} хэсэг үүсгэнэ. Хуучныг устгаад дахин оролдоно уу.`,
    );
  }

  // Nothing places the new widget on the board here: `reconcileDashboardLayout` introduces
  // a definition the layout has not seen yet, so creating one is enough for it to appear.
  const widget = await DashboardCustomWidget.create({
    owner: new Types.ObjectId(actor.userId),
    title: input.title,
    metric: input.metric,
    dimension: input.dimension,
    range: input.range,
    chart: input.chart,
  });

  return toDto(widget);
}

export async function updateCustomWidget(
  widgetId: string,
  input: DashboardCustomWidgetInput,
  actor: AuthContext,
): Promise<DashboardCustomWidgetDto> {
  const widget = await ownedWidget(widgetId, actor);

  widget.title = input.title;
  widget.metric = input.metric;
  widget.dimension = input.dimension;
  widget.range = input.range;
  widget.chart = input.chart;
  await widget.save();

  return toDto(widget);
}

export async function deleteCustomWidget(widgetId: string, actor: AuthContext): Promise<void> {
  const widget = await ownedWidget(widgetId, actor);
  // The layout row pointing at it is not deleted here. Reconciliation drops an entry whose
  // definition no longer exists, so the board corrects itself on the next read and a
  // half-written layout can never outlive the definition it referred to.
  await DashboardCustomWidget.deleteOne({ _id: widget._id });
}

/** Resolves a REF bucket's display name, falling back rather than dropping the bucket. */
function nameOf(row: { label?: unknown }, fallback: string): string {
  return typeof row.label === 'string' && row.label.trim().length > 0 ? row.label : fallback;
}

/**
 * Counts one saved question.
 *
 * The definition is a saved question, not a licence to answer it: the caller's own right
 * to read the underlying records is checked here, every time, rather than at the moment
 * the widget was written.
 */
export async function buildInsight(
  widgetId: string,
  actor: AuthContext,
): Promise<DashboardInsightDto> {
  const widget = await ownedWidget(widgetId, actor);

  if (!hasPermission(actor, PERMISSIONS.SERVICE_REQUEST_VIEW)) {
    throw AppError.forbidden(
      ERROR_CODES.FORBIDDEN,
      'Үйлчилгээний хүсэлт харах эрх байхгүй тул энэ хэсгийг тооцоолохгүй.',
    );
  }

  const source = DIMENSION_SOURCES[widget.dimension];
  const days = RANGE_DAYS[widget.range];

  const now = new Date();
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  const rows = await ServiceRequest.aggregate<{ _id: unknown; count: number; label?: unknown }>([
    { $match: { createdAt: { $gte: from, $lte: now } } },
    ...(source.unwind ? [{ $unwind: `$${source.path}` }] : []),
    // A record with nothing in the dimension has no bucket to belong to; counting it under
    // a blank heading would read as a real group.
    { $match: { [source.path]: { $ne: null } } },
    { $group: { _id: `$${source.path}`, count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
    ...(source.kind === 'REF' && source.from
      ? [
          {
            $lookup: {
              from: source.from,
              localField: '_id',
              foreignField: '_id',
              as: 'referenced',
            },
          },
          {
            $addFields: {
              label: { $first: '$referenced.name' },
            },
          },
          { $project: { referenced: 0 } },
        ]
      : []),
  ]);

  const total = rows.reduce((sum, row) => sum + row.count, 0);

  const ranked: DashboardSlice[] = rows.map((row) => {
    const key = String(row._id);
    const label =
      source.kind === 'ENUM' ? (source.labels?.[key] ?? key) : nameOf(row, 'Тодорхойгүй');
    return { key, label, count: row.count };
  });

  const head = ranked.slice(0, TOP_N);
  const tail = ranked.slice(TOP_N);
  const slices =
    tail.length > 0
      ? [
          ...head,
          {
            key: 'OTHER',
            label: REMAINDER_LABEL,
            count: tail.reduce((sum, slice) => sum + slice.count, 0),
          },
        ]
      : head;

  return {
    widget: toDto(widget),
    from: localDateString(from, env.APP_TIMEZONE),
    to: localDateString(now, env.APP_TIMEZONE),
    timezone: env.APP_TIMEZONE,
    total,
    slices,
  };
}
