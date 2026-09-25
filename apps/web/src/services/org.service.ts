import type {
  ApiResponse,
  CompanyDto,
  CreateCompanyRequest,
  CreateDepartmentRequest,
  CreatePositionRequest,
  DashboardCustomWidgetDto,
  DashboardCustomWidgetInput,
  DashboardInsightDto,
  DashboardLayoutDto,
  DashboardSummaryDto,
  DashboardWidgetPreference,
  DepartmentDto,
  DepartmentListItemDto,
  OrgLookupQuery,
  PaginatedData,
  PositionDto,
  PositionListItemDto,
  SetOrgActiveRequest,
  TeamDto,
  UpdateCompanyRequest,
  UpdateDepartmentRequest,
  UpdatePositionRequest,
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
 * Internal organisation master data: companies, departments and positions.
 *
 * The three lists are paginated because they are management tables first and lookup
 * sources second — the employee form asks for one page of each and reads `.items`, while
 * the admin screens page through them. Every filter (`search`, `includeInactive`,
 * `companyId`, `departmentId`) is applied by the server, so a screen never holds a list it
 * has trimmed itself: a client-side filter would show the right rows under a total that
 * counts the ones it hid.
 *
 * There is no `code` on any create or update payload. Codes are issued by the server from
 * the same counter that issues PRJ-001, so a code that can be typed cannot be guaranteed
 * unique and a code that can be edited is not an identifier.
 *
 * `teams` keeps its parent-scoped signature: it has no management screen, and it is still
 * only ever asked for the teams of one company.
 */
export const orgService = {
  async companies(query: OrgLookupQuery = {}): Promise<PaginatedData<CompanyDto>> {
    return unwrap(
      await apiClient.get<ApiResponse<PaginatedData<CompanyDto>>>('/org/companies', {
        params: toParams(query as Record<string, unknown>),
      }),
    );
  },

  async createCompany(payload: CreateCompanyRequest): Promise<CompanyDto> {
    return unwrap(await apiClient.post<ApiResponse<CompanyDto>>('/org/companies', payload));
  },

  async updateCompany(companyId: string, payload: UpdateCompanyRequest): Promise<CompanyDto> {
    return unwrap(
      await apiClient.patch<ApiResponse<CompanyDto>>(`/org/companies/${companyId}`, payload),
    );
  },

  /**
   * Activate or deactivate, on its own endpoint rather than as a field of the update.
   *
   * Deactivating hides the record from new selections and leaves every existing assignment
   * intact, which is a different decision from renaming it and is authorised as one.
   */
  async setCompanyStatus(companyId: string, payload: SetOrgActiveRequest): Promise<CompanyDto> {
    return unwrap(
      await apiClient.patch<ApiResponse<CompanyDto>>(`/org/companies/${companyId}/status`, payload),
    );
  },

  async departments(query: OrgLookupQuery = {}): Promise<PaginatedData<DepartmentListItemDto>> {
    return unwrap(
      await apiClient.get<ApiResponse<PaginatedData<DepartmentListItemDto>>>('/org/departments', {
        params: toParams(query as Record<string, unknown>),
      }),
    );
  },

  async createDepartment(payload: CreateDepartmentRequest): Promise<DepartmentDto> {
    return unwrap(await apiClient.post<ApiResponse<DepartmentDto>>('/org/departments', payload));
  },

  async updateDepartment(
    departmentId: string,
    payload: UpdateDepartmentRequest,
  ): Promise<DepartmentDto> {
    return unwrap(
      await apiClient.patch<ApiResponse<DepartmentDto>>(`/org/departments/${departmentId}`, payload),
    );
  },

  async setDepartmentStatus(
    departmentId: string,
    payload: SetOrgActiveRequest,
  ): Promise<DepartmentDto> {
    return unwrap(
      await apiClient.patch<ApiResponse<DepartmentDto>>(
        `/org/departments/${departmentId}/status`,
        payload,
      ),
    );
  },

  async positions(query: OrgLookupQuery = {}): Promise<PaginatedData<PositionListItemDto>> {
    return unwrap(
      await apiClient.get<ApiResponse<PaginatedData<PositionListItemDto>>>('/org/positions', {
        params: toParams(query as Record<string, unknown>),
      }),
    );
  },

  async createPosition(payload: CreatePositionRequest): Promise<PositionDto> {
    return unwrap(await apiClient.post<ApiResponse<PositionDto>>('/org/positions', payload));
  },

  async updatePosition(positionId: string, payload: UpdatePositionRequest): Promise<PositionDto> {
    return unwrap(
      await apiClient.patch<ApiResponse<PositionDto>>(`/org/positions/${positionId}`, payload),
    );
  },

  async setPositionStatus(positionId: string, payload: SetOrgActiveRequest): Promise<PositionDto> {
    return unwrap(
      await apiClient.patch<ApiResponse<PositionDto>>(
        `/org/positions/${positionId}/status`,
        payload,
      ),
    );
  },

  async teams(companyId: string, departmentId?: string): Promise<TeamDto[]> {
    if (!companyId) return [];
    return unwrap(
      await apiClient.get<ApiResponse<TeamDto[]>>('/org/teams', {
        params: { companyId, departmentId },
      }),
    );
  },
};

export const dashboardService = {
  async summary(): Promise<DashboardSummaryDto> {
    return unwrap(await apiClient.get<ApiResponse<DashboardSummaryDto>>('/dashboard/summary'));
  },

  /** The caller's own arrangement, already reconciled against the widget catalogue. */
  async layout(): Promise<DashboardLayoutDto> {
    return unwrap(await apiClient.get<ApiResponse<DashboardLayoutDto>>('/dashboard/layout'));
  },

  async saveLayout(
    widgets: readonly DashboardWidgetPreference[],
  ): Promise<DashboardLayoutDto> {
    return unwrap(
      await apiClient.put<ApiResponse<DashboardLayoutDto>>('/dashboard/layout', { widgets }),
    );
  },

  async resetLayout(): Promise<DashboardLayoutDto> {
    return unwrap(await apiClient.delete<ApiResponse<DashboardLayoutDto>>('/dashboard/layout'));
  },

  async createCustomWidget(
    input: DashboardCustomWidgetInput,
  ): Promise<DashboardCustomWidgetDto> {
    return unwrap(
      await apiClient.post<ApiResponse<DashboardCustomWidgetDto>>(
        '/dashboard/custom-widgets',
        input,
      ),
    );
  },

  async deleteCustomWidget(widgetId: string): Promise<void> {
    await apiClient.delete<ApiResponse<null>>(`/dashboard/custom-widgets/${widgetId}`);
  },

  /**
   * The figures behind one saved question.
   *
   * One request per widget rather than a batch: each is an independent aggregation, and a
   * board with several must show the ones that resolved rather than wait for the slowest.
   */
  async insight(widgetId: string): Promise<DashboardInsightDto> {
    return unwrap(
      await apiClient.get<ApiResponse<DashboardInsightDto>>(
        `/dashboard/custom-widgets/${widgetId}/insight`,
      ),
    );
  },
};
