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
  /**
   * Who created the record, resolved to a display name.
   *
   * Null where it is not known: rows created before the creator was recorded, and
   * records the system itself made. The screen renders that as a dash rather than
   * guessing, because an absent creator is a real answer here.
   */
  createdByName: string | null;
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
