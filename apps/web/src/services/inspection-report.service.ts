import type {
  ApiResponse,
  InspectionReportDto,
  InspectionReportReadinessDto,
  ReturnInspectionReportInput,
  ReviewInspectionReportInput,
  UpdateInspectionReportInput,
} from '@monhorus/shared';

import { apiClient, unwrap } from '../lib/api-client';

function base(plannedWorkId: string): string {
  return `/planned-work/${plannedWorkId}/inspection-report`;
}

/**
 * The consolidated inspection report (Үзлэгийн нэгдсэн тайлан).
 *
 * Every workflow step is its own endpoint rather than a status field on `update`, so the
 * backend owns which transition is legal and the client cannot write a status directly.
 * `update` therefore carries only the narrative: the heading, the sub-task sections and the
 * overall safety level are derived from the planned work and are never sent back.
 */
export const inspectionReportService = {
  /** Throws a 404 ApiError when the planned work has no report yet. */
  async get(plannedWorkId: string): Promise<InspectionReportDto> {
    return unwrap(await apiClient.get<ApiResponse<InspectionReportDto>>(base(plannedWorkId)));
  },

  async readiness(plannedWorkId: string): Promise<InspectionReportReadinessDto> {
    return unwrap(
      await apiClient.get<ApiResponse<InspectionReportReadinessDto>>(
        `${base(plannedWorkId)}/readiness`,
      ),
    );
  },

  /** Composes the draft from the finished sub-tasks. */
  async generate(plannedWorkId: string): Promise<InspectionReportDto> {
    return unwrap(await apiClient.post<ApiResponse<InspectionReportDto>>(base(plannedWorkId)));
  },

  async update(
    plannedWorkId: string,
    payload: UpdateInspectionReportInput,
  ): Promise<InspectionReportDto> {
    return unwrap(
      await apiClient.patch<ApiResponse<InspectionReportDto>>(base(plannedWorkId), payload),
    );
  },

  async submit(plannedWorkId: string): Promise<InspectionReportDto> {
    return unwrap(
      await apiClient.post<ApiResponse<InspectionReportDto>>(`${base(plannedWorkId)}/submit`),
    );
  },

  async approve(
    plannedWorkId: string,
    payload: ReviewInspectionReportInput = {},
  ): Promise<InspectionReportDto> {
    return unwrap(
      await apiClient.post<ApiResponse<InspectionReportDto>>(
        `${base(plannedWorkId)}/approve`,
        payload,
      ),
    );
  },

  /** The reason is mandatory: an unexplained return leaves the author guessing. */
  async returnReport(
    plannedWorkId: string,
    payload: ReturnInspectionReportInput,
  ): Promise<InspectionReportDto> {
    return unwrap(
      await apiClient.post<ApiResponse<InspectionReportDto>>(
        `${base(plannedWorkId)}/return`,
        payload,
      ),
    );
  },

  async finalise(
    plannedWorkId: string,
    payload: ReviewInspectionReportInput = {},
  ): Promise<InspectionReportDto> {
    return unwrap(
      await apiClient.post<ApiResponse<InspectionReportDto>>(
        `${base(plannedWorkId)}/finalise`,
        payload,
      ),
    );
  },

  /** Opens a new version of a finalised report. No previous copy is kept. */
  async reopen(plannedWorkId: string): Promise<InspectionReportDto> {
    return unwrap(
      await apiClient.post<ApiResponse<InspectionReportDto>>(`${base(plannedWorkId)}/reopen`),
    );
  },
};
