import type {
  ApiResponse,
  BuildingDto,
  CreatePlannedWorkInput,
  CreatePlannedWorkTaskInput,
  CreateServiceRequestInput,
  CustomerWorkReportDto,
  FloorDto,
  FloorPlanDto,
  ObjectDetailDto,
  ObjectListItemDto,
  ProjectDto,
  PaginatedData,
  PlannedWorkDto,
  PlannedWorkListItemDto,
  PlannedWorkListQuery,
  ServiceRequestAttachmentDto,
  ServiceRequestDetailDto,
  ServiceRequestListItemDto,
  ServiceRequestListQuery,
  UpdatePlannedWorkTaskInput,
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
 * EVERY ENDPOINT HERE IS AN EXISTING ONE. The service-request and site reads already
 * accepted a `portal.*` key before this portal existed; the three planned-work methods call
 * routes that already existed and were widened to accept `portal.planned_work.*` — no new
 * route, no new shape, no parallel API.
 *
 * NOTHING HERE IS DOING ANY SECURING. Each of these is bounded server-side by
 * `resolveCustomerScope`, which reads the tenant from the authenticated account and
 * discards anything the request carries; a `customerId` sent from here would be ignored,
 * which is why none is ever sent. The same is true of the approval rule: a work raised on
 * this client is forced to PENDING_APPROVAL with no crew by the server, not by the absence
 * of those fields in the payload below.
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

  // -- Planned work -----------------------------------------------------------

  /**
   * The customer's own planned work, at every stage.
   *
   * `GET /planned-work` accepts `portal.planned_work.view` and applies the tenant predicate
   * from the account, so no `customerId` is sent — it would be discarded, and sending one
   * would imply it might not be.
   */
  async listPlannedWork(
    query: PlannedWorkListQuery = {},
  ): Promise<PaginatedData<PlannedWorkListItemDto>> {
    return unwrap(
      await apiClient.get<ApiResponse<PaginatedData<PlannedWorkListItemDto>>>('/planned-work', {
        params: toParams(query as Record<string, unknown>),
      }),
    );
  },

  async getPlannedWork(plannedWorkId: string): Promise<PlannedWorkDto> {
    return unwrap(
      await apiClient.get<ApiResponse<PlannedWorkDto>>(`/planned-work/${plannedWorkId}`),
    );
  },

  /**
   * Raise a request for scheduled maintenance.
   *
   * The same endpoint and the same shared schema staff use. What differs is decided
   * server-side from the account: a portal caller's work is forced to PENDING_APPROVAL with
   * an empty crew, so no crew is sent from here and sending one would change nothing.
   */
  async createPlannedWork(payload: CreatePlannedWorkInput): Promise<PlannedWorkDto> {
    return unwrap(
      await apiClient.post<ApiResponse<PlannedWorkDto>>('/planned-work', payload),
    );
  },

  /**
   * The sub-tasks of the caller's own request.
   *
   * THE SAME THREE ROUTES STAFF USE, widened to accept `portal.planned_work.create`. They
   * are listed here rather than left to `plannedWorkService` so this file stays what its
   * header claims: the complete list of what a customer's browser asks for.
   *
   * The bound is server-side and is two rules, not one — a customer may shape only their
   * own work, and only while it is still PENDING_APPROVAL. Approval settles the scope, so
   * these start answering 400 the moment an approver agrees. Nothing here enforces that;
   * the drawer merely stops offering the controls, which is a weaker thing entirely.
   */
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

  async deleteTask(plannedWorkId: string, taskId: string): Promise<PlannedWorkDto> {
    return unwrap(
      await apiClient.delete<ApiResponse<PlannedWorkDto>>(
        `/planned-work/${plannedWorkId}/tasks/${taskId}`,
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
        // 100 is the cap `objectListQuerySchema` enforces, not a preference. Asking for more
        // is a 400, which surfaced as "the floor page is broken" rather than as anything
        // about paging.
        params: { floorId, page: 1, limit: 100 },
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
