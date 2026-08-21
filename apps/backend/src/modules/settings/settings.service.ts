import {
  ALL_SETTING_KEYS,
  PERMISSIONS,
  SETTING_DEFINITIONS,
  SETTING_GROUPS,
  SETTING_GROUP_DESCRIPTIONS,
  SETTING_GROUP_LABELS,
  defaultSettings,
  requestStagesOf,
  riskBandsOf,
  slaConfigOf,
  validateSettings,
  type RiskBand,
  type ServiceRequestStage,
  type SettingEntryDto,
  type SettingKey,
  type SettingValue,
  type SettingsDto,
  type SettingsMap,
  type SlaConfig,
  type UpdateSettingsInput,
} from '@monhorus/shared';
import { Types } from 'mongoose';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import type { AuthContext } from '../../common/types/express';
import type { RequestMeta } from '../../common/utils/request-meta.util';
import { hasPermission } from '../../middlewares/authorize.middleware';
import { recordAudit } from '../audit/audit.service';
import { Setting } from './setting.model';

/**
 * System settings (requirements section 16.1).
 *
 * Every read of an SLA deadline or a risk band goes through here, so the resolved map is
 * cached in process for a short window rather than fetched per call. The cache is
 * invalidated immediately on write, and the TTL bounds how long a second application
 * instance can keep serving a stale value after another instance changes it. A setting
 * change is an infrequent administrative act, so a few seconds of skew is acceptable and
 * far cheaper than a query on every SLA computation.
 */
const CACHE_TTL_MS = 15_000;

let cached: { map: SettingsMap; expiresAt: number } | null = null;

/** Test seam, and used by the write path to publish a change immediately. */
export function invalidateSettingsCache(): void {
  cached = null;
}

/**
 * Resolves every declared key: catalogue defaults overlaid with stored overrides.
 *
 * A stored key that is no longer declared is ignored rather than returned, so removing a
 * setting from the catalogue cannot resurrect it through old data.
 */
export async function getSettings(): Promise<SettingsMap> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.map;

  const rows = await Setting.find().lean();
  const map = defaultSettings();
  const declared = new Set<string>(ALL_SETTING_KEYS);

  for (const row of rows) {
    if (!declared.has(row.key)) continue;
    map[row.key as SettingKey] = row.value;
  }

  cached = { map, expiresAt: now + CACHE_TTL_MS };
  return map;
}

/** Convenience wrappers so callers do not repeat the derivation. */
export async function getSlaConfig(): Promise<SlaConfig> {
  return slaConfigOf(await getSettings());
}

export async function getRiskBands(): Promise<RiskBand[]> {
  return riskBandsOf(await getSettings());
}

export async function getRequestStages(): Promise<readonly ServiceRequestStage[]> {
  return requestStagesOf(await getSettings());
}

// -- Presentation ------------------------------------------------------------

export async function getSettingsDto(actor: AuthContext): Promise<SettingsDto> {
  const map = await getSettings();
  const rows = await Setting.find().lean();
  const overrides = new Map(rows.map((row) => [row.key, row]));

  const groups = SETTING_GROUPS.map((group) => {
    const entries: SettingEntryDto[] = ALL_SETTING_KEYS.filter(
      (key) => SETTING_DEFINITIONS[key].group === group,
    ).map((key) => {
      const definition = SETTING_DEFINITIONS[key];
      const override = overrides.get(key);

      return {
        key,
        group: definition.group,
        label: definition.label,
        hint: definition.hint,
        type: definition.type,
        value: map[key],
        defaultValue: definition.default,
        isOverridden: override !== undefined,
        ...(definition.min === undefined ? {} : { min: definition.min }),
        ...(definition.max === undefined ? {} : { max: definition.max }),
        ...(definition.unit === undefined ? {} : { unit: definition.unit }),
        updatedByName: override?.updatedByName ?? null,
        updatedAt: override?.updatedAt ? new Date(override.updatedAt).toISOString() : null,
      };
    });

    return {
      group,
      label: SETTING_GROUP_LABELS[group],
      description: SETTING_GROUP_DESCRIPTIONS[group],
      entries,
    };
  });

  return { groups, canManage: hasPermission(actor, PERMISSIONS.SETTINGS_MANAGE) };
}

// -- Write -------------------------------------------------------------------

export interface SettingsUpdateResult {
  changed: SettingKey[];
  settings: SettingsDto;
}

/**
 * Applies a partial settings change.
 *
 * The whole map is validated after the patch is applied, not just the supplied keys,
 * because the rules that matter are relationships: the at-risk threshold must exceed the
 * near-breach threshold, and the four evaluation minimums must stay strictly descending.
 * Validating only the changed key would let a valid-looking edit produce an invalid pair.
 *
 * Requirements 14.4 lists settings among the actions that must be logged, so each changed
 * key produces its own audit row carrying the old and the new value.
 */
export async function updateSettings(
  input: UpdateSettingsInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<SettingsUpdateResult> {
  const current = await getSettings();
  const patch = input.settings;

  const proposed: SettingsMap = { ...current };
  const changed: SettingKey[] = [];

  for (const [rawKey, value] of Object.entries(patch)) {
    const key = rawKey as SettingKey;
    if (value === undefined) continue;
    // Ignore a no-op so it does not produce an empty audit row.
    if (current[key] === value) continue;
    proposed[key] = value as SettingValue;
    changed.push(key);
  }

  if (changed.length === 0) {
    throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Өөрчлөгдсөн утга алга.');
  }

  const issues = validateSettings(proposed);
  if (issues.length > 0) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Тохиргооны утгууд хоорондоо зөрчилдөж байна.',
      issues.map((issue) => ({ field: issue.key ?? 'settings', message: issue.message })),
    );
  }

  for (const key of changed) {
    await Setting.updateOne(
      { key },
      {
        $set: {
          key,
          value: proposed[key],
          updatedBy: new Types.ObjectId(actor.userId),
          updatedByName: actor.fullName,
        },
      },
      { upsert: true },
    );

    await recordAudit({
      entityType: 'Setting',
      action: 'Updated',
      actor: { id: actor.userId, role: actor.role, label: actor.fullName },
      meta,
      reason: `setting ${key} changed`,
      oldValue: { key, value: current[key] },
      newValue: { key, value: proposed[key] },
    });
  }

  // Publish immediately so the very next SLA computation sees the new window.
  invalidateSettingsCache();

  return { changed, settings: await getSettingsDto(actor) };
}

/** Restores a key to its catalogue default by removing the override. */
export async function resetSetting(
  key: SettingKey,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<SettingsDto> {
  const current = await getSettings();
  const existing = await Setting.findOne({ key });

  if (!existing) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Энэ тохиргоо анхны утгаараа байна.');
  }

  const proposed: SettingsMap = { ...current, [key]: SETTING_DEFINITIONS[key].default };
  const issues = validateSettings(proposed);
  if (issues.length > 0) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Анхны утгад буцаахад бусад тохиргоотой зөрчилдөж байна.',
      issues.map((issue) => ({ field: issue.key ?? 'settings', message: issue.message })),
    );
  }

  await Setting.deleteOne({ key });

  await recordAudit({
    entityType: 'Setting',
    action: 'Updated',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    reason: `setting ${key} reset to default`,
    oldValue: { key, value: existing.value },
    newValue: { key, value: SETTING_DEFINITIONS[key].default },
  });

  invalidateSettingsCache();
  return getSettingsDto(actor);
}
