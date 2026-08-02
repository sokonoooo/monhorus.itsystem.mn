import type { SettingGroup, SettingKey, SettingValue } from '../constants/settings';

export interface SettingEntryDto {
  key: SettingKey;
  group: SettingGroup;
  label: string;
  hint: string;
  type: 'string' | 'integer' | 'ratio' | 'percent';
  value: SettingValue;
  /** The catalogue default, so the screen can offer a reset and show what changed. */
  defaultValue: SettingValue;
  /** True when an administrator has overridden the default. */
  isOverridden: boolean;
  min?: number;
  max?: number;
  unit?: string;
  updatedByName: string | null;
  updatedAt: string | null;
}

export interface SettingsGroupDto {
  group: SettingGroup;
  label: string;
  description: string;
  entries: readonly SettingEntryDto[];
}

export interface SettingsDto {
  groups: readonly SettingsGroupDto[];
  /** True when the caller may change values, not merely read them. */
  canManage: boolean;
}
