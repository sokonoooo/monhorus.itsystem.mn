import type {
  ApiResponse,
  CreateCustomerInput,
  CreateObjectNodeInput,
  CustomerDto,
  ObjectBreadcrumbDto,
  ObjectNodeDto,
  ObjectNodeKind,
  PaginatedData,
  UpdateCustomerInput,
  UpdateObjectNodeInput,
} from '@monhorus/shared';

import { apiClient, unwrap } from '../lib/api-client';

export interface CustomerListQuery {
  page?: number;
  limit?: number;
  search?: string;
  isActive?: boolean;
  responsibleEmployeeId?: string;
  hasActiveAgreement?: boolean;
  sortBy?: 'name' | 'code' | 'createdAt';
  sortDir?: 'asc' | 'desc';
}

/** Query-string form: the API takes booleans as 'true' / 'false'. */
function toParams(query: CustomerListQuery): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  if (query.page !== undefined) params.page = query.page;
  if (query.limit !== undefined) params.limit = query.limit;
  if (query.search) params.search = query.search;
  if (query.isActive !== undefined) params.isActive = String(query.isActive);
  if (query.responsibleEmployeeId) params.responsibleEmployeeId = query.responsibleEmployeeId;
  if (query.hasActiveAgreement !== undefined) {
    params.hasActiveAgreement = String(query.hasActiveAgreement);
  }
  if (query.sortBy) params.sortBy = query.sortBy;
  if (query.sortDir) params.sortDir = query.sortDir;
  return params;
}

/**
 * Object hierarchy access.
 *
 * The hierarchy is loaded one level at a time. An unscoped `nodes` call returns an
 * empty list from the backend by design, so the whole tree is never fetched at once.
 */
export const objectService = {
  /** Paginated list for the customer management screen. */
  async listCustomers(query: CustomerListQuery = {}): Promise<PaginatedData<CustomerDto>> {
    return unwrap(
      await apiClient.get<ApiResponse<PaginatedData<CustomerDto>>>('/objects/customers', {
        params: toParams(query),
      }),
    );
  },

  /**
   * Flat list for selector controls. Wraps the paginated endpoint and returns just
   * the rows, so a dropdown does not have to know about pagination.
   */
  async customers(search?: string): Promise<CustomerDto[]> {
    const page = await objectService.listCustomers({
      limit: 100,
      ...(search ? { search } : {}),
    });
    return page.items;
  },

  async getCustomer(customerId: string): Promise<CustomerDto> {
    return unwrap(
      await apiClient.get<ApiResponse<CustomerDto>>(`/objects/customers/${customerId}`),
    );
  },

  async createCustomer(payload: CreateCustomerInput): Promise<CustomerDto> {
    return unwrap(await apiClient.post<ApiResponse<CustomerDto>>('/objects/customers', payload));
  },

  async updateCustomer(customerId: string, payload: UpdateCustomerInput): Promise<CustomerDto> {
    return unwrap(
      await apiClient.patch<ApiResponse<CustomerDto>>(
        `/objects/customers/${customerId}`,
        payload,
      ),
    );
  },

  /**
   * Direct children of a node, optionally narrowed to one kind.
   *
   * The kind filter is what the zones section reads: a floor's children are its rooms, and
   * asking for `ROOM` keeps the list to that level rather than to whatever else has been
   * hung off the floor. Callers that want the whole level pass no kind, so the dependent
   * location selector is unchanged.
   */
  async children(parentId: string, kind?: ObjectNodeKind): Promise<ObjectNodeDto[]> {
    if (!parentId) return [];
    return unwrap(
      await apiClient.get<ApiResponse<ObjectNodeDto[]>>('/objects/nodes', {
        params: kind ? { parentId, kind } : { parentId },
      }),
    );
  },

  /** Top-level nodes of a given kind for a customer, used for the root level. */
  async rootNodes(customerId: string, kind: ObjectNodeKind): Promise<ObjectNodeDto[]> {
    if (!customerId) return [];
    return unwrap(
      await apiClient.get<ApiResponse<ObjectNodeDto[]>>('/objects/nodes', {
        params: { customerId, kind },
      }),
    );
  },

  async createNode(payload: CreateObjectNodeInput): Promise<ObjectNodeDto> {
    return unwrap(await apiClient.post<ApiResponse<ObjectNodeDto>>('/objects/nodes', payload));
  },

  async updateNode(nodeId: string, payload: UpdateObjectNodeInput): Promise<ObjectNodeDto> {
    return unwrap(
      await apiClient.patch<ApiResponse<ObjectNodeDto>>(`/objects/nodes/${nodeId}`, payload),
    );
  },

  /**
   * Removes a node outright.
   *
   * Refused with a 409 carrying the blockers by name when anything still references the
   * node. That message is the backend's own and is meant to be shown as it stands, with
   * archiving — `updateNode(id, { isActive: false })` — offered as the way through.
   */
  async deleteNode(nodeId: string): Promise<void> {
    await apiClient.delete(`/objects/nodes/${nodeId}`);
  },

  async breadcrumb(nodeId: string): Promise<ObjectBreadcrumbDto[]> {
    return unwrap(
      await apiClient.get<ApiResponse<ObjectBreadcrumbDto[]>>(
        `/objects/nodes/${nodeId}/breadcrumb`,
      ),
    );
  },
};
