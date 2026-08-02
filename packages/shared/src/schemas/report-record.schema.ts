import { z } from 'zod';

import { REPORT_STATUSES, REPORT_TYPES } from '../constants/report-record';
import { RISK_LEVELS } from '../constants/service-request';
import { isoDateSchema, objectIdSchema, sortDirSchema } from './common.schema';

/**
 * The narrative an author writes on a report.
 *
 * The band is absent because it is a function of the score against the thresholds in
 * force, and the hierarchy is absent because it is resolved server-side from the equipment
 * the items name. Accepting either would let a caller file a report against a building it
 * never touched, or label a 92 as critical.
 */
export const saveReportSchema = z
  .object({
    title: z.string().trim().min(1, 'Гарчиг оруулна уу.').max(200),
    conclusion: z.string().trim().max(8000).nullish(),
    recommendation: z.string().trim().max(8000).nullish(),
  })
  .strict();

/** One per-object finding. The object decides the hierarchy, so no location is accepted. */
export const saveReportItemSchema = z
  .object({
    objectId: objectIdSchema,
    score: z
      .number()
      .int('Оноо бүхэл тоо байна.')
      .min(0, 'Оноо 0-ээс бага байж болохгүй.')
      .max(100, 'Оноо 100-аас их байж болохгүй.')
      .nullish(),
    observation: z.string().trim().max(4000).nullish(),
    conclusion: z.string().trim().max(8000).nullish(),
    recommendation: z.string().trim().max(8000).nullish(),
    evidenceAttachmentIds: z.array(objectIdSchema).max(20).default([]),
  })
  .strict();

/**
 * Assembling several reports, or individual findings from them, into one.
 *
 * Whole reports and loose items are both accepted because a reviewer consolidating a
 * quarter usually wants some reports entire and only the critical findings from others.
 * Selecting an item AND the report that already contains it is refused server-side rather
 * than silently deduplicated: it means the selection said two different things.
 */
export const consolidateReportsSchema = z
  .object({
    title: z.string().trim().min(1, 'Гарчиг оруулна уу.').max(200),
    sourceReportIds: z.array(objectIdSchema).max(100).default([]),
    sourceReportItemIds: z.array(objectIdSchema).max(500).default([]),
    conclusion: z.string().trim().max(8000).nullish(),
    recommendation: z.string().trim().max(8000).nullish(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.sourceReportIds.length + value.sourceReportItemIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceReportIds'],
        message: 'Дор хаяж нэг тайлан эсвэл мөр сонгоно.',
      });
    }
    if (new Set(value.sourceReportIds).size !== value.sourceReportIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceReportIds'],
        message: 'Тайлан давхардсан байна.',
      });
    }
    if (new Set(value.sourceReportItemIds).size !== value.sourceReportItemIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceReportItemIds'],
        message: 'Мөр давхардсан байна.',
      });
    }
  });

export const returnReportSchema = z.object({
  reason: z.string().trim().min(5, 'Буцаах шалтгаан дор хаяж 5 тэмдэгттэй байна.').max(2000),
});

export const reportListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(25),
  search: z.string().trim().max(200).optional(),
  type: z.enum(REPORT_TYPES).optional(),
  status: z.enum(REPORT_STATUSES).optional(),
  riskLevel: z.enum(RISK_LEVELS).optional(),
  customerId: objectIdSchema.optional(),
  projectId: objectIdSchema.optional(),
  buildingId: objectIdSchema.optional(),
  floorId: objectIdSchema.optional(),
  objectId: objectIdSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  sortBy: z.enum(['occurredAt', 'overallScore', 'reportNumber']).default('occurredAt'),
  sortDir: sortDirSchema.default('desc'),
});

export type SaveReportInput = z.infer<typeof saveReportSchema>;
export type SaveReportItemInput = z.infer<typeof saveReportItemSchema>;
export type ConsolidateReportsInput = z.infer<typeof consolidateReportsSchema>;
export type ReturnReportInput = z.infer<typeof returnReportSchema>;
export type ReportListQueryInput = z.infer<typeof reportListQuerySchema>;
