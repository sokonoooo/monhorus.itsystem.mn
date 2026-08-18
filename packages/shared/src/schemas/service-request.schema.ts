import { z } from 'zod';

import { MATERIAL_UNITS } from '../constants/material';
import {
  SERVICE_REQUEST_STATUSES,
  SERVICE_REQUEST_TYPES,
  SLA_STATES,
} from '../constants/service-request';
import {
  booleanQuerySchema,
  isoDateSchema,
  objectIdSchema,
  phoneSchema,
  sortDirSchema,
} from './common.schema';
import { planPositionSchema, rejectFloorlessPosition } from './object-master.schema';

/**
 * Requirements section 8.2 marks customer, branch, building, attachments,
 * description, urgency and contact as mandatory; floor, room and device are
 * conditional refinements of the location.
 */
export const createServiceRequestSchema = z
  .object({
    customerId: objectIdSchema,
    branch: z.string().trim().max(200).nullish(),
    projectId: objectIdSchema.nullish(),
    buildingId: objectIdSchema,
    floorId: objectIdSchema.nullish(),
    roomId: objectIdSchema.nullish(),
    panelId: objectIdSchema.nullish(),
    circuitId: objectIdSchema.nullish(),
    deviceId: objectIdSchema.nullish(),
    /**
     * Where on the floor plan the fault is, as a fraction of the drawing's width and
     * height. The SAME shape and the same 0..1 convention an object's placement uses, so a
     * client renders both pins with one piece of code.
     *
     * Independent of `roomId`: a caller who can point at the spot but cannot name a zone —
     * because none has been registered yet — is the ordinary case, not an error. The pin
     * needs a drawing, not a name, so only the floor is required alongside it.
     */
    planPosition: planPositionSchema.nullish(),
    requestType: z.enum(SERVICE_REQUEST_TYPES, { required_error: 'Хүсэлтийн төрөл заавал.' }),
    isUrgent: z.boolean().default(false),
    description: z
      .string()
      .trim()
      .min(5, 'Тайлбар дор хаяж 5 тэмдэгттэй байна.')
      .max(4000, 'Тайлбар 4000 тэмдэгтээс урт байж болохгүй.'),
    contactName: z.string().trim().min(1, 'Холбоо барих хүн заавал.').max(200),
    contactPhone: phoneSchema,
    attachmentIds: z.array(objectIdSchema).max(20).default([]),
  })
  .superRefine(rejectFloorlessPosition);

export const assignServiceRequestSchema = z
  .object({
    employeeIds: z.array(objectIdSchema).max(20).default([]),
    teamId: objectIdSchema.nullish(),
    teamLeaderEmployeeId: objectIdSchema.nullish(),
    note: z.string().trim().max(1000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.employeeIds.length === 0 && !value.teamId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['employeeIds'],
        message: 'Дор хаяж нэг ажилтан эсвэл баг сонгоно.',
      });
    }
    if (
      value.teamLeaderEmployeeId &&
      value.employeeIds.length > 0 &&
      !value.employeeIds.includes(value.teamLeaderEmployeeId)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['teamLeaderEmployeeId'],
        message: 'Багийн ахлагч нь хуваарилагдсан ажилтнуудын нэг байна.',
      });
    }
  });

export const changeServiceRequestStatusSchema = z.object({
  status: z.enum(SERVICE_REQUEST_STATUSES, { required_error: 'Төлөв заавал.' }),
  reason: z.string().trim().max(1000).optional(),
});

export const extendSlaSchema = z.object({
  additionalMinutes: z
    .number()
    .int('Минут бүхэл тоо байна.')
    .positive('Сунгах хугацаа 0-ээс их байна.')
    .max(60 * 24 * 30, 'Нэг удаад 30 хоногоос их сунгах боломжгүй.'),
  reason: z
    .string()
    .trim()
    .min(3, 'SLA сунгах шалтгаан заавал.')
    .max(1000),
});

export const serviceRequestListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(200).optional(),
  status: z.enum(SERVICE_REQUEST_STATUSES).optional(),
  requestType: z.enum(SERVICE_REQUEST_TYPES).optional(),
  isUrgent: booleanQuerySchema.optional(),
  slaState: z.enum(SLA_STATES).optional(),
  customerId: objectIdSchema.optional(),
  projectId: objectIdSchema.optional(),
  buildingId: objectIdSchema.optional(),
  employeeId: objectIdSchema.optional(),
  teamId: objectIdSchema.optional(),
  createdFrom: isoDateSchema.optional(),
  createdTo: isoDateSchema.optional(),
  sortBy: z.enum(['createdAt', 'slaDueAt', 'requestNumber']).default('createdAt'),
  sortDir: sortDirSchema,
});

export type CreateServiceRequestInput = z.infer<typeof createServiceRequestSchema>;
export type AssignServiceRequestInput = z.infer<typeof assignServiceRequestSchema>;
export type ChangeServiceRequestStatusInput = z.infer<typeof changeServiceRequestStatusSchema>;
export type ExtendSlaInput = z.infer<typeof extendSlaSchema>;
export type ServiceRequestListQueryInput = z.infer<typeof serviceRequestListQuerySchema>;

/**
 * What was found on ONE piece of equipment during a service visit.
 *
 * The conclusion used to be written once for the whole request and copied onto every
 * object it named, which made a report claiming the same score for a healthy panel and a
 * failing one. A visit that inspects three objects has three findings, so each carries its
 * own score and narrative and becomes its own ReportItem.
 *
 * `riskLevel` is absent on purpose. Section 10.1 makes the band a function of the score
 * against the thresholds in force, so it is derived server-side; accepting it here would
 * let a caller label a 92 as critical.
 */
export const workReportObjectAssessmentSchema = z.object({
  objectId: objectIdSchema,
  score: z
    .number()
    .int('Оноо бүхэл тоо байна.')
    .min(0, 'Оноо 0-ээс бага байж болохгүй.')
    .max(100, 'Оноо 100-аас их байж болохгүй.')
    .nullish(),
  /** What was observed on this object, as distinct from what was concluded about it. */
  observation: z.string().trim().max(4000).nullish(),
  conclusion: z.string().trim().max(4000).nullish(),
  recommendation: z.string().trim().max(4000).nullish(),
  /** Evidence for THIS object, separate from the request-level before/after pair. */
  photoIds: z.array(objectIdSchema).max(20).default([]),
  /**
   * The equipment's own per-type attributes, answered while writing this report (4.1).
   *
   * NOT PART OF THE FINDING. "This breaker is fused" is a fact about the equipment, true
   * between visits; the score and the narrative above are what this visit observed. So the
   * server writes these onto the OBJECT and the ReportItem keeps none of them — one set of
   * answers, corrected from whichever screen the technician happens to be on.
   *
   * OPTIONAL, AND ABSENT MEANS "NOT ASKED". A row that omits it enforces nothing and clears
   * nothing, so a draft saved before the fields were filled in — and any client that has
   * not been updated — behaves exactly as it did before.
   */
  attributeValues: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export const saveWorkReportSchema = z.object({
  score: z
    .number()
    .int('Оноо бүхэл тоо байна.')
    .min(0, 'Оноо 0-ээс бага байж болохгүй.')
    .max(100, 'Оноо 100-аас их байж болохгүй.')
    .nullish(),
  conclusion: z.string().trim().max(4000).nullish(),
  recommendation: z.string().trim().max(4000).nullish(),
  /**
   * The five office-entered fields, and why these alone are absent-means-untouched.
   *
   * The photo and object lists below are deliberately replace-on-save working copies: the
   * screen that sends them owns them outright. These five are different — they are filled
   * in on the web by a dispatcher, and the employee mobile conclusion screen has no UI for
   * them at all. While they defaulted, a phone save that simply did not mention them was
   * indistinguishable from "clear them", so a technician tapping Save erased the material
   * list (requirements 19.2), both follow-up flags and the revisit date.
   *
   * `.optional()` rather than `.default()` keeps an explicitly sent `[]`/`false`/`null`
   * meaningful, so the web editor can still clear any of them on purpose.
   */
  actionTaken: z.string().trim().max(2000).nullish(),
  repairRequired: z.boolean().optional(),
  revisitRequired: z.boolean().optional(),
  revisitDate: isoDateSchema.nullish(),
  beforePhotoIds: z.array(objectIdSchema).max(20).default([]),
  afterPhotoIds: z.array(objectIdSchema).max(20).default([]),
  /**
   * The registered equipment actually inspected, chosen on site. The request names only a
   * location, so this list is what lets the approved conclusion reach the equipment's own
   * history. Replaced outright on save, exactly as the photo lists are.
   */
  objectIds: z.array(objectIdSchema).max(50).default([]),
  /**
   * Per-equipment findings. The list that actually produces ReportItems.
   *
   * Kept alongside `objectIds` rather than replacing it: naming equipment without yet
   * assessing it is a real intermediate state while a draft is being filled in, and the
   * two are merged server-side so an object in either list reaches the report.
   */
  objectAssessments: z.array(workReportObjectAssessmentSchema).max(50).default([]),
  /**
   * What was used on the job, typed by hand. Requirements 19.2 keeps V1 at "нэр/тоо", so
   * there is no catalogue to pick from and no stock to draw down.
   */
  materials: z
    .array(
      z.object({
        name: z.string().trim().min(1, 'Материалын нэр хоосон байж болохгүй.').max(200),
        quantity: z.number().positive('Тоо хэмжээ 0-ээс их байна.'),
        unit: z.enum(MATERIAL_UNITS).default('PIECE'),
      }),
    )
    .max(200)
    .optional(),
});

export const returnWorkReportSchema = z.object({
  reason: z.string().trim().min(1, 'Буцаах шалтгаан заавал.').max(1000),
});

export type WorkReportObjectAssessmentInput = z.infer<typeof workReportObjectAssessmentSchema>;
export type SaveWorkReportInput = z.infer<typeof saveWorkReportSchema>;
export type ReturnWorkReportInput = z.infer<typeof returnWorkReportSchema>;
