import type {
  ApiResponse,
  CreatePlannedWorkInput,
  CreatePlannedWorkTaskInput,
  PaginatedData,
  PlannedWorkAction,
  PlannedWorkDto,
  PlannedWorkListItemDto,
  PlannedWorkListQuery,
  PlannedWorkMaterialsInput,
  PlannedWorkReportDto,
  PlannedWorkReportPreviewDto,
  RecordTaskProgressInput,
  ReschedulePlannedWorkInput,
  ReturnPlannedWorkReportInput,
  UpdatePlannedWorkInput,
  UpdatePlannedWorkReportInput,
  UpdatePlannedWorkTaskInput,
} from '@monhorus/shared';

import { apiClient, unwrap } from '../lib/api-client';

export interface ReportBundle {
  report: PlannedWorkReportDto | null;
  preview: PlannedWorkReportPreviewDto | null;
}

function toParams(query: Record<string, unknown>): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params[key] = typeof value === 'boolean' ? String(value) : (value as string | number);
  }
  return params;
}

/**
 * Planned work API surface.
 *
 * Note what is missing: nothing here can write a lifecycle status or a deadline directly.
 * Status changes go through `transition`, deadline changes through `reschedule`, and both
 * are validated and audited by the backend.
 */
export const plannedWorkService = {
  async list(query: PlannedWorkListQuery = {}): Promise<PaginatedData<PlannedWorkListItemDto>> {
    return unwrap(
      await apiClient.get<ApiResponse<PaginatedData<PlannedWorkListItemDto>>>('/planned-work', {
        params: toParams(query as Record<string, unknown>),
      }),
    );
  },

  async getById(plannedWorkId: string): Promise<PlannedWorkDto> {
    return unwrap(
      await apiClient.get<ApiResponse<PlannedWorkDto>>(`/planned-work/${plannedWorkId}`),
    );
  },

  async create(payload: CreatePlannedWorkInput): Promise<PlannedWorkDto> {
    return unwrap(await apiClient.post<ApiResponse<PlannedWorkDto>>('/planned-work', payload));
  },

  async update(plannedWorkId: string, payload: UpdatePlannedWorkInput): Promise<PlannedWorkDto> {
    return unwrap(
      await apiClient.patch<ApiResponse<PlannedWorkDto>>(
        `/planned-work/${plannedWorkId}`,
        payload,
      ),
    );
  },

  /** The only path that changes lifecycle status. */
  async transition(
    plannedWorkId: string,
    action: PlannedWorkAction,
    reason?: string | null,
  ): Promise<PlannedWorkDto> {
    return unwrap(
      await apiClient.post<ApiResponse<PlannedWorkDto>>(
        `/planned-work/${plannedWorkId}/transition`,
        { action, reason: reason ?? null },
      ),
    );
  },

  /** The only path that changes the planned end date. */
  async reschedule(
    plannedWorkId: string,
    payload: ReschedulePlannedWorkInput,
  ): Promise<PlannedWorkDto> {
    return unwrap(
      await apiClient.post<ApiResponse<PlannedWorkDto>>(
        `/planned-work/${plannedWorkId}/reschedule`,
        payload,
      ),
    );
  },

  async createTask(
    plannedWorkId: string,
    payload: CreatePlannedWorkTaskInput,
  ): Promise<PlannedWorkDto> {
    return unwrap(
      await apiClient.post<ApiResponse<PlannedWorkDto>>(
        `/planned-work/${plannedWorkId}/tasks`,
        payload,
      ),
    );
  },

  async updateTask(
    plannedWorkId: string,
    taskId: string,
    payload: UpdatePlannedWorkTaskInput,
  ): Promise<PlannedWorkDto> {
    return unwrap(
      await apiClient.patch<ApiResponse<PlannedWorkDto>>(
        `/planned-work/${plannedWorkId}/tasks/${taskId}`,
        payload,
      ),
    );
  },

  async recordProgress(
    plannedWorkId: string,
    taskId: string,
    payload: RecordTaskProgressInput,
  ): Promise<PlannedWorkDto> {
    return unwrap(
      await apiClient.post<ApiResponse<PlannedWorkDto>>(
        `/planned-work/${plannedWorkId}/tasks/${taskId}/progress`,
        payload,
      ),
    );
  },

  async deleteTask(plannedWorkId: string, taskId: string): Promise<PlannedWorkDto> {
    return unwrap(
      await apiClient.delete<ApiResponse<PlannedWorkDto>>(
        `/planned-work/${plannedWorkId}/tasks/${taskId}`,
      ),
    );
  },

  async uploadTaskPhoto(
    plannedWorkId: string,
    taskId: string,
    kind: 'BEFORE' | 'AFTER',
    file: File,
  ): Promise<PlannedWorkDto> {
    const form = new FormData();
    form.append('kind', kind);
    form.append('file', file);

    return unwrap(
      await apiClient.post<ApiResponse<PlannedWorkDto>>(
        `/planned-work/${plannedWorkId}/tasks/${taskId}/photos`,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      ),
    );
  },

  async deleteTaskPhoto(
    plannedWorkId: string,
    taskId: string,
    fileId: string,
  ): Promise<PlannedWorkDto> {
    return unwrap(
      await apiClient.delete<ApiResponse<PlannedWorkDto>>(
        `/planned-work/${plannedWorkId}/tasks/${taskId}/photos/${fileId}`,
      ),
    );
  },

  async setMaterials(
    plannedWorkId: string,
    payload: PlannedWorkMaterialsInput,
  ): Promise<PlannedWorkDto> {
    return unwrap(
      await apiClient.put<ApiResponse<PlannedWorkDto>>(
        `/planned-work/${plannedWorkId}/materials`,
        payload,
      ),
    );
  },

  async report(plannedWorkId: string): Promise<ReportBundle> {
    return unwrap(
      await apiClient.get<ApiResponse<ReportBundle>>(`/planned-work/${plannedWorkId}/report`),
    );
  },

  async updateReport(
    plannedWorkId: string,
    payload: UpdatePlannedWorkReportInput,
  ): Promise<PlannedWorkDto> {
    return unwrap(
      await apiClient.patch<ApiResponse<PlannedWorkDto>>(
        `/planned-work/${plannedWorkId}/report`,
        payload,
      ),
    );
  },

  async submitReport(plannedWorkId: string): Promise<PlannedWorkDto> {
    return unwrap(
      await apiClient.post<ApiResponse<PlannedWorkDto>>(
        `/planned-work/${plannedWorkId}/report/submit`,
      ),
    );
  },

  async returnReport(
    plannedWorkId: string,
    payload: ReturnPlannedWorkReportInput,
  ): Promise<PlannedWorkDto> {
    return unwrap(
      await apiClient.post<ApiResponse<PlannedWorkDto>>(
        `/planned-work/${plannedWorkId}/report/return`,
        payload,
      ),
    );
  },

  async approveReport(plannedWorkId: string): Promise<PlannedWorkDto> {
    return unwrap(
      await apiClient.post<ApiResponse<PlannedWorkDto>>(
        `/planned-work/${plannedWorkId}/report/approve`,
      ),
    );
  },
};
