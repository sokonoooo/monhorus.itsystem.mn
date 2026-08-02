import type {
  ApiResponse,
  InspectionListItemDto,
  InspectionListQuery,
  InspectionSummaryDto,
  KpiSummaryDto,
  NotificationDto,
  NotificationListQuery,
  NotificationUnreadCountDto,
  PaginatedData,
  ReportKey,
  ReportQuery,
  ReportResultDto,
} from '@monhorus/shared';

import { apiClient, unwrap } from '../lib/api-client';
import { tokenStorage } from '../lib/token-storage';

function toParams(query: Record<string, unknown>): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params[key] = typeof value === 'boolean' ? String(value) : (value as string | number);
  }
  return params;
}

/** Consolidated device conclusion report (Нэгдсэн төхөөрөмжийн тайлан). */
export const inspectionService = {
  async list(query: InspectionListQuery = {}): Promise<PaginatedData<InspectionListItemDto>> {
    return unwrap(
      await apiClient.get<ApiResponse<PaginatedData<InspectionListItemDto>>>('/inspections', {
        params: toParams(query as Record<string, unknown>),
      }),
    );
  },

  async summary(query: InspectionListQuery = {}): Promise<InspectionSummaryDto> {
    return unwrap(
      await apiClient.get<ApiResponse<InspectionSummaryDto>>('/inspections/summary', {
        params: toParams(query as Record<string, unknown>),
      }),
    );
  },
};

export const reportService = {
  async catalogue(): Promise<{ key: ReportKey; label: string }[]> {
    return unwrap(await apiClient.get<ApiResponse<{ key: ReportKey; label: string }[]>>('/reports'));
  },

  async run(key: ReportKey, query: ReportQuery = {}): Promise<ReportResultDto> {
    return unwrap(
      await apiClient.get<ApiResponse<ReportResultDto>>(`/reports/${key}`, {
        params: toParams(query as Record<string, unknown>),
      }),
    );
  },

  async kpis(dateFrom: string, dateTo: string): Promise<KpiSummaryDto> {
    return unwrap(
      await apiClient.get<ApiResponse<KpiSummaryDto>>('/reports/kpi', {
        params: { dateFrom, dateTo },
      }),
    );
  },

  /**
   * Downloads the CSV export.
   *
   * The endpoint is authenticated, so the file cannot be fetched by pointing a link at it.
   * It is requested with the bearer token, turned into an object URL and handed to a
   * synthetic anchor, which is the same approach the authenticated image preview uses.
   */
  async downloadCsv(key: ReportKey, query: ReportQuery = {}): Promise<void> {
    const response = await apiClient.get<Blob>(`/reports/${key}`, {
      params: { ...toParams(query as Record<string, unknown>), format: 'csv' },
      responseType: 'blob',
      headers: { Authorization: `Bearer ${tokenStorage.getAccessToken() ?? ''}` },
    });

    const url = URL.createObjectURL(response.data);
    try {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${key.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      URL.revokeObjectURL(url);
    }
  },
};

export const notificationService = {
  async list(query: NotificationListQuery = {}): Promise<PaginatedData<NotificationDto>> {
    return unwrap(
      await apiClient.get<ApiResponse<PaginatedData<NotificationDto>>>('/notifications', {
        params: toParams(query as Record<string, unknown>),
      }),
    );
  },

  async unreadCount(): Promise<NotificationUnreadCountDto> {
    return unwrap(
      await apiClient.get<ApiResponse<NotificationUnreadCountDto>>('/notifications/unread-count'),
    );
  },

  async markRead(notificationId: string): Promise<NotificationDto> {
    return unwrap(
      await apiClient.post<ApiResponse<NotificationDto>>(`/notifications/${notificationId}/read`),
    );
  },

  async markAllRead(): Promise<{ updated: number }> {
    return unwrap(await apiClient.post<ApiResponse<{ updated: number }>>('/notifications/read-all'));
  },
};
