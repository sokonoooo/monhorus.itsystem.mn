import {
  DASHBOARD_INSIGHT_CHARTS,
  DASHBOARD_INSIGHT_DIMENSIONS,
  DASHBOARD_INSIGHT_METRICS,
  DASHBOARD_INSIGHT_RANGES,
  type DashboardInsightChart,
  type DashboardInsightDimension,
  type DashboardInsightMetric,
  type DashboardInsightRange,
} from '@monhorus/shared';
import { Schema, Types, model, type Model } from 'mongoose';

/**
 * One question an administrator saved to their own board.
 *
 * Personal, never shared. `owner` is the whole access story: a definition is only ever
 * read back by the account that wrote it, so there is no second viewer whose rights would
 * have to be checked against somebody else's saved question. The figures are a separate
 * matter — the owner's own permissions are checked when the aggregation runs, because a
 * saved question is not a licence to answer it.
 *
 * Four closed enums and a title, and deliberately nothing else. No field name, collection
 * or expression is stored, so a definition cannot widen what it reads however it was
 * written; the server maps a dimension onto a fixed path at query time.
 */
export interface IDashboardCustomWidget {
  owner: Types.ObjectId;
  title: string;
  metric: DashboardInsightMetric;
  dimension: DashboardInsightDimension;
  range: DashboardInsightRange;
  chart: DashboardInsightChart;
  createdAt: Date;
  updatedAt: Date;
}

const dashboardCustomWidgetSchema = new Schema<IDashboardCustomWidget>(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 60 },
    metric: { type: String, enum: DASHBOARD_INSIGHT_METRICS, required: true },
    dimension: { type: String, enum: DASHBOARD_INSIGHT_DIMENSIONS, required: true },
    range: { type: String, enum: DASHBOARD_INSIGHT_RANGES, required: true },
    chart: { type: String, enum: DASHBOARD_INSIGHT_CHARTS, required: true },
  },
  { timestamps: true },
);

// The board lists a caller's definitions oldest-first on every load, so the sort is part
// of the same access the owner index already serves.
dashboardCustomWidgetSchema.index({ owner: 1, createdAt: 1 });

export const DashboardCustomWidget: Model<IDashboardCustomWidget> =
  model<IDashboardCustomWidget>('DashboardCustomWidget', dashboardCustomWidgetSchema);
