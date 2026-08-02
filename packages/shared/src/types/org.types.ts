/**
 * Internal organisation master data. This is the service provider's own structure,
 * distinct from the customer hierarchy in object.types.ts.
 */
export interface CompanyDto {
  id: string;
  code: string;
  name: string;
  registrationNumber: string | null;
  address: string | null;
  isActive: boolean;
}

export interface DepartmentDto {
  id: string;
  companyId: string;
  code: string;
  name: string;
  isActive: boolean;
}

export interface PositionDto {
  id: string;
  companyId: string;
  /** Null means the position is valid across every department of the company. */
  departmentId: string | null;
  code: string;
  name: string;
  isActive: boolean;
}

export interface TeamDto {
  id: string;
  companyId: string;
  departmentId: string | null;
  code: string;
  name: string;
  leaderEmployeeId: string | null;
  memberCount?: number;
  isActive: boolean;
}

export interface OrgLookupQuery {
  companyId?: string;
  departmentId?: string;
  includeInactive?: boolean;
  search?: string;
}
