import type {
  ApiResponse,
  CallableObjectTypeDto,
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
  ServiceRequestAttachmentDto,
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

  /**
   * The equipment types this caller may raise a call against.
   *
   * Not `/object-types`: reading the catalogue needs `object_master.view`, which a
   * customer-portal account does not hold, so both call forms would be unable to fill their
   * own required field. This endpoint is gated on being able to CREATE a request instead,
   * and returns only what a picker needs.
   */
  async callableObjectTypes(): Promise<CallableObjectTypeDto[]> {
    return unwrap(
      await apiClient.get<ApiResponse<CallableObjectTypeDto[]>>(
        '/service-requests/callable-object-types',
      ),
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

  /**
   * Нээлттэй ажил — the caller takes an open request for themselves.
   *
   * Deliberately not `assign` with the caller's own id. Assigning is `dispatch.assign`, the
   * authority to put SOMEBODY ELSE on a job; this is `service_request.claim`, which a
   * technician holds, and it can only ever write the caller onto work that currently has
   * nobody. There is no body for the same reason — the claimer is the session, so there is
   * no parameter through which one employee could be put on a job by another.
   *
   * The server decides whether a claim wins. Two technicians tapping at the same moment are
   * ordered by one atomic write there, and the loser is answered 409; nothing here may
   * anticipate that outcome.
   */
  async claim(requestId: string): Promise<ServiceRequestDetailDto> {
    return unwrap(
      await apiClient.post<ApiResponse<ServiceRequestDetailDto>>(
        `/service-requests/${requestId}/claim`,
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

  /**
   * Uploads one attachment ahead of the request that will carry it.
   *
   * The request is created in one shot with its `attachmentIds`, so the file is parked on
   * the uploader here and claimed by `create` — the same two-phase flow the customer app
   * and the work report already use. A file chosen but never submitted therefore stays
   * unreferenced rather than attaching itself to nothing.
   */
  async uploadAttachment(file: File): Promise<ServiceRequestAttachmentDto> {
    const form = new FormData();
    form.append('file', file);

    return unwrap(
      await apiClient.post<ApiResponse<ServiceRequestAttachmentDto>>(
        '/files/service-request-attachments',
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } },
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
