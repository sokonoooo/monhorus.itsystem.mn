import type {
  ApiResponse,
  CompanyDto,
  DashboardCustomWidgetDto,
  DashboardCustomWidgetInput,
  DashboardInsightDto,
  DashboardLayoutDto,
  DashboardSummaryDto,
  DashboardWidgetPreference,
  DepartmentDto,
  PositionDto,
  TeamDto,
} from '@monhorus/shared';

import { apiClient, unwrap } from '../lib/api-client';

/**
 * Organisation lookups for the dependent selectors.
 *
 * Each child call requires its parent id. Passing nothing returns an empty list from
 * the backend by design, so an unscoped dropdown is impossible.
 */
export const orgService = {
  async companies(search?: string): Promise<CompanyDto[]> {
    return unwrap(
      await apiClient.get<ApiResponse<CompanyDto[]>>('/org/companies', { params: { search } }),
    );
  },

  async departments(companyId: string): Promise<DepartmentDto[]> {
    if (!companyId) return [];
    return unwrap(
      await apiClient.get<ApiResponse<DepartmentDto[]>>('/org/departments', {
        params: { companyId },
      }),
    );
  },

  async positions(companyId: string, departmentId?: string): Promise<PositionDto[]> {
    if (!companyId) return [];
    return unwrap(
      await apiClient.get<ApiResponse<PositionDto[]>>('/org/positions', {
        params: { companyId, departmentId },
      }),
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
