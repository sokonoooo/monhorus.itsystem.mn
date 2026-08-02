import type {
  ApiResponse,
  CreateObjectAssessmentInput,
  CreateObjectInput,
  CreateObjectTypeInput,
  ObjectAssessmentDto,
  ObjectDetailDto,
  ObjectHistoryDto,
  ObjectListItemDto,
  ObjectListQuery,
  ObjectPhotoDto,
  ObjectTypeDto,
  ObjectTypeListQuery,
  PaginatedData,
  UpdateObjectInput,
  UpdateObjectTypeInput,
} from '@monhorus/shared';

import { apiClient, unwrap } from '../lib/api-client';

function toParams(query: Record<string, unknown>): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params[key] = typeof value === 'boolean' ? String(value) : (value as string | number);
  }
  return params;
}

/** Section 4.1 equipment type registry. */
export const objectTypeService = {
  async list(query: ObjectTypeListQuery = {}): Promise<PaginatedData<ObjectTypeDto>> {
    return unwrap(
      await apiClient.get<ApiResponse<PaginatedData<ObjectTypeDto>>>('/object-types', {
        params: toParams(query as Record<string, unknown>),
      }),
    );
  },

  async create(payload: CreateObjectTypeInput): Promise<ObjectTypeDto> {
    return unwrap(await apiClient.post<ApiResponse<ObjectTypeDto>>('/object-types', payload));
  },

  async update(objectTypeId: string, payload: UpdateObjectTypeInput): Promise<ObjectTypeDto> {
    return unwrap(
      await apiClient.patch<ApiResponse<ObjectTypeDto>>(`/object-types/${objectTypeId}`, payload),
    );
  },

  async remove(objectTypeId: string): Promise<void> {
    await apiClient.delete(`/object-types/${objectTypeId}`);
  },
};

/**
 * Object master data. Objects live here and are only referenced by a floor, so there is
 * deliberately no endpoint that creates an object as part of a floor.
 */
export const objectMasterService = {
  async list(query: ObjectListQuery = {}): Promise<PaginatedData<ObjectListItemDto>> {
    return unwrap(
      await apiClient.get<ApiResponse<PaginatedData<ObjectListItemDto>>>('/objects-master', {
        params: toParams(query as Record<string, unknown>),
      }),
    );
  },

  async getById(objectId: string): Promise<ObjectDetailDto> {
    return unwrap(await apiClient.get<ApiResponse<ObjectDetailDto>>(`/objects-master/${objectId}`));
  },

  async create(payload: CreateObjectInput): Promise<ObjectDetailDto> {
    return unwrap(await apiClient.post<ApiResponse<ObjectDetailDto>>('/objects-master', payload));
  },

  async update(objectId: string, payload: UpdateObjectInput): Promise<ObjectDetailDto> {
    return unwrap(
      await apiClient.patch<ApiResponse<ObjectDetailDto>>(`/objects-master/${objectId}`, payload),
    );
  },

  async remove(objectId: string): Promise<void> {
    await apiClient.delete(`/objects-master/${objectId}`);
  },

  /**
   * Uploads one evidence photo ahead of the assessment that will carry it.
   *
   * The assessment is written in one shot with its `photoIds`, so the file is parked on
   * the uploader and claimed by the entry, the same way a service-request attachment is.
   */
  async uploadAssessmentPhoto(file: File): Promise<ObjectPhotoDto> {
    const form = new FormData();
    form.append('file', file);

    return unwrap(
      await apiClient.post<ApiResponse<ObjectPhotoDto>>('/files/object-assessment-photos', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }),
    );
  },

  /** Append-only: there is no update or delete counterpart by design. */
  async recordAssessment(
    objectId: string,
    payload: CreateObjectAssessmentInput,
  ): Promise<ObjectAssessmentDto> {
    return unwrap(
      await apiClient.post<ApiResponse<ObjectAssessmentDto>>(
        `/objects-master/${objectId}/assessments`,
        payload,
      ),
    );
  },

  async history(objectId: string): Promise<ObjectHistoryDto> {
    return unwrap(
      await apiClient.get<ApiResponse<ObjectHistoryDto>>(`/objects-master/${objectId}/history`),
    );
  },
};
