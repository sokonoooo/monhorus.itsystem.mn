import { z } from 'zod';

import { CALENDAR_SOURCES } from '../types/calendar.types';
import { dateOrderRefinement, isoDateSchema, objectIdSchema } from './common.schema';

/**
 * Calendar window query.
 *
 * The window is mandatory and bounded: an unbounded calendar query would scan every
 * planned work and every request in the system.
 */
export const MAX_CALENDAR_WINDOW_DAYS = 92;

export const calendarQuerySchema = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
    /** Repeated query parameter, or a single value, or a comma separated list. */
    sources: z
      .union([z.enum(CALENDAR_SOURCES), z.array(z.enum(CALENDAR_SOURCES)), z.string()])
      .optional()
      .transform((value) => {
        if (value === undefined) return undefined;
        if (Array.isArray(value)) return value;
        const parts = String(value)
          .split(',')
          .map((part) => part.trim())
          .filter((part) => (CALENDAR_SOURCES as readonly string[]).includes(part));
        return parts.length > 0 ? (parts as typeof CALENDAR_SOURCES[number][]) : undefined;
      }),
    employeeId: objectIdSchema.optional(),
    teamId: objectIdSchema.optional(),
    customerId: objectIdSchema.optional(),
    projectId: objectIdSchema.optional(),
    buildingId: objectIdSchema.optional(),
    status: z.string().trim().max(40).optional(),
  })
  .superRefine(dateOrderRefinement('from', 'to', 'Хугацааны дуусах өдөр эхлэхээс эрт байна.'))
  .superRefine((value, ctx) => {
    const spanDays = (Date.parse(value.to) - Date.parse(value.from)) / 86_400_000;
    if (spanDays > MAX_CALENDAR_WINDOW_DAYS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: `Хугацааны хязгаар ${MAX_CALENDAR_WINDOW_DAYS} хоногоос их байж болохгүй.`,
      });
    }
  });

export type CalendarQueryInput = z.infer<typeof calendarQuerySchema>;
