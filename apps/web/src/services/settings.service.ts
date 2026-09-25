import type {
  ApiResponse,
  SettingKey,
  SettingValue,
  SettingsDto,
} from '@monhorus/shared';

import { apiClient, unwrap } from '../lib/api-client';

/**
 * What `POST /files/settings-logo` hands back.
 *
 * Declared here rather than imported, exactly like `ObjectTypeIconUploadDto`: the shared
 * package types the settings catalogue, and this is the stored-file envelope the upload
 * endpoint owns. Only `id` is ever used — it becomes the value of the `general.company_logo`
 * setting — but the whole shape is stated so a change to the endpoint is a compile error
 * rather than an `undefined` that reaches a form field.
 */
export interface SettingsLogoUploadDto {
  id: string;
  name: string;
  downloadUrl: string;
  mimeType: string;
  sizeBytes: number;
}

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

  /**
   * Uploads the company logo and returns the stored file it became.
   *
   * Two-phase, the same shape as an object-type icon: the bytes go up on their own and the
   * id that comes back is what `update` later stores under `general.company_logo`. It has
   * to work this way because a setting value is a string — there is no multipart PATCH of
   * the settings document — and because the admin may still hit Буцаах, in which case the
   * file was parked for nothing and no setting ever named it.
   *
   * The server is the gate: the endpoint requires `settings.manage`, refuses a content type
   * that is not PNG or JPEG, and caps the size. Whatever the form checks before calling
   * this is a courtesy to the user, never a substitute for that.
   *
   * The Content-Type header is set explicitly so the browser is the one that fills in the
   * multipart boundary, matching `objectTypeService.uploadIcon`.
   */
  async uploadLogo(file: File): Promise<SettingsLogoUploadDto> {
    const form = new FormData();
    form.append('file', file);

    return unwrap(
      await apiClient.post<ApiResponse<SettingsLogoUploadDto>>('/files/settings-logo', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }),
    );
  },
};
