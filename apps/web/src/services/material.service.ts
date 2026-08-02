import type {
  ApiResponse,
  CreateMaterialItemInput,
  CreateTaskMaterialUsageInput,
  MaterialItemDto,
  MaterialItemListQueryInput,
  PaginatedData,
  TaskMaterialUsageDto,
  UpdateMaterialItemInput,
  UpdateTaskMaterialUsageInput,
} from '@monhorus/shared';

import { apiClient, unwrap } from '../lib/api-client';

/**
 * The material catalogue, and what a sub-task consumed from it.
 *
 * Usage is addressed through the sub-task rather than the work — `.../tasks/:taskId/materials`
 * — because that is where it is recorded and where the server enforces which planned work
 * the sub-task actually belongs to. Passing the work id in the path is what lets it check
 * the pairing rather than trusting a task id on its own.
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

  async usage(plannedWorkId: string, taskId: string): Promise<TaskMaterialUsageDto[]> {
    return unwrap(
      await apiClient.get<ApiResponse<TaskMaterialUsageDto[]>>(
        `/planned-work/${plannedWorkId}/tasks/${taskId}/materials`,
      ),
    );
  },

  async addUsage(
    plannedWorkId: string,
    taskId: string,
    payload: CreateTaskMaterialUsageInput,
  ): Promise<TaskMaterialUsageDto> {
    return unwrap(
      await apiClient.post<ApiResponse<TaskMaterialUsageDto>>(
        `/planned-work/${plannedWorkId}/tasks/${taskId}/materials`,
        payload,
      ),
    );
  },

  async updateUsage(
    plannedWorkId: string,
    taskId: string,
    usageId: string,
    payload: UpdateTaskMaterialUsageInput,
  ): Promise<TaskMaterialUsageDto> {
    return unwrap(
      await apiClient.patch<ApiResponse<TaskMaterialUsageDto>>(
        `/planned-work/${plannedWorkId}/tasks/${taskId}/materials/${usageId}`,
        payload,
      ),
    );
  },

  async removeUsage(plannedWorkId: string, taskId: string, usageId: string): Promise<void> {
    await apiClient.delete(
      `/planned-work/${plannedWorkId}/tasks/${taskId}/materials/${usageId}`,
    );
  },
};
