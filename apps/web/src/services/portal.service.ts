import type {
  ApiResponse,
  BuildingDto,
  CreateServiceRequestInput,
  CustomerWorkReportDto,
  FloorDto,
  FloorPlanDto,
  ObjectDetailDto,
  ObjectListItemDto,
  ProjectDto,
  PaginatedData,
  ServiceRequestAttachmentDto,
  ServiceRequestDetailDto,
  ServiceRequestListItemDto,
  ServiceRequestListQuery,
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
 * Everything the customer portal calls, in one place.
 *
 * A SEPARATE CLIENT rather than methods bolted onto the staff services, for two reasons.
 * The first is the constraint this was built under: the staff modules are not to be
 * touched, and a portal-only file cannot break one. The second outlives that — this file
 * is the complete list of what a customer's browser asks for, so "what can the portal
 * reach" is answerable by reading one screen of code instead of grepping five services.
 *
 * EVERY ENDPOINT HERE ALREADY EXISTS AND ALREADY ACCEPTS A `portal.*` KEY. Nothing new was
 * added to the backend for the portal, and nothing here is doing any securing: each of
 * these is bounded server-side by `resolveCustomerScope`, which reads the tenant from the
 * authenticated account and discards anything the request carries. A `customerId` sent
 * from here would be ignored, which is why none is ever sent.
 */
export const portalService = {
  // -- Service requests -------------------------------------------------------

  /** Their own requests. The tenant predicate is applied server-side, in the query. */
  async listRequests(
    query: ServiceRequestListQuery = {},
  ): Promise<PaginatedData<ServiceRequestListItemDto>> {
    return unwrap(
      await apiClient.get<ApiResponse<PaginatedData<ServiceRequestListItemDto>>>(
        '/service-requests',
        { params: toParams(query as Record<string, unknown>) },
      ),
    );
  },

  async getRequest(requestId: string): Promise<ServiceRequestDetailDto> {
    return unwrap(
      await apiClient.get<ApiResponse<ServiceRequestDetailDto>>(
        `/service-requests/${requestId}`,
      ),
    );
  },

  async createRequest(payload: CreateServiceRequestInput): Promise<ServiceRequestDetailDto> {
    return unwrap(
      await apiClient.post<ApiResponse<ServiceRequestDetailDto>>('/service-requests', payload),
    );
  },

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

  /**
   * The work conclusion as a CUSTOMER may see it.
   *
   * A different endpoint from the staff `/report`, and the difference matters in both
   * directions: the staff one MINTS A DRAFT on first read — a customer opening it would
   * author a conclusion stamped with their own name — and it returns the internal review
   * fields. This one is composed field by field server-side and 404s until the conclusion
   * is APPROVED, so an unapproved write-up cannot be read early.
   */
  async customerReport(requestId: string): Promise<CustomerWorkReportDto> {
    return unwrap(
      await apiClient.get<ApiResponse<CustomerWorkReportDto>>(
        `/service-requests/${requestId}/report/customer`,
      ),
    );
  },

  // -- Sites ------------------------------------------------------------------

  async listBuildings(): Promise<PaginatedData<BuildingDto>> {
    return unwrap(
      await apiClient.get<ApiResponse<PaginatedData<BuildingDto>>>('/buildings', {
        params: { page: 1, limit: 100 },
      }),
    );
  },

  async getBuilding(buildingId: string): Promise<BuildingDto> {
    return unwrap(await apiClient.get<ApiResponse<BuildingDto>>(`/buildings/${buildingId}`));
  },

  async listFloors(buildingId: string): Promise<PaginatedData<FloorDto>> {
    return unwrap(
      await apiClient.get<ApiResponse<PaginatedData<FloorDto>>>('/floors', {
        params: { buildingId, page: 1, limit: 100 },
      }),
    );
  },

  async getFloor(floorId: string): Promise<FloorDto> {
    return unwrap(await apiClient.get<ApiResponse<FloorDto>>(`/floors/${floorId}`));
  },

  /** Null when the floor has no drawing, which is a normal answer rather than an error. */
  async getFloorPlan(floorId: string): Promise<FloorPlanDto | null> {
    return unwrap(
      await apiClient.get<ApiResponse<FloorPlanDto | null>>(`/floors/${floorId}/plan`),
    );
  },

  async listObjects(floorId: string): Promise<PaginatedData<ObjectListItemDto>> {
    return unwrap(
      await apiClient.get<ApiResponse<PaginatedData<ObjectListItemDto>>>('/objects-master', {
        params: { floorId, page: 1, limit: 200 },
      }),
    );
  },

  async getObject(objectId: string): Promise<ObjectDetailDto> {
    return unwrap(
      await apiClient.get<ApiResponse<ObjectDetailDto>>(`/objects-master/${objectId}`),
    );
  },

  // -- Location chain for the request form ------------------------------------

  /**
   * The caller's own projects, for the create form.
   *
   * THE STAFF FORM'S CHAIN CANNOT BE REUSED. `useLocationChain` starts from
   * `objectService.customers()` — `GET /objects/customers`, behind the staff key
   * `customer.view` — and then walks `GET /objects/nodes`, which is behind `object.view`.
   * Both answer 403 to a portal caller, so the staff form would open on an error about a
   * customer list this user must never see. The typed hierarchy endpoints below are the
   * portal-reachable equivalents, and the organisation is not a choice here anyway: it
   * comes from the account.
   */
  async listProjects(): Promise<PaginatedData<ProjectDto>> {
    return unwrap(
      await apiClient.get<ApiResponse<PaginatedData<ProjectDto>>>('/projects', {
        params: { page: 1, limit: 100 },
      }),
    );
  },

  /**
   * Buildings, optionally within one project.
   *
   * Without a project it answers the organisation's buildings, which is what makes the
   * form usable for a customer whose buildings hang off the organisation rather than off a
   * project — the case that would otherwise leave the required Барилга field permanently
   * empty and the form impossible to submit.
   */
  async listBuildingsIn(projectId?: string): Promise<PaginatedData<BuildingDto>> {
    return unwrap(
      await apiClient.get<ApiResponse<PaginatedData<BuildingDto>>>('/buildings', {
        params: toParams({ projectId, page: 1, limit: 100 }),
      }),
    );
  },
};
