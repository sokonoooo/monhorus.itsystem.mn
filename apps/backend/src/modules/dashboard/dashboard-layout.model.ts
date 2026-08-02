import {
  DASHBOARD_LAYOUT_KEYS,
  DASHBOARD_WIDGET_SIZES,
  type DashboardLayoutKey,
  type DashboardWidgetSize,
} from '@monhorus/shared';
import { Schema, Types, model, type Model } from 'mongoose';

/**
 * One user's dashboard arrangement.
 *
 * A display preference, never an access rule: the summary payload already omits the blocks
 * a caller may not see, so a layout can only reorder and hide what they were already
 * entitled to. Keyed by user rather than by role, because two dispatchers reading the same
 * board still care about different things.
 *
 * A row exists only once somebody customises; the default is a constant, not seeded data,
 * so changing the shipped order does not require a migration.
 */
export interface IDashboardWidgetPreference {
  key: DashboardLayoutKey;
  /**
   * The definition a `CUSTOM` row draws. Null on a built-in, whose key already identifies
   * it; a custom row shares its key with every other, so this is what tells them apart.
   */
  customWidgetId: Types.ObjectId | null;
  visible: boolean;
  size: DashboardWidgetSize;
}

export interface IDashboardLayout {
  user: Types.ObjectId;
  widgets: IDashboardWidgetPreference[];
  createdAt: Date;
  updatedAt: Date;
}

const widgetSchema = new Schema<IDashboardWidgetPreference>(
  {
    key: { type: String, enum: DASHBOARD_LAYOUT_KEYS, required: true },
    customWidgetId: {
      type: Schema.Types.ObjectId,
      ref: 'DashboardCustomWidget',
      default: null,
    },
    visible: { type: Boolean, required: true, default: true },
    size: { type: String, enum: DASHBOARD_WIDGET_SIZES, required: true, default: 'HALF' },
  },
  { _id: false },
);

const dashboardLayoutSchema = new Schema<IDashboardLayout>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    widgets: { type: [widgetSchema], default: [] },
  },
  { timestamps: true },
);

export const DashboardLayout: Model<IDashboardLayout> = model<IDashboardLayout>(
  'DashboardLayout',
  dashboardLayoutSchema,
);
