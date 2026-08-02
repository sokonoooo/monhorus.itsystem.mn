import { z } from 'zod';

import { objectIdSchema } from './common.schema';

/**
 * Validation for the consolidated inspection report.
 *
 * Only the narrative belongs here. The heading, the sub-task sections and the overall
 * safety level are all derived from the planned work and its sub-tasks, so accepting them
 * from a caller would let the report disagree with the data it is a report of. The schemas
 * are `.strict()` for the same reason: a request that tries to set `overallLevel` or
 * `version` is a 400 rather than a silent no-op.
 */

/** Free-text line on one of the replacement lists. */
const replacementLineSchema = z.string().trim().min(1).max(500);

export const updateInspectionReportSchema = z
  .object({
    inspectedScope: z.string().trim().max(2000).nullish(),
    issueSummary: z.string().trim().max(20000).nullish(),
    conclusion: z.string().trim().max(20000).nullish(),
    recommendation: z.string().trim().max(20000).nullish(),
    replacementPanels: z.array(replacementLineSchema).max(200).optional(),
    replacementConnections: z.array(replacementLineSchema).max(200).optional(),
  })
  .strict();

/**
 * Returning a report to its author requires a reason.
 *
 * The performer has to know what to fix, and an unexplained return is the thing that turns
 * a review loop into a guessing game, so the reason is mandatory rather than nullable.
 */
export const returnInspectionReportSchema = z
  .object({
    reason: z.string().trim().min(1, 'Буцаах шалтгааныг бичнэ үү.').max(2000),
  })
  .strict();

/** Approving and finalising may carry a note, but do not require one. */
export const reviewInspectionReportSchema = z
  .object({
    note: z.string().trim().max(2000).nullish(),
  })
  .strict();

export const plannedWorkIdParamSchema = z.object({
  plannedWorkId: objectIdSchema,
});

export type UpdateInspectionReportInput = z.infer<typeof updateInspectionReportSchema>;
export type ReturnInspectionReportInput = z.infer<typeof returnInspectionReportSchema>;
export type ReviewInspectionReportInput = z.infer<typeof reviewInspectionReportSchema>;
