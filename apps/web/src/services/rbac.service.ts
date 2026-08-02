import type {
  ApiResponse,
  CreateRoleInput,
  ListUsersQuery,
  PaginatedData,
  PermissionKey,
  RoleDto,
  UpdateRoleInput,
  UserDto,
} from '@monhorus/shared';

import { apiClient, unwrap } from '../lib/api-client';

export interface PermissionCatalogueEntry {
  key: PermissionKey;
  module: string;
  label: string;
}

export const rbacService = {
  async permissions(): Promise<PermissionCatalogueEntry[]> {
    return unwrap(
      await apiClient.get<ApiResponse<PermissionCatalogueEntry[]>>('/rbac/permissions'),
    );
  },

  async roles(): Promise<RoleDto[]> {
    return unwrap(await apiClient.get<ApiResponse<RoleDto[]>>('/rbac/roles'));
  },

  async createRole(payload: CreateRoleInput): Promise<RoleDto> {
    return unwrap(await apiClient.post<ApiResponse<RoleDto>>('/rbac/roles', payload));
  },

  async updateRole(roleId: string, payload: UpdateRoleInput): Promise<RoleDto> {
    return unwrap(await apiClient.patch<ApiResponse<RoleDto>>(`/rbac/roles/${roleId}`, payload));
  },

  async deleteRole(roleId: string): Promise<RoleDto> {
    return unwrap(await apiClient.delete<ApiResponse<RoleDto>>(`/rbac/roles/${roleId}`));
  },

  async assignRoles(userId: string, roleIds: string[]): Promise<{ roleIds: string[] }> {
    return unwrap(
      await apiClient.post<ApiResponse<{ userId: string; roleIds: string[] }>>(
        `/rbac/users/${userId}/roles`,
        { roleIds },
      ),
    );
  },

  async users(query: ListUsersQuery = {}): Promise<PaginatedData<UserDto>> {
    return unwrap(
      await apiClient.get<ApiResponse<PaginatedData<UserDto>>>('/users', { params: query }),
    );
  },
};
