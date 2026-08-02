import type {
  ApiResponse,
  SaveWorkReportInput,
  WorkReportDto,
  WorkReportPhotoDto,
  AssignServiceRequestInput,
  ChangeServiceRequestStatusInput,
  CreateServiceRequestInput,
  DispatchBoardDto,
  DispatchCandidateDto,
  ExtendSlaInput,
  PaginatedData,
  ServiceRequestDetailDto,
  ServiceRequestListItemDto,
  ServiceRequestListQuery,
  TeamDto,
} from '@monhorus/shared';

import { apiClient, unwrap } from '../lib/api-client';

export const serviceRequestService = {
  async list(
    query: ServiceRequestListQuery = {},
  ): Promise<PaginatedData<ServiceRequestListItemDto>> {
    return unwrap(
      await apiClient.get<ApiResponse<PaginatedData<ServiceRequestListItemDto>>>(
        '/service-requests',
        { params: query },
      ),
    );
  },

  async getById(requestId: string): Promise<ServiceRequestDetailDto> {
    return unwrap(
      await apiClient.get<ApiResponse<ServiceRequestDetailDto>>(`/service-requests/${requestId}`),
    );
  },

  async create(payload: CreateServiceRequestInput): Promise<ServiceRequestDetailDto> {
    return unwrap(
      await apiClient.post<ApiResponse<ServiceRequestDetailDto>>('/service-requests', payload),
    );
  },

  async assign(
    requestId: string,
    payload: AssignServiceRequestInput,
  ): Promise<ServiceRequestDetailDto> {
    return unwrap(
      await apiClient.post<ApiResponse<ServiceRequestDetailDto>>(
        `/service-requests/${requestId}/assign`,
        payload,
      ),
    );
  },

  async changeStatus(
    requestId: string,
    payload: ChangeServiceRequestStatusInput,
  ): Promise<ServiceRequestDetailDto> {
    return unwrap(
      await apiClient.post<ApiResponse<ServiceRequestDetailDto>>(
        `/service-requests/${requestId}/status`,
        payload,
      ),
    );
  },

  async extendSla(requestId: string, payload: ExtendSlaInput): Promise<ServiceRequestDetailDto> {
    return unwrap(
      await apiClient.post<ApiResponse<ServiceRequestDetailDto>>(
        `/service-requests/${requestId}/extend-sla`,
        payload,
      ),
    );
  },
};

export interface DispatchCandidateQuery {
  teamId?: string;
  skill?: string;
  search?: string;
  availableOnly?: boolean;
}

export const dispatchService = {
  async board(): Promise<DispatchBoardDto> {
    return unwrap(await apiClient.get<ApiResponse<DispatchBoardDto>>('/dispatch/board'));
  },

  /** Employees eligible for assignment, with live workload counts. */
  async employeeCandidates(query: DispatchCandidateQuery = {}): Promise<DispatchCandidateDto[]> {
    return unwrap(
      await apiClient.get<ApiResponse<DispatchCandidateDto[]>>('/dispatch/employee-candidates', {
        params: {
          ...query,
          ...(query.availableOnly ? { availableOnly: 'true' } : {}),
        },
      }),
    );
  },

  async teamCandidates(search?: string): Promise<TeamDto[]> {
    return unwrap(
      await apiClient.get<ApiResponse<TeamDto[]>>('/dispatch/team-candidates', {
        params: { search },
      }),
    );
  },
};

/**
 * The section 9.2 work conclusion.
 *
 * `get` creates the record on first read: the technician opens the form before there is
 * anything to save, so requiring an explicit create step would be a round trip for nothing.
 */
export const workReportService = {
  async get(requestId: string): Promise<WorkReportDto> {
    return unwrap(
      await apiClient.get<ApiResponse<WorkReportDto>>(`/service-requests/${requestId}/report`),
    );
  },

  async save(requestId: string, payload: SaveWorkReportInput): Promise<WorkReportDto> {
    return unwrap(
      await apiClient.put<ApiResponse<WorkReportDto>>(
        `/service-requests/${requestId}/report`,
        payload,
      ),
    );
  },

  /**
   * Uploads one evidence photo and returns the stored file.
   *
   * The conclusion is written in one shot with its `beforePhotoIds`/`afterPhotoIds`, so the
   * file is parked on the uploader here and claimed by `save`. A photo chosen but never
   * saved therefore stays unreferenced rather than attaching itself to the report.
   */
  async uploadPhoto(file: File): Promise<WorkReportPhotoDto> {
    const form = new FormData();
    form.append('file', file);

    return unwrap(
      await apiClient.post<ApiResponse<WorkReportPhotoDto>>('/files/work-report-photos', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }),
    );
  },

  async submit(requestId: string): Promise<WorkReportDto> {
    return unwrap(
      await apiClient.post<ApiResponse<WorkReportDto>>(
        `/service-requests/${requestId}/report/submit`,
      ),
    );
  },

  async approve(requestId: string): Promise<WorkReportDto> {
    return unwrap(
      await apiClient.post<ApiResponse<WorkReportDto>>(
        `/service-requests/${requestId}/report/approve`,
      ),
    );
  },

  async returnForFix(requestId: string, reason: string): Promise<WorkReportDto> {
    return unwrap(
      await apiClient.post<ApiResponse<WorkReportDto>>(
        `/service-requests/${requestId}/report/return`,
        { reason },
      ),
    );
  },
};
