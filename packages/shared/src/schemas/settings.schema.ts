import { z } from 'zod';

import {
  ALL_SETTING_KEYS,
  SETTING_DEFINITIONS,
  type SettingKey,
  type SettingValue,
} from '../constants/settings';
import {
  RISK_COLOURS,
  validateRiskBands,
  type RiskBandConfig,
} from '../constants/risk-band';
import { RISK_LEVELS } from '../constants/service-request';
import {
  STAGE_COLOURS,
  validateStages,
  type ServiceRequestStage,
} from '../constants/service-request-stage';
import { SERVICE_REQUEST_STATUSES } from '../constants/service-request';

/**
 * Settings update payload.
 *
 * A partial map: only the keys the administrator actually changed are sent. Each value is
 * validated against its own declaration in the catalogue, so an unknown key is rejected
 * rather than silently stored, and a number cannot be written where a string is declared.
 */
const KEY_SET = new Set<string>(ALL_SETTING_KEYS);

const stageSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[A-Z0-9_]+$/, 'Түлхүүр нь зөвхөн том үсэг, тоо, доогуур зураас байна.'),
  label: z.string().trim().min(1).max(60),
  colour: z.enum(STAGE_COLOURS),
  statuses: z.array(z.enum(SERVICE_REQUEST_STATUSES)).min(1),
  entryStatus: z.enum(SERVICE_REQUEST_STATUSES),
  hidden: z.boolean(),
  onBoard: z.boolean(),
});

const stageListSchema = z.array(stageSchema).min(1).max(20);

const riskBandSchema = z.object({
  key: z.enum(RISK_LEVELS),
  label: z.string().trim().min(1).max(60),
  colour: z.enum(RISK_COLOURS),
  minScore: z.number().int().min(0).max(100),
  requiresConclusion: z.boolean(),
  requiresRecommendation: z.boolean(),
  decommissions: z.boolean(),
  notifies: z.boolean(),
});

const riskBandListSchema = z.array(riskBandSchema).min(2).max(RISK_LEVELS.length);

function validateOne(key: SettingKey, value: unknown, ctx: z.RefinementCtx): void {
  const definition = SETTING_DEFINITIONS[key];

  /**
   * A stage list is checked twice: once for the shape of each row, and once for the
   * whole-list rules — every status owned by exactly one stage, no duplicate keys, an
   * entry status the stage actually holds. The second pass is what stops a request
   * having nowhere to appear, so it cannot be expressed row by row.
   */
  /**
   * The ladder is checked row by row and then as a whole: the second pass is what proves
   * a score cannot fall between two bands, which no single row can answer.
   */
  if (definition.type === 'riskBands') {
    const parsed = riskBandListSchema.safeParse(value);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['settings', key, ...issue.path],
          message: issue.message,
        });
      }
      return;
    }
    for (const message of validateRiskBands(parsed.data as unknown as RiskBandConfig[])) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['settings', key], message });
    }
    return;
  }

  if (definition.type === 'stages') {
    const parsed = stageListSchema.safeParse(value);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['settings', key, ...issue.path],
          message: issue.message,
        });
      }
      return;
    }
    for (const message of validateStages(parsed.data as unknown as ServiceRequestStage[])) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['settings', key], message });
    }
    return;
  }

  /**
   * A file setting carries the id of an already-uploaded `StoredFile`, and an empty
   * string clears it.
   *
   * Only the SHAPE is checked here. Whether the id names a real file, and whether that
   * file is one this setting is allowed to point at, is the server's business — a shared
   * schema has no database to ask, and pretending otherwise would put a check here that
   * looks authoritative and is not.
   */
  if (definition.type === 'file') {
    if (typeof value !== 'string') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: 'Файлын ID буруу.' });
      return;
    }
    if (value !== '' && !/^[a-f\d]{24}$/i.test(value)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: 'Файлын ID буруу.' });
    }
    return;
  }

  if (definition.type === 'string') {
    // An empty default declares the field optional: a setting nobody has filled in is a
    // blank line on a report, not an error a person has to clear before saving anything
    // else on the page.
    const optional = definition.default === '';
    if (typeof value !== 'string' || (!optional && value.trim().length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: 'Утга хоосон байж болохгүй.',
      });
    } else if (value.length > 200) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: 'Утга 200 тэмдэгтээс их байж болохгүй.',
      });
    }
    return;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: 'Тоон утга оруулна уу.' });
    return;
  }

  if (definition.type === 'integer' && !Number.isInteger(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: 'Бүхэл тоо оруулна уу.' });
    return;
  }

  if (definition.min !== undefined && value < definition.min) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [key],
      message: `Утга ${definition.min}-ээс бага байж болохгүй.`,
    });
  }
  if (definition.max !== undefined && value > definition.max) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [key],
      message: `Утга ${definition.max}-аас их байж болохгүй.`,
    });
  }
}

export const updateSettingsSchema = z
  .object({
    settings: z.record(z.union([z.string(), z.number(), z.array(z.unknown())])),
  })
  .superRefine((payload, ctx) => {
    const entries = Object.entries(payload.settings);

    if (entries.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['settings'],
        message: 'Өөрчлөх утга алга.',
      });
    }

    for (const [key, value] of entries) {
      if (!KEY_SET.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['settings', key],
          message: 'Тохиргооны түлхүүр бүртгэлгүй байна.',
        });
        continue;
      }
      validateOne(key as SettingKey, value, ctx);
    }
  });

export type UpdateSettingsInput = {
  settings: Partial<Record<SettingKey, SettingValue>>;
};
