import type {
  ApiResponse,
  CreateMaterialItemInput,
  MaterialItemDto,
  MaterialItemListQueryInput,
  PaginatedData,
  UpdateMaterialItemInput,
} from '@monhorus/shared';

import { apiClient, unwrap } from '../lib/api-client';

/**
 * The material catalogue.
 *
 * Reference data behind the material names typed onto a planned work. Reading and editing
 * are separate endpoints for the reason every catalogue in this system separates them, and
 * there is no delete: an item that is no longer stocked is deactivated.
 */
export const materialService = {
  async list(query: Partial<MaterialItemListQueryInput> = {}): Promise<
    PaginatedData<MaterialItemDto>
  > {
    return unwrap(
      await apiClient.get<ApiResponse<PaginatedData<MaterialItemDto>>>('/materials', {
        params: query,
      }),
    );
  },

  async create(payload: CreateMaterialItemInput): Promise<MaterialItemDto> {
    return unwrap(await apiClient.post<ApiResponse<MaterialItemDto>>('/materials', payload));
  },

  async update(
    materialItemId: string,
    payload: UpdateMaterialItemInput,
  ): Promise<MaterialItemDto> {
    return unwrap(
      await apiClient.patch<ApiResponse<MaterialItemDto>>(
        `/materials/${materialItemId}`,
        payload,
      ),
    );
  },
};
