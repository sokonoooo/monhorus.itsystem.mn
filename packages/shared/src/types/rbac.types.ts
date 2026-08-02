import type { PermissionKey, PermissionModule } from '../constants/permissions';

export interface PermissionDto {
  key: PermissionKey;
  module: PermissionModule;
  label: string;
}

export interface RoleDto {
  id: string;
  key: string;
  name: string;
  description: string | null;
  permissions: PermissionKey[];
  isSystem: boolean;
  userCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRoleRequest {
  key: string;
  name: string;
  description?: string | null;
  permissions: PermissionKey[];
}

export interface UpdateRoleRequest {
  name?: string;
  description?: string | null;
  permissions?: PermissionKey[];
}

export interface AssignRolesRequest {
  roleIds: string[];
}
