import type {
  ApiResponse,
  SettingKey,
  SettingValue,
  SettingsDto,
} from '@monhorus/shared';

import { apiClient, unwrap } from '../lib/api-client';

export const settingsService = {
  async get(): Promise<SettingsDto> {
    return unwrap(await apiClient.get<ApiResponse<SettingsDto>>('/settings'));
  },

  /** Sends only the keys the administrator actually changed. */
  async update(settings: Partial<Record<SettingKey, SettingValue>>): Promise<SettingsDto> {
    return unwrap(await apiClient.patch<ApiResponse<SettingsDto>>('/settings', { settings }));
  },

  async reset(key: SettingKey): Promise<SettingsDto> {
    return unwrap(await apiClient.delete<ApiResponse<SettingsDto>>(`/settings/${key}`));
  },
};
