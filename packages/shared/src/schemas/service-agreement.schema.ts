import { z } from 'zod';

import {
  SERVICE_AGREEMENT_STATUSES,
  SERVICE_FREQUENCIES,
  isAgreementReasonRequired,
} from '../constants/service-agreement';
import { SLA_HOURS_STANDARD, SLA_HOURS_URGENT } from '../constants/service-request';
import { isoDateSchema, objectIdSchema } from './common.schema';

/**
 * Requirements 6.2 marks number, customer, dates, service type, SLA, monthly fee and
 * responsible person as mandatory; frequency and calendar rule are conditional; the
 * PDF attachment is optional.
 */
export const createServiceAgreementSchema = z
  .object({
    customerId: objectIdSchema,
    /** Auto-generated when omitted, per requirements 6.2. */
    agreementNumber: z.string().trim().max(64).optional(),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    serviceType: z.string().trim().min(2, 'Үйлчилгээний төрөл заавал.').max(200),
    slaUrgentHours: z
      .number()
      .int()
      .positive()
      .max(720)
      .default(SLA_HOURS_URGENT),
    slaStandardHours: z
      .number()
      .int()
      .positive()
      .max(720)
      .default(SLA_HOURS_STANDARD),
    frequency: z.enum(SERVICE_FREQUENCIES).nullish(),
    calendarRule: z.string().trim().max(500).nullish(),
    monthlyFee: z.number().min(0, 'Сарын төлбөр сөрөг байж болохгүй.'),
    responsibleEmployeeId: objectIdSchema.nullish(),
    notes: z.string().trim().max(2000).nullish(),
  })
  .superRefine((value, ctx) => {
    if (Date.parse(value.endDate) < Date.parse(value.startDate)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'Дуусах огноо эхлэх огнооноос өмнө байж болохгүй.',
      });
    }
    // Requirements 6.2 marks calendar rule conditional on a frequency being set.
    if (value.frequency === 'CUSTOM' && !value.calendarRule) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['calendarRule'],
        message: 'Custom давтамжид calendar rule заавал.',
      });
    }
  });

export const updateServiceAgreementSchema = z
  .object({
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
    serviceType: z.string().trim().min(2).max(200).optional(),
    slaUrgentHours: z.number().int().positive().max(720).optional(),
    slaStandardHours: z.number().int().positive().max(720).optional(),
    frequency: z.enum(SERVICE_FREQUENCIES).nullish(),
    calendarRule: z.string().trim().max(500).nullish(),
    monthlyFee: z.number().min(0).optional(),
    responsibleEmployeeId: objectIdSchema.nullish(),
    notes: z.string().trim().max(2000).nullish(),
  })
  .superRefine((value, ctx) => {
    if (
      value.startDate &&
      value.endDate &&
      Date.parse(value.endDate) < Date.parse(value.startDate)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'Дуусах огноо эхлэх огнооноос өмнө байж болохгүй.',
      });
    }
  });

export const changeAgreementStatusSchema = z
  .object({
    status: z.enum(SERVICE_AGREEMENT_STATUSES),
    reason: z.string().trim().max(1000).optional(),
  })
  .superRefine((value, ctx) => {
    // Requirements 6.3: SUSPENDED and CANCELLED both require a reason.
    if (isAgreementReasonRequired(value.status) && !value.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['reason'],
        message: 'Шалтгаан заавал бөглөнө.',
      });
    }
  });

export type CreateServiceAgreementInput = z.infer<typeof createServiceAgreementSchema>;
export type UpdateServiceAgreementInput = z.infer<typeof updateServiceAgreementSchema>;
export type ChangeAgreementStatusInput = z.infer<typeof changeAgreementStatusSchema>;
