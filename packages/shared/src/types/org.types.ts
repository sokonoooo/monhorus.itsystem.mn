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
  /** Absent means the first page. The lookups the employee form uses ask for one page too. */
  page?: number;
  limit?: number;
}

/**
 * Department and position rows carry their parents' NAMES as well as their ids.
 *
 * The management tables show "which company" in a column, and a table that received only an
 * id would have to fetch the whole company list to render one cell — the N+1 that the
 * denormalised `*Name` fields elsewhere in this codebase exist to avoid.
 */
export interface DepartmentListItemDto extends DepartmentDto {
  companyName: string | null;
}

export interface PositionListItemDto extends PositionDto {
  companyName: string | null;
  departmentName: string | null;
}

/**
 * Codes are issued by the server, never sent by a client.
 *
 * `COM-001` / `DEP-001` / `POS-001` come from the same atomic counter that issues `PRJ-001`
 * and `BLD-001`, so two admins registering at once cannot collide. There is deliberately no
 * `code` field on any request type below: a code that can be typed is a code that can be
 * duplicated, and a code that can be edited is not an identifier.
 */
export interface CreateCompanyRequest {
  name: string;
  registrationNumber?: string | null;
  address?: string | null;
}

export type UpdateCompanyRequest = Partial<CreateCompanyRequest>;

export interface CreateDepartmentRequest {
  companyId: string;
  name: string;
}

/** The company is fixed at creation: moving a department between companies would rewrite
 *  the org chart under everyone already assigned to it. */
export type UpdateDepartmentRequest = { name?: string };

export interface CreatePositionRequest {
  companyId: string;
  /** Null or absent means the position is valid across every department of the company. */
  departmentId?: string | null;
  name: string;
}

export type UpdatePositionRequest = { name?: string; departmentId?: string | null };

/** Activate/deactivate. Deactivating hides a record from new selections and leaves every
 *  existing assignment intact. */
export interface SetOrgActiveRequest {
  isActive: boolean;
}
