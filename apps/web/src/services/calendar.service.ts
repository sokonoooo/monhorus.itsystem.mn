import type { ApiResponse, CalendarQuery, CalendarResultDto } from '@monhorus/shared';

import { apiClient, unwrap } from '../lib/api-client';

export const calendarService = {
  /**
   * Fetches the calendar for a window.
   *
   * Sources travel as a comma separated list. Every status and progress figure in the
   * response is derived by the backend; the client renders it and never recomputes it.
   */
  async range(query: CalendarQuery): Promise<CalendarResultDto> {
    const params: Record<string, string> = { from: query.from, to: query.to };
    if (query.sources && query.sources.length > 0) params.sources = query.sources.join(',');
    if (query.employeeId) params.employeeId = query.employeeId;
    if (query.teamId) params.teamId = query.teamId;
    if (query.customerId) params.customerId = query.customerId;
    if (query.projectId) params.projectId = query.projectId;
    if (query.buildingId) params.buildingId = query.buildingId;
    if (query.status) params.status = query.status;

    return unwrap(await apiClient.get<ApiResponse<CalendarResultDto>>('/calendar', { params }));
  },
};
