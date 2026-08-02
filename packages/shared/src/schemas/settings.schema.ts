import { z } from 'zod';

import {
  ALL_SETTING_KEYS,
  SETTING_DEFINITIONS,
  type SettingKey,
  type SettingValue,
} from '../constants/settings';

/**
 * Settings update payload.
 *
 * A partial map: only the keys the administrator actually changed are sent. Each value is
 * validated against its own declaration in the catalogue, so an unknown key is rejected
 * rather than silently stored, and a number cannot be written where a string is declared.
 */
const KEY_SET = new Set<string>(ALL_SETTING_KEYS);

function validateOne(key: SettingKey, value: unknown, ctx: z.RefinementCtx): void {
  const definition = SETTING_DEFINITIONS[key];

  if (definition.type === 'string') {
    if (typeof value !== 'string' || value.trim().length === 0) {
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
    settings: z.record(z.union([z.string(), z.number()])),
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
