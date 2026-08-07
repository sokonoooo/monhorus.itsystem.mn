import type {
  ApiResponse,
  CreateObjectAssessmentInput,
  CreateObjectInput,
  CreateObjectTypeInput,
  ObjectAssessmentDto,
  ObjectCodeSuggestionDto,
  ObjectDetailDto,
  ObjectHistoryDto,
  ObjectListItemDto,
  ObjectListQuery,
  ObjectPhotoDto,
  ObjectTypeDto,
  ObjectTypeListQuery,
  PaginatedData,
  UpdateObjectInput,
  UpdateObjectPositionInput,
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

/**
 * What `POST /files/object-type-icons` hands back.
 *
 * Declared here rather than imported: the shared package types the object-type registry
 * itself, and the upload response is a stored-file envelope the endpoint owns. Only `id`
 * is ever used — it becomes `iconFileId` on the type that claims the file — but the whole
 * shape is stated so a change to the endpoint is a compile error rather than `undefined`.
 */
export interface ObjectTypeIconUploadDto {
  id: string;
  name: string;
  downloadUrl: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByName: string | null;
  uploadedAt: string;
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

  /**
   * Uploads a custom SVG icon before the type that will carry it exists.
   *
   * Two-phase, exactly like a service-request attachment: the file is parked on the
   * uploader and claimed by `create` or `update` through `iconFileId`, because a new type
   * has no id to hang a file on at the moment the admin picks one.
   *
   * The server is the gate. It caps the request at MAX_OBJECT_TYPE_ICON_BYTES, refuses any
   * content type but OBJECT_TYPE_ICON_MIME, and then PARSES the bytes — which is what
   * actually establishes the thing is an SVG — sanitising it before a byte is stored.
   * Whatever a form checks before calling this is a courtesy to the user, never a
   * substitute for that.
   */
  async uploadIcon(file: File): Promise<ObjectTypeIconUploadDto> {
    const form = new FormData();
    form.append('file', file);

    return unwrap(
      await apiClient.post<ApiResponse<ObjectTypeIconUploadDto>>(
        '/files/object-type-icons',
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      ),
    );
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

  /**
   * Asks for the next free code under a panel.
   *
   * The backend answers because uniqueness is per customer and enforced by an index this
   * page cannot see. What comes back fills the field and nothing more — it is not reserved,
   * and the user stays free to type over it.
   */
  async codeSuggestion(panelId: string): Promise<ObjectCodeSuggestionDto> {
    return unwrap(
      await apiClient.get<ApiResponse<ObjectCodeSuggestionDto>>('/objects-master/code-suggestion', {
        params: { panelId },
      }),
    );
  },

  async update(objectId: string, payload: UpdateObjectInput): Promise<ObjectDetailDto> {
    return unwrap(
      await apiClient.patch<ApiResponse<ObjectDetailDto>>(`/objects-master/${objectId}`, payload),
    );
  },

  /**
   * Moves or clears the object's pin on the floor plan.
   *
   * Its own endpoint so dragging a marker does not have to round-trip the strict
   * per-category update payload just to change two numbers.
   */
  async updatePosition(
    objectId: string,
    payload: UpdateObjectPositionInput,
  ): Promise<ObjectDetailDto> {
    return unwrap(
      await apiClient.patch<ApiResponse<ObjectDetailDto>>(
        `/objects-master/${objectId}/position`,
        payload,
      ),
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
