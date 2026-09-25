import type {
  ApiResponse,
  InspectionReportDto,
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
  RecordTaskMaterialUsageInput,
  RecordTaskProgressInput,
  ReschedulePlannedWorkInput,
  ReturnPlannedWorkReportInput,
  UpdatePlannedWorkInput,
  UpdatePlannedWorkReportInput,
  UpdatePlannedWorkTaskInput,
} from '@monhorus/shared';

import { businessDateKey } from '../lib/business-day';
import { downloadFile, downloadPdf } from '../lib/download-pdf';
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
    /** Required by APPROVE and ignored by everything else — see `assignsCrew`. */
    assignedEmployeeIds: readonly string[] = [],
  ): Promise<PlannedWorkDto> {
    return unwrap(
      await apiClient.post<ApiResponse<PlannedWorkDto>>(
        `/planned-work/${plannedWorkId}/transition`,
        { action, reason: reason ?? null, assignedEmployeeIds: [...assignedEmployeeIds] },
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

  /**
   * One sub-task's draw against one material registered on the work.
   *
   * The quantity is ABSOLUTE for that (sub-task, material) pair rather than an increment,
   * so sending the same figure twice is the same as sending it once — which is what makes
   * this safe to retry from a phone — and sending zero deletes the row.
   *
   * Gated on `planned_work.record_progress`, not on `planned_work.update`: consumption is
   * something the crew reports, while the registered list is something a manager plans.
   * The whole work comes back, because a draw moves the work-level totals too.
   */
  async recordMaterialUsage(
    plannedWorkId: string,
    taskId: string,
    payload: RecordTaskMaterialUsageInput,
  ): Promise<PlannedWorkDto> {
    return unwrap(
      await apiClient.post<ApiResponse<PlannedWorkDto>>(
        `/planned-work/${plannedWorkId}/tasks/${taskId}/materials`,
        payload,
      ),
    );
  },

  /**
   * Downloads the consolidated report as a PDF laid out like the office's own
   * «Үзлэгийн тайлан».
   *
   * The server renders it from the same query this page reads, so the file cannot say
   * anything the screen does not.
   */
  async downloadReportPdf(plannedWorkId: string, workNumber: string): Promise<void> {
    await downloadPdf(`/planned-work/${plannedWorkId}/report/pdf`, `tailan-${workNumber}`);
  },

  /**
   * The same work as the photographic report «ТКС-2, ТКС-4 самбар гэрээт ажил».
   *
   * A SECOND document rather than a different rendering of the first: the consolidated
   * report above carries the tables an office files, this one carries the photographs a
   * client is handed. Both are built from the same server-side preview.
   */
  async downloadPhotoReportPdf(plannedWorkId: string, workNumber: string): Promise<void> {
    await downloadPdf(
      `/planned-work/${plannedWorkId}/report/photo-pdf`,
      `foto-tailan-${workNumber}`,
    );
  },

  /** The same, for the consolidated inspection report. */
  async downloadInspectionReportPdf(
    plannedWorkId: string,
    workNumber: string,
  ): Promise<void> {
    await downloadPdf(
      `/planned-work/${plannedWorkId}/inspection-report/pdf`,
      `uzleg-${workNumber}`,
    );
  },

  /** The consolidated inspection report as an editable Word document. */
  async downloadInspectionReportDocx(
    plannedWorkId: string,
    report: Pick<InspectionReportDto, 'customerName' | 'inspectionEnd' | 'createdAt'>,
  ): Promise<void> {
    await downloadFile(
      `/planned-work/${plannedWorkId}/inspection-report/docx`,
      inspectionReportDocxFilename(report),
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

/**
 * `Үзлэгийн_нэгдсэн_тайлан_<Customer>_<2026-08-11>.docx`, the same name the API puts in its
 * own header (`docxFilename` in the inspection-report controller).
 *
 * Dated by the inspection rather than the download, in the business time zone, so one
 * report always saves under one name. Characters no file system accepts are dropped,
 * spaces become underscores, and a report with no customer leaves that part out.
 */
export function inspectionReportDocxFilename(
  report: Pick<InspectionReportDto, 'customerName' | 'inspectionEnd' | 'createdAt'>,
): string {
  const customer = (report.customerName ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .trim()
    .replace(/\s+/g, '_');
  const when = new Date(report.inspectionEnd ?? report.createdAt);
  const date = Number.isNaN(when.getTime()) ? '' : businessDateKey(when);
  return `${['Үзлэгийн_нэгдсэн_тайлан', customer, date].filter((part) => part !== '').join('_')}.docx`;
}
