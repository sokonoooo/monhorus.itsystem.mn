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
