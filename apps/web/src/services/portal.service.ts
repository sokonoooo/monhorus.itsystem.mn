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
  PlannedWorkAction,
  PlannedWorkListQuery,
  ServiceRequestAttachmentDto,
  ServiceRequestDetailDto,
  ServiceRequestListItemDto,
  ServiceRequestListQuery,
  SubmitSurveyResponseInput,
  SurveyFormDto,
  SurveyPendingItemDto,
  UpdatePlannedWorkInput,
  UpdatePlannedWorkTaskInput,
} from '@monhorus/shared';

import { ApiError, apiClient, unwrap } from '../lib/api-client';

function toParams(query: Record<string, unknown>): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params[key] = typeof value === 'boolean' ? String(value) : (value as string | number);
  }
  return params;
}

/**
 * What a portal list may ask for.
 *
 * DELIBERATELY NARROWER than the shared `BuildingListQuery`/`FloorListQuery`. Those carry
 * `customerId`, and this file's whole claim is that no `customerId` is ever sent from a
 * customer's browser — a parameter that cannot be named cannot be sent by accident.
 */
export interface PortalListQuery {
  page?: number;
  limit?: number;
  search?: string;
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
 * which is why none is ever sent. The same is true of the workflow rules: a work raised on
 * this client lands in DRAFT with no crew, and stays editable only until an approver acts,
 * because the server says so — not because of what these payloads omit.
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
   * server-side from the account: the work lands in DRAFT with an empty crew, so no crew is
   * sent from here and sending one would change nothing. It is not submitted by creating
   * it — the customer composes it and then calls `transition` with PLAN.
   */
  async createPlannedWork(payload: CreatePlannedWorkInput): Promise<PlannedWorkDto> {
    return unwrap(
      await apiClient.post<ApiResponse<PlannedWorkDto>>('/planned-work', payload),
    );
  },

  /** Correct a draft, or a request that came back for editing. Refused after approval. */
  async updatePlannedWork(
    plannedWorkId: string,
    payload: UpdatePlannedWorkInput,
  ): Promise<PlannedWorkDto> {
    return unwrap(
      await apiClient.patch<ApiResponse<PlannedWorkDto>>(
        `/planned-work/${plannedWorkId}`,
        payload,
      ),
    );
  },

  /**
   * Submit the caller's own draft for approval.
   *
   * The same `/transition` route staff use. PLAN is the only action a customer's key admits
   * — APPROVE and REJECT are keyed on `planned_work.approve`, which no customer holds, so
   * they never appear in a customer's `availableActions` and would be refused if posted. No
   * crew is ever sent: assigning is the approver's half of the decision.
   */
  async transition(
    plannedWorkId: string,
    action: PlannedWorkAction,
    reason?: string | null,
  ): Promise<PlannedWorkDto> {
    return unwrap(
      await apiClient.post<ApiResponse<PlannedWorkDto>>(
        `/planned-work/${plannedWorkId}/transition`,
        { action, reason: reason ?? null, assignedEmployeeIds: [] },
      ),
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
   * own work, and only while it is still theirs to shape (DRAFT or REJECTED). Submitting it
   * hands it over, so these start answering 400 the moment PLAN is called. Nothing here
   * enforces that; the drawer merely stops offering the controls, which is weaker entirely.
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

  /**
   * The customer's own buildings, one page at a time.
   *
   * `search` is passed to the server rather than applied to the answer, because the answer
   * is one page: filtering it here would search the page the customer happens to be on and
   * silently miss every match on the others. `buildingListQuerySchema` already accepts both,
   * so this is the existing endpoint being asked properly, not a widened one.
   *
   * The defaults are the pre-paging behaviour, for the callers that want the whole list.
   */
  async listBuildings(query: PortalListQuery = {}): Promise<PaginatedData<BuildingDto>> {
    return unwrap(
      await apiClient.get<ApiResponse<PaginatedData<BuildingDto>>>('/buildings', {
        params: toParams({ page: 1, limit: 100, ...query }),
      }),
    );
  },

  async getBuilding(buildingId: string): Promise<BuildingDto> {
    return unwrap(await apiClient.get<ApiResponse<BuildingDto>>(`/buildings/${buildingId}`));
  },

  /**
   * One building's floors, paged and searched the same way and for the same reason.
   *
   * The building stays a positional argument because it is not a filter the caller may drop
   * — every portal caller reads the floors OF a building — and because the form pages that
   * only need a dropdown of floors can then keep calling this with one argument.
   */
  async listFloors(
    buildingId: string,
    query: PortalListQuery = {},
  ): Promise<PaginatedData<FloorDto>> {
    return unwrap(
      await apiClient.get<ApiResponse<PaginatedData<FloorDto>>>('/floors', {
        params: toParams({ buildingId, page: 1, limit: 100, ...query }),
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

  /**
   * One page of a floor's equipment.
   *
   * Paged rather than fixed at the first hundred because the caller needs EVERY object: the
   * floor plan draws a marker per object, so a request that stopped at the cap would lose
   * pins off the drawing and say nothing about it. `PortalFloorPage` walks the pages.
   *
   * 100 is the cap `objectListQuerySchema` enforces, not a preference. Asking for more is a
   * 400, which surfaced as "the floor page is broken" rather than as anything about paging.
   */
  async listObjects(floorId: string, page = 1): Promise<PaginatedData<ObjectListItemDto>> {
    return unwrap(
      await apiClient.get<ApiResponse<PaginatedData<ObjectListItemDto>>>('/objects-master', {
        params: { floorId, page, limit: 100 },
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

  // -- Satisfaction survey ----------------------------------------------------

  /**
   * The requests still waiting on the customer's own verdict.
   *
   * Read by the screens that OFFER the survey rather than by the survey itself, and that
   * is the whole reason it exists as a separate call: `surveyForm` answers 404 for every
   * request with no open survey — which is most of them — so a detail page that asked for
   * the form to find out would fire a request it expects to fail on every job the customer
   * ever opens. This one answers the question with a list, the same way
   * `hasApprovedReport` answers it for the work conclusion.
   *
   * An item may be listed with nobody left outstanding: the list is a snapshot and another
   * device may have answered since, so callers ask what is outstanding rather than treating
   * the item's presence as the answer.
   */
  async pendingSurveys(): Promise<SurveyPendingItemDto[]> {
    return unwrap(await apiClient.get<ApiResponse<SurveyPendingItemDto[]>>('/surveys/pending'));
  },

  /**
   * The questions and the technicians for one request, or null when there is nothing left
   * to answer.
   *
   * THE 404 IS AN ANSWER, NOT A FAILURE. The endpoint replies that way for a request with
   * no open survey — never completed, already answered, not this customer's — and it is
   * deliberately the same reply in every one of those cases so that none can be told apart
   * by asking. Mapping it to null here keeps that a normal outcome the screens render as
   * "nothing to rate"; every other status still throws, so a genuine outage is not silently
   * shown as an empty survey.
   */
  async surveyForm(requestId: string): Promise<SurveyFormDto | null> {
    try {
      return unwrap(
        await apiClient.get<ApiResponse<SurveyFormDto>>(`/surveys/requests/${requestId}/form`),
      );
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 404) return null;
      throw caught;
    }
  },

  /**
   * One technician's verdict, or the statement that the customer never dealt with them.
   *
   * ONE EMPLOYEE PER CALL, which is the endpoint's shape and not a convenience: the survey
   * exists to say something about a person, and a single score for a job two people
   * attended cannot be attributed to either. The caller loops.
   *
   * `skipped` and `answers` are mutually exclusive — `submitSurveyResponseSchema` refuses
   * the two together — because a skip records no rating anywhere, so nothing the customer
   * did not observe reaches that technician's average.
   */
  async submitSurveyResponse(
    requestId: string,
    payload: SubmitSurveyResponseInput,
  ): Promise<void> {
    await apiClient.post<ApiResponse<null>>(
      `/surveys/requests/${requestId}/responses`,
      payload,
    );
  },
};
