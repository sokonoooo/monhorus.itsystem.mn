import type { ApiResponse, PaginatedData } from '@monhorus/shared';

import { apiClient, unwrap } from '../lib/api-client';

export interface AuditEntryDto {
  id: string;
  entityType: string;
  entityId: string | null;
  action: string;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  channel: string | null;
  ip: string | null;
  userAgent: string | null;
  oldValue: unknown;
  newValue: unknown;
  changedFields: string[];
  reason: string | null;
  occurredAt: string;
}

export interface AuditQuery {
  page?: number;
  limit?: number;
  entityType?: string;
  entityId?: string;
  action?: string;
  userId?: string;
  search?: string;
  from?: string;
  to?: string;
}

export interface AuditFacets {
  entityTypes: string[];
  actions: string[];
}

export const auditService = {
  async list(query: AuditQuery = {}): Promise<PaginatedData<AuditEntryDto>> {
    return unwrap(
      await apiClient.get<ApiResponse<PaginatedData<AuditEntryDto>>>('/audit', { params: query }),
    );
  },

  async facets(): Promise<AuditFacets> {
    return unwrap(await apiClient.get<ApiResponse<AuditFacets>>('/audit/facets'));
  },
};
