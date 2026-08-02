import { z } from 'zod';

/** Mongo ObjectId as a 24-character hex string. */
export const objectIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'ID буруу форматтай байна.');

export const optionalObjectId = objectIdSchema.nullish();

/**
 * Mongolian mobile number, country code optional. Matches the pattern already used
 * by the User model so employee and user records validate identically.
 */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^(\+976)?[- ]?\d{4}[- ]?\d{4}$/, 'Утасны дугаар буруу форматтай байна.');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Имэйл хаяг буруу форматтай байна.')
  .max(254);

/**
 * Mongolian national registration number: two Cyrillic letters followed by eight
 * digits, for example АА12345678.
 */
export const registrationNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[А-ЯӨҮЁ]{2}\d{8}$/, 'Регистрийн дугаар буруу форматтай байна. Жишээ: АА12345678');

/** ISO date string, date-only or full timestamp. */
export const isoDateSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Огноо буруу форматтай байна.');

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const sortDirSchema = z.enum(['asc', 'desc']).default('desc');

/** Accepts the string forms a query string produces as well as real booleans. */
export const booleanQuerySchema = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => value === true || value === 'true' || value === '1');

export function dateOrderRefinement(
  startKey: string,
  endKey: string,
  message: string,
): (value: Record<string, unknown>, ctx: z.RefinementCtx) => void {
  return (value, ctx) => {
    const start = value[startKey];
    const end = value[endKey];
    if (typeof start !== 'string' || typeof end !== 'string') return;
    if (Date.parse(end) < Date.parse(start)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [endKey], message });
    }
  };
}
