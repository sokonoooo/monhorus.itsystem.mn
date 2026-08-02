import { z } from 'zod';

import {
  INVOICE_BILLING_TYPES,
  INVOICE_EFFECTIVE_STATUSES,
  PAYMENT_METHODS,
} from '../constants/invoice';
import { isoDateSchema, objectIdSchema } from './common.schema';

/** `YYYY-MM`. The period being billed, not the date of issue. */
export const billingPeriodSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Тайлант үе YYYY-MM хэлбэртэй байна.');

/**
 * A manually entered line, requirements 12.2.
 *
 * The generated monthly-fee line is written by the backend from the service agreement and
 * is never accepted from a client, so no `source` field is exposed here.
 */
export const invoiceLineInputSchema = z.object({
  description: z.string().trim().min(1, 'Тайлбар заавал.').max(300),
  quantity: z
    .number()
    .positive('Тоо хэмжээ 0-ээс их байна.')
    .max(1_000_000, 'Тоо хэмжээ хэт их байна.'),
  unitPrice: z
    .number()
    .min(0, 'Нэгж үнэ сөрөг байж болохгүй.')
    .max(1_000_000_000, 'Нэгж үнэ хэт их байна.'),
});

export const createInvoiceSchema = z.object({
  customerId: objectIdSchema,
  /** Optional: an additional-service invoice need not sit under an agreement. */
  serviceAgreementId: objectIdSchema.nullish(),
  billingType: z.enum(INVOICE_BILLING_TYPES),
  billingPeriod: billingPeriodSchema,
  issueDate: isoDateSchema,
  dueDate: isoDateSchema,
  lines: z.array(invoiceLineInputSchema).min(1, 'Хамгийн багадаа нэг мөр байна.').max(50),
  notes: z.string().trim().max(2000).nullish(),
  /** Section 12.3: a replacement records the cancelled invoice it supersedes. */
  replacesInvoiceId: objectIdSchema.nullish(),
});

/**
 * Editing is confined to a draft.
 *
 * A sent invoice has already reached the customer, so it is corrected by cancelling with a
 * reason and issuing a replacement, which is what 12.3 prescribes.
 */
export const updateInvoiceSchema = z.object({
  issueDate: isoDateSchema.optional(),
  dueDate: isoDateSchema.optional(),
  lines: z.array(invoiceLineInputSchema).min(1).max(50).optional(),
  notes: z.string().trim().max(2000).nullish(),
});

export const sendInvoiceSchema = z.object({
  dueDate: isoDateSchema.optional(),
});

/**
 * Requirements 12.3: the amount must equal the invoice total, and the date, method and
 * reference are all mandatory. Equality against the total is checked in the service,
 * which is the only place that knows the total.
 */
export const recordInvoicePaymentSchema = z.object({
  paidAt: isoDateSchema,
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().min(1, 'Гүйлгээний дугаар заавал.').max(120),
  amount: z.number().min(0, 'Дүн сөрөг байж болохгүй.'),
});

export const cancelInvoiceSchema = z.object({
  reason: z.string().trim().min(1, 'Цуцлах шалтгаан заавал.').max(1000),
});

export const invoiceListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(25),
  search: z.string().trim().max(200).optional(),
  customerId: objectIdSchema.optional(),
  status: z.enum(INVOICE_EFFECTIVE_STATUSES).optional(),
  billingType: z.enum(INVOICE_BILLING_TYPES).optional(),
  periodFrom: billingPeriodSchema.optional(),
  periodTo: billingPeriodSchema.optional(),
});

export const invoiceGenerationPreviewQuerySchema = z.object({
  billingPeriod: billingPeriodSchema,
});

/** Generates one monthly invoice per selected customer for the period. */
export const generateMonthlyInvoicesSchema = z.object({
  billingPeriod: billingPeriodSchema,
  issueDate: isoDateSchema,
  dueDate: isoDateSchema,
  customerIds: z.array(objectIdSchema).min(1, 'Хамгийн багадаа нэг харилцагч сонгоно.').max(200),
});

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;
export type SendInvoiceInput = z.infer<typeof sendInvoiceSchema>;
export type RecordInvoicePaymentInput = z.infer<typeof recordInvoicePaymentSchema>;
export type CancelInvoiceInput = z.infer<typeof cancelInvoiceSchema>;
export type InvoiceListQueryInput = z.infer<typeof invoiceListQuerySchema>;
export type InvoiceGenerationPreviewQueryInput = z.infer<
  typeof invoiceGenerationPreviewQuerySchema
>;
export type GenerateMonthlyInvoicesInput = z.infer<typeof generateMonthlyInvoicesSchema>;
