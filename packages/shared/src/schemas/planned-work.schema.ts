import { z } from 'zod';

import { MATERIAL_UNITS } from '../constants/material';
import {
  PLANNED_WORK_ACTIONS,
  PLANNED_WORK_EFFECTIVE_STATUSES,
  PLANNED_WORK_REPORT_STATUSES,
} from '../constants/planned-work';
import {
  booleanQuerySchema,
  dateOrderRefinement,
  isoDateSchema,
  objectIdSchema,
  sortDirSchema,
} from './common.schema';

/**
 * Planned work contracts.
 *
 * Note what is absent by design: there is no `status` field on any create or update
 * schema. Lifecycle status is only ever changed through the transition endpoint, so a
 * generic PATCH cannot write it.
 */
export const createPlannedWorkSchema = z
  .object({
    /**
     * A planned work belongs to at most one project. A project may own any number of
     * planned works, in any combination of buildings and periods, so there is no
     * uniqueness constraint here. The project is optional: internal maintenance, ad hoc
     * jobs and work on a site with no project anchor on the building alone.
     */
    projectId: objectIdSchema.nullish(),
    buildingId: objectIdSchema,
    title: z.string().trim().min(3, 'Ажлын нэр дор хаяж 3 тэмдэгттэй байна.').max(200),
    description: z.string().trim().max(4000).nullish(),
    plannedStartDate: isoDateSchema,
    plannedEndDate: isoDateSchema,
    assignedEmployeeIds: z.array(objectIdSchema).max(20).default([]),
    assignedTeamId: objectIdSchema.nullish(),
  })
  .superRefine(
    dateOrderRefinement(
      'plannedStartDate',
      'plannedEndDate',
      'Дуусах огноо эхлэх огнооноос эрт байж болохгүй.',
    ),
  );

export const updatePlannedWorkSchema = z
  .object({
    title: z.string().trim().min(3).max(200).optional(),
    description: z.string().trim().max(4000).nullish(),
    /**
     * The start date stays editable while the work has not begun. The END date is not
     * editable here: extending a deadline is a reschedule, which needs its own
     * permission, a mandatory reason and an audit record.
     */
    plannedStartDate: isoDateSchema.optional(),
    assignedEmployeeIds: z.array(objectIdSchema).max(20).optional(),
    assignedTeamId: objectIdSchema.nullish(),
    buildingId: objectIdSchema.optional(),
  })
  .strict();

/**
 * Authorised schedule change. This is the only path that may clear an overdue state,
 * which is why the reason is mandatory rather than optional.
 */
export const reschedulePlannedWorkSchema = z.object({
  plannedEndDate: isoDateSchema,
  reason: z.string().trim().min(5, 'Хугацаа сунгах шалтгаан дор хаяж 5 тэмдэгттэй байна.').max(1000),
});

export const plannedWorkTransitionSchema = z.object({
  action: z.enum(PLANNED_WORK_ACTIONS, { required_error: 'Үйлдэл заавал.' }),
  reason: z.string().trim().max(1000).nullish(),
  /**
   * The crew, supplied with APPROVE and ignored by every other action.
   *
   * Not required by the schema, because "required" here depends on the action and a schema
   * that enforced it would reject a perfectly good CANCEL for lacking a crew. The rule that
   * APPROVE needs at least one employee lives with the transition, next to the matrix flag
   * that declares it — see `assignsCrew`.
   */
  assignedEmployeeIds: z.array(objectIdSchema).max(20).default([]),
});

// -- Tasks -------------------------------------------------------------------

export const createPlannedWorkTaskSchema = z
  .object({
    floorId: objectIdSchema.nullish(),
    title: z.string().trim().min(2, 'Дэд ажлын нэр заавал.').max(200),
    description: z.string().trim().max(2000).nullish(),
    unit: z.enum(MATERIAL_UNITS).default('PIECE'),
    /** Quantity-based progress needs a positive denominator. */
    totalQuantity: z.number().positive('Хийх тоо хэмжээ 0-ээс их байна.'),
    plannedStartDate: isoDateSchema,
    plannedEndDate: isoDateSchema,
    assignedEmployeeId: objectIdSchema.nullish(),
    /**
     * Master-data equipment this sub-task covers. Approving the consolidated report lands
     * the sub-task's result on each named object, so a result recorded against a job also
     * reaches the equipment it describes. Empty is a standalone sub-task whose result
     * moves no equipment figure.
     */
    relatedObjectIds: z.array(objectIdSchema).max(50).default([]),
  })
  .superRefine(
    dateOrderRefinement(
      'plannedStartDate',
      'plannedEndDate',
      'Дэд ажлын дуусах огноо эхлэх огнооноос эрт байж болохгүй.',
    ),
  );

/**
 * Task update.
 *
 * `status` is absent: task status is derived from completed quantity plus the evidence
 * gate. A user cannot mark a task DONE by choosing the status.
 */
export const updatePlannedWorkTaskSchema = z
  .object({
    floorId: objectIdSchema.nullish(),
    title: z.string().trim().min(2).max(200).optional(),
    description: z.string().trim().max(2000).nullish(),
    unit: z.enum(MATERIAL_UNITS).optional(),
    totalQuantity: z.number().positive('Хийх тоо хэмжээ 0-ээс их байна.').optional(),
    plannedStartDate: isoDateSchema.optional(),
    plannedEndDate: isoDateSchema.optional(),
    assignedEmployeeId: objectIdSchema.nullish(),
    relatedObjectIds: z.array(objectIdSchema).max(50).optional(),
  })
  .strict();

/**
 * Progress entry, available to a worker holding planned_work.record_progress.
 *
 * The band is deliberately absent: section 10.1 derives it from the score, so accepting
 * one here would let a caller label a 92 as critical.
 *
 * `Дүгнэлт` used to be absent as well, on the rule that a sub-task carries only a `note`
 * (Тайлбар) and the conclusion belongs to the consolidated report. That rule is reversed:
 * each sub-task's result is fanned out to its related equipment as its own ReportItem, and
 * an item written with no conclusion left the Дүгнэлт column of Үзлэг ба дүгнэлт blank for
 * every planned-work row while a manual object assessment filled it. The consolidated
 * report keeps its own conclusion; this one describes the equipment the sub-task covers.
 */
export const recordTaskProgressSchema = z
  .object({
    completedQuantity: z.number().min(0, 'Биелэлт сөрөг байж болохгүй.'),
    /** Marks the task as begun when no quantity is complete yet. */
    started: z.boolean().optional(),
    /** A deliberately skipped task is excluded from the completion gate. */
    skipped: z.boolean().optional(),
    note: z.string().trim().max(4000).nullish(),
    /** Reaches the ReportItem of every object this sub-task covers. */
    conclusion: z.string().trim().max(4000).nullish(),
    score: z
      .number()
      .int('Оноо бүхэл тоо байна.')
      .min(0, 'Оноо 0-ээс бага байж болохгүй.')
      .max(100, 'Оноо 100-аас их байж болохгүй.')
      .nullish(),
    recommendation: z.string().trim().max(4000).nullish(),
  })
  .strict();

/**
 * The whole material list is sent at once: the drawer edits it as a table, so a partial
 * update would need an identifier for a row that is only a name and a number.
 */
export const plannedWorkMaterialsSchema = z.object({
  materials: z
    .array(
      z.object({
        name: z.string().trim().min(1, 'Материалын нэр хоосон байж болохгүй.').max(200),
        quantity: z.number().positive('Тоо хэмжээ 0-ээс их байна.'),
        unit: z.enum(MATERIAL_UNITS).default('PIECE'),
      }),
    )
    .max(200)
    .superRefine((items, ctx) => {
      const seen = new Set<string>();
      for (const [index, item] of items.entries()) {
        const key = item.name.toLocaleLowerCase('mn');
        if (seen.has(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, 'name'],
            message: 'Материал давхардсан байна.',
          });
        }
        seen.add(key);
      }
    }),
});

// -- Report workflow ---------------------------------------------------------

export const updatePlannedWorkReportSchema = z
  .object({
    conclusion: z.string().trim().max(8000).nullish(),
    recommendation: z.string().trim().max(8000).nullish(),
  })
  .strict();

export const returnPlannedWorkReportSchema = z.object({
  reason: z.string().trim().min(5, 'Буцаах шалтгаан дор хаяж 5 тэмдэгттэй байна.').max(2000),
});

// -- Queries -----------------------------------------------------------------

export const plannedWorkListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(200).optional(),
  customerId: objectIdSchema.optional(),
  projectId: objectIdSchema.optional(),
  buildingId: objectIdSchema.optional(),
  employeeId: objectIdSchema.optional(),
  teamId: objectIdSchema.optional(),
  /** Filters on effective status, so OVERDUE is accepted here. */
  status: z.enum(PLANNED_WORK_EFFECTIVE_STATUSES).optional(),
  reportStatus: z.enum(PLANNED_WORK_REPORT_STATUSES).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  includeArchived: booleanQuerySchema.optional(),
  sortBy: z
    .enum(['plannedStartDate', 'plannedEndDate', 'workNumber', 'createdAt'])
    .default('plannedStartDate'),
  sortDir: sortDirSchema,
});

export type CreatePlannedWorkInput = z.infer<typeof createPlannedWorkSchema>;
export type UpdatePlannedWorkInput = z.infer<typeof updatePlannedWorkSchema>;
export type ReschedulePlannedWorkInput = z.infer<typeof reschedulePlannedWorkSchema>;
export type PlannedWorkTransitionInput = z.infer<typeof plannedWorkTransitionSchema>;
export type CreatePlannedWorkTaskInput = z.infer<typeof createPlannedWorkTaskSchema>;
export type UpdatePlannedWorkTaskInput = z.infer<typeof updatePlannedWorkTaskSchema>;
export type RecordTaskProgressInput = z.infer<typeof recordTaskProgressSchema>;
export type PlannedWorkMaterialsInput = z.infer<typeof plannedWorkMaterialsSchema>;
export type UpdatePlannedWorkReportInput = z.infer<typeof updatePlannedWorkReportSchema>;
export type ReturnPlannedWorkReportInput = z.infer<typeof returnPlannedWorkReportSchema>;
export type PlannedWorkListQueryInput = z.infer<typeof plannedWorkListQuerySchema>;
