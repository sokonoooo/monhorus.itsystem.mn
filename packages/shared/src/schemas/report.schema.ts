import { z } from 'zod';

import {
  DASHBOARD_CUSTOM_WIDGET_KEY,
  DASHBOARD_CUSTOM_WIDGET_LIMIT,
  DASHBOARD_INSIGHT_CHARTS,
  DASHBOARD_INSIGHT_DIMENSIONS,
  DASHBOARD_INSIGHT_METRICS,
  DASHBOARD_INSIGHT_RANGES,
  DASHBOARD_LAYOUT_KEYS,
  DASHBOARD_WIDGETS,
  DASHBOARD_WIDGET_SIZES,
} from '../constants/dashboard-layout';
import { NOTIFICATION_EVENTS } from '../constants/notification';
import { REPORT_EXPORT_FORMATS } from '../constants/report';
import {
  REPORT_SOURCE_TYPES,
  REPORT_STATUSES,
  REPORT_TYPES,
} from '../constants/report-record';
import { RISK_LEVELS } from '../constants/service-request';
import { isoDateSchema, objectIdSchema } from './common.schema';

/**
 * Үзлэг ба дүгнэлт — the equipment-result feed.
 *
 * One row per equipment-linked ReportItem, NOT per Report. The module answers "what has
 * been found on our equipment", so a report covering four objects is four results here,
 * each independently filterable and each linking back to the one report that carries the
 * narrative. A report naming no registered equipment produces no row at all, which is what
 * keeps completed jobs that assessed nothing out of an assessment feed.
 *
 * `objectId` filters to one piece of equipment; `sourceType` narrows by what produced the
 * finding, which `type` cannot do on its own now that a consolidation carries items copied
 * from several producers.
 */
export const inspectionListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(25),
  search: z.string().trim().max(200).optional(),
  /** Narrows to one producer: assessment, planned work, service request, consolidation. */
  type: z.enum(REPORT_TYPES).optional(),
  sourceType: z.enum(REPORT_SOURCE_TYPES).optional(),
  status: z.enum(REPORT_STATUSES).optional(),
  customerId: objectIdSchema.optional(),
  projectId: objectIdSchema.optional(),
  buildingId: objectIdSchema.optional(),
  floorId: objectIdSchema.optional(),
  objectId: objectIdSchema.optional(),
  riskLevel: z.enum(RISK_LEVELS).optional(),
  dateFrom: isoDateSchema.optional(),
  dateTo: isoDateSchema.optional(),
  format: z.enum(REPORT_EXPORT_FORMATS).optional(),
});

/**
 * Shared filter for the section 15.2 catalogue.
 *
 * `page` and `limit` window the row set and every response states the real `total`, so a
 * reader reaches every row instead of being handed a silently capped slice.
 *
 * The default `limit` stays high because it is the CSV export's default: an export renders
 * one window and has no pager, so it must still carry the whole report. A screen asks for
 * a page-sized window explicitly.
 */
export const reportQuerySchema = z.object({
  dateFrom: isoDateSchema.optional(),
  dateTo: isoDateSchema.optional(),
  customerId: objectIdSchema.optional(),
  projectId: objectIdSchema.optional(),
  employeeId: objectIdSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(5000).default(1000),
  format: z.enum(REPORT_EXPORT_FORMATS).optional(),
});

export const kpiQuerySchema = z.object({
  dateFrom: isoDateSchema,
  dateTo: isoDateSchema,
});

export const notificationListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(25),
  unreadOnly: z.coerce.boolean().optional(),
  event: z.enum(NOTIFICATION_EVENTS).optional(),
});

export type InspectionListQueryInput = z.infer<typeof inspectionListQuerySchema>;
export type ReportQueryInput = z.infer<typeof reportQuerySchema>;
export type KpiQueryInput = z.infer<typeof kpiQuerySchema>;
export type NotificationListQueryInput = z.infer<typeof notificationListQuerySchema>;

/**
 * One row of a saved dashboard arrangement.
 *
 * A `CUSTOM` row names the definition it draws and a built-in row never does: the key
 * alone identifies a catalogue widget, so an id on one would be meaningless, and a
 * `CUSTOM` row without one is an entry pointing at nothing.
 */
const dashboardLayoutEntrySchema = z
  .object({
    key: z.enum(DASHBOARD_LAYOUT_KEYS),
    customWidgetId: objectIdSchema.nullish(),
    visible: z.boolean(),
    size: z.enum(DASHBOARD_WIDGET_SIZES),
  })
  .superRefine((entry, ctx) => {
    const isCustom = entry.key === DASHBOARD_CUSTOM_WIDGET_KEY;
    if (isCustom === (entry.customWidgetId != null)) return;

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['customWidgetId'],
      message: isCustom
        ? 'Өөрийн үүсгэсэн хэсэг аль тодорхойлолтоо зурахаа заана.'
        : 'Каталогийн хэсэгт тодорхойлолт заахгүй.',
    });
  });

/**
 * A saved dashboard arrangement.
 *
 * Every widget must appear exactly once: a layout that lists one twice, or omits one, is a
 * corrupt preference rather than a partial one, and reconciliation happens on read against
 * the catalogue rather than by accepting a ragged payload here. A user-built widget is
 * identified by its definition id rather than by its key, since every one of them shares
 * the same key.
 *
 * The ceiling is the catalogue plus what one person may define, not the catalogue alone:
 * the old cap made a single custom widget structurally impossible to save.
 */
export const dashboardLayoutSchema = z.object({
  widgets: z
    .array(dashboardLayoutEntrySchema)
    .min(1)
    .max(DASHBOARD_WIDGETS.length + DASHBOARD_CUSTOM_WIDGET_LIMIT)
    .superRefine((widgets, ctx) => {
      const identities = widgets.map((entry) =>
        entry.key === DASHBOARD_CUSTOM_WIDGET_KEY
          ? `${DASHBOARD_CUSTOM_WIDGET_KEY}:${String(entry.customWidgetId)}`
          : entry.key,
      );

      if (new Set(identities).size !== identities.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Widget давхардсан байна.',
        });
      }
    }),
});

export type DashboardLayoutInput = z.infer<typeof dashboardLayoutSchema>;

/**
 * A user-built widget definition.
 *
 * Four closed enums and a title. Nothing here is a field name, a collection or an
 * expression: the server maps a dimension and a range onto a fixed path and a fixed
 * window, so a definition can never widen what it reads no matter what is sent.
 */
export const dashboardCustomWidgetSchema = z.object({
  title: z.string().trim().min(1, 'Нэр оруулна уу.').max(60),
  metric: z.enum(DASHBOARD_INSIGHT_METRICS),
  dimension: z.enum(DASHBOARD_INSIGHT_DIMENSIONS),
  range: z.enum(DASHBOARD_INSIGHT_RANGES),
  chart: z.enum(DASHBOARD_INSIGHT_CHARTS),
});

export type DashboardCustomWidgetInput = z.infer<typeof dashboardCustomWidgetSchema>;
