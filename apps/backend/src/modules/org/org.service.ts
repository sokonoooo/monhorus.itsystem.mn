import type {
  CompanyDto,
  DepartmentListItemDto,
  PaginatedData,
  PositionListItemDto,
  TeamDto,
} from '@monhorus/shared';
import { Types, type FilterQuery, type HydratedDocument } from 'mongoose';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { nextSequenceValue } from '../../common/models/counter.model';
import type { AuthContext } from '../../common/types/express';
import type { RequestMeta } from '../../common/utils/request-meta.util';
import { recordAudit } from '../audit/audit.service';
import {
  Company,
  Department,
  Position,
  Team,
  type ICompany,
  type IDepartment,
  type IPosition,
  type ITeam,
} from './org.models';
import type {
  CreateCompanyBody,
  CreateDepartmentBody,
  CreatePositionBody,
  OrgListQuery,
  UpdateCompanyBody,
  UpdateDepartmentBody,
  UpdatePositionBody,
} from './org.validation';

/**
 * Internal organisation master data: the provider's own companies, departments and
 * positions.
 *
 * THERE IS NO DELETE, and that is the design rather than an omission. A department that
 * is no longer staffed is deactivated, which removes it from every new selection while
 * the employees already assigned to it keep resolving their own history. Deleting it
 * would leave those records pointing at nothing.
 */

type Doc<T> = HydratedDocument<T>;

const COMPANY_ENTITY = 'Company';
const DEPARTMENT_ENTITY = 'Department';
const POSITION_ENTITY = 'Position';

const NAME_POPULATE = { select: 'name' } as const;

/**
 * A reference that may or may not have been populated.
 *
 * `String(doc)` on a populated reference yields the document, not its id, so both halves
 * are read explicitly instead of being stringified in place.
 */
type MaybePopulated = { _id: Types.ObjectId; name?: string } | Types.ObjectId | null | undefined;

function refId(value: MaybePopulated): string | null {
  if (!value) return null;
  return value instanceof Types.ObjectId ? String(value) : String(value._id);
}

function refName(value: MaybePopulated): string | null {
  if (!value || value instanceof Types.ObjectId) return null;
  return value.name ?? null;
}

function actorOf(actor: AuthContext): { id: string; role: AuthContext['role']; label: string } {
  return { id: actor.userId, role: actor.role, label: actor.fullName };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Active-only unless the caller explicitly asks to see what has been retired. */
function activeFilter(query: OrgListQuery): Record<string, unknown> {
  return query.includeInactive ? {} : { isActive: true };
}

function searchFilter(query: OrgListQuery): Record<string, unknown> {
  if (!query.search) return {};
  const pattern = new RegExp(escapeRegex(query.search), 'i');
  return { $or: [{ name: pattern }, { code: pattern }] };
}

function paginated<T>(items: T[], total: number, query: OrgListQuery): PaginatedData<T> {
  return {
    items,
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}

// -- Code allocation ----------------------------------------------------------

const MAX_CODE_ATTEMPTS = 5;

/**
 * Issues the next `COM-001` / `DEP-001` / `POS-001`.
 *
 * The same atomic counter that issues `PRJ-001` and `BLD-001`: `findOneAndUpdate` with
 * `$inc` is a single document operation, so two admins registering at once are handed two
 * different numbers. Counting existing rows instead would hand both the same one.
 *
 * The counter is per KIND rather than per company even though department and position
 * codes are only unique per company. A globally unique `DEP-007` means a code identifies
 * one department outright, which the management table needs: it lists departments across
 * every company at once, and two rows reading `DEP-001` there would be unreadable.
 *
 * The `taken` probe covers what the counter cannot know — a code entered by hand before
 * the counter existed. Skipping a candidate leaves a gap, which is the same thing a
 * deleted project code does to `PRJ-`, and is preferable to reusing an identifier.
 */
async function allocateCode(
  prefix: 'COM' | 'DEP' | 'POS',
  taken: (code: string) => Promise<boolean>,
): Promise<string> {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    const sequence = await nextSequenceValue(`org:${prefix}`);
    // Padded to three so a list sorts the way a reader expects for the first 999, and
    // simply grows past it — DEP-1000 is ugly but correct, and truncating would collide.
    const candidate = `${prefix}-${String(sequence).padStart(3, '0')}`;
    if (await taken(candidate)) continue;
    return candidate;
  }

  throw AppError.conflict(ERROR_CODES.DUPLICATE_KEY, 'Чөлөөтэй код олдсонгүй.');
}

// -- Parent integrity ---------------------------------------------------------

/**
 * Resolves the company a child is being filed under.
 *
 * The frontend only ever offers companies that exist, but that is a convenience: a
 * hand-crafted request naming a company that was never created is rejected here.
 */
async function requireCompanyId(companyId: string): Promise<Types.ObjectId> {
  const company = await Company.findById(companyId).select('_id');
  if (!company) {
    throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Компани олдсонгүй.', [
      { field: 'companyId', message: 'Компани олдсонгүй.' },
    ]);
  }
  return company._id;
}

/**
 * The one real integrity rule in this module: a position may only be scoped to a
 * department of its OWN company. Null is always allowed and means company-wide.
 */
async function resolveDepartmentOfCompany(
  departmentId: string | null | undefined,
  companyId: Types.ObjectId,
): Promise<Types.ObjectId | null> {
  if (!departmentId) return null;

  const department = await Department.findById(departmentId).select('company');
  if (!department) {
    throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Алба олдсонгүй.', [
      { field: 'departmentId', message: 'Алба олдсонгүй.' },
    ]);
  }
  if (String(department.company) !== String(companyId)) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Сонгосон алба тухайн компанид харьяалагдахгүй байна.',
      [{ field: 'departmentId', message: 'Алба сонгосон компанид харьяалагдахгүй.' }],
    );
  }
  return department._id;
}

// -- Mappers ------------------------------------------------------------------

export function toCompanyDto(company: Doc<ICompany>): CompanyDto {
  return {
    id: String(company._id),
    code: company.code,
    name: company.name,
    registrationNumber: company.registrationNumber,
    address: company.address,
    isActive: company.isActive,
  };
}

function toDepartmentListItemDto(department: Doc<IDepartment>): DepartmentListItemDto {
  const company = department.company as unknown as MaybePopulated;
  return {
    id: String(department._id),
    companyId: refId(company) ?? '',
    companyName: refName(company),
    code: department.code,
    name: department.name,
    isActive: department.isActive,
  };
}

function toPositionListItemDto(position: Doc<IPosition>): PositionListItemDto {
  const company = position.company as unknown as MaybePopulated;
  const department = position.department as unknown as MaybePopulated;
  return {
    id: String(position._id),
    companyId: refId(company) ?? '',
    companyName: refName(company),
    departmentId: refId(department),
    departmentName: refName(department),
    code: position.code,
    name: position.name,
    isActive: position.isActive,
  };
}

function toTeamDto(team: Doc<ITeam>): TeamDto {
  return {
    id: String(team._id),
    companyId: String(team.company),
    departmentId: team.department ? String(team.department) : null,
    code: team.code,
    name: team.name,
    leaderEmployeeId: team.leaderEmployee ? String(team.leaderEmployee) : null,
    isActive: team.isActive,
  };
}

// -- Companies ----------------------------------------------------------------

export async function listCompanies(query: OrgListQuery): Promise<PaginatedData<CompanyDto>> {
  const filter: FilterQuery<ICompany> = { ...activeFilter(query), ...searchFilter(query) };
  const skip = (query.page - 1) * query.limit;

  const [rows, total] = await Promise.all([
    Company.find(filter).sort({ name: 1 }).skip(skip).limit(query.limit),
    Company.countDocuments(filter),
  ]);

  return paginated(rows.map(toCompanyDto), total, query);
}

export async function createCompany(
  input: CreateCompanyBody,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<CompanyDto> {
  const code = await allocateCode('COM', async (candidate) =>
    Boolean(await Company.exists({ code: candidate })),
  );

  const company = await Company.create({
    code,
    name: input.name,
    registrationNumber: input.registrationNumber ?? null,
    address: input.address ?? null,
  });

  await recordAudit({
    entityType: COMPANY_ENTITY,
    entityId: company._id,
    action: 'Created',
    actor: actorOf(actor),
    meta,
    newValue: { code: company.code, name: company.name },
  });

  return toCompanyDto(company);
}

export async function updateCompany(
  companyId: string,
  input: UpdateCompanyBody,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<CompanyDto> {
  const company = await Company.findById(companyId);
  if (!company) throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Компани олдсонгүй.');

  const before = {
    name: company.name,
    registrationNumber: company.registrationNumber,
    address: company.address,
  };

  if (input.name !== undefined) company.name = input.name;
  if (input.registrationNumber !== undefined) {
    company.registrationNumber = input.registrationNumber ?? null;
  }
  if (input.address !== undefined) company.address = input.address ?? null;
  await company.save();

  await recordAudit({
    entityType: COMPANY_ENTITY,
    entityId: company._id,
    action: 'Updated',
    actor: actorOf(actor),
    meta,
    oldValue: before,
    newValue: {
      name: company.name,
      registrationNumber: company.registrationNumber,
      address: company.address,
    },
  });

  return toCompanyDto(company);
}

/**
 * Deactivation is ALWAYS allowed, including while employees are assigned.
 *
 * It means "no longer offered for new selections", not "never existed": the assignments
 * already pointing here stay exactly as they are, and reactivating puts the record back
 * in the pickers unchanged. Refusing on the grounds that something references it would
 * make a retired company permanent.
 */
export async function setCompanyActive(
  companyId: string,
  isActive: boolean,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<CompanyDto> {
  const company = await Company.findById(companyId);
  if (!company) throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Компани олдсонгүй.');

  const before = company.isActive;
  company.isActive = isActive;
  await company.save();

  await recordAudit({
    entityType: COMPANY_ENTITY,
    entityId: company._id,
    action: 'StatusChanged',
    actor: actorOf(actor),
    meta,
    oldValue: { isActive: before },
    newValue: { isActive: company.isActive },
  });

  return toCompanyDto(company);
}

// -- Departments --------------------------------------------------------------

/**
 * `companyId` narrows the list; it does not gate it.
 *
 * The management table lists every company's departments at once, which is what the
 * `companyName` column on the row DTO is for. The dependent selector on the employee form
 * narrows by passing the company it has, and holds back its own request until one is
 * chosen — a decision that belongs to the form, not to this query.
 */
export async function listDepartments(
  query: OrgListQuery,
): Promise<PaginatedData<DepartmentListItemDto>> {
  const filter: FilterQuery<IDepartment> = { ...activeFilter(query), ...searchFilter(query) };
  if (query.companyId) filter.company = new Types.ObjectId(query.companyId);

  const skip = (query.page - 1) * query.limit;

  const [rows, total] = await Promise.all([
    // One populate for the whole page rather than a company lookup per row.
    Department.find(filter)
      .populate({ path: 'company', ...NAME_POPULATE })
      .sort({ name: 1 })
      .skip(skip)
      .limit(query.limit),
    Department.countDocuments(filter),
  ]);

  return paginated(rows.map(toDepartmentListItemDto), total, query);
}

export async function createDepartment(
  input: CreateDepartmentBody,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<DepartmentListItemDto> {
  const companyId = await requireCompanyId(input.companyId);

  const code = await allocateCode('DEP', async (candidate) =>
    Boolean(await Department.exists({ company: companyId, code: candidate })),
  );

  const created = await Department.create({ company: companyId, code, name: input.name });

  await recordAudit({
    entityType: DEPARTMENT_ENTITY,
    entityId: created._id,
    action: 'Created',
    actor: actorOf(actor),
    meta,
    newValue: { code: created.code, name: created.name, companyId: String(companyId) },
  });

  const department = await created.populate({ path: 'company', ...NAME_POPULATE });
  return toDepartmentListItemDto(department);
}

export async function updateDepartment(
  departmentId: string,
  input: UpdateDepartmentBody,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<DepartmentListItemDto> {
  const department = await Department.findById(departmentId);
  if (!department) throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Алба олдсонгүй.');

  const before = { name: department.name };
  department.name = input.name;
  await department.save();

  await recordAudit({
    entityType: DEPARTMENT_ENTITY,
    entityId: department._id,
    action: 'Updated',
    actor: actorOf(actor),
    meta,
    oldValue: before,
    newValue: { name: department.name },
  });

  return toDepartmentListItemDto(await department.populate({ path: 'company', ...NAME_POPULATE }));
}

export async function setDepartmentActive(
  departmentId: string,
  isActive: boolean,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<DepartmentListItemDto> {
  const department = await Department.findById(departmentId);
  if (!department) throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Алба олдсонгүй.');

  const before = department.isActive;
  department.isActive = isActive;
  await department.save();

  await recordAudit({
    entityType: DEPARTMENT_ENTITY,
    entityId: department._id,
    action: 'StatusChanged',
    actor: actorOf(actor),
    meta,
    oldValue: { isActive: before },
    newValue: { isActive: department.isActive },
  });

  return toDepartmentListItemDto(await department.populate({ path: 'company', ...NAME_POPULATE }));
}

// -- Positions ----------------------------------------------------------------

export async function listPositions(
  query: OrgListQuery,
): Promise<PaginatedData<PositionListItemDto>> {
  const filter: FilterQuery<IPosition> = { ...activeFilter(query), ...searchFilter(query) };
  if (query.companyId) filter.company = new Types.ObjectId(query.companyId);
  if (query.departmentId) {
    // A position with a null department is company-wide and therefore always valid.
    filter.$and = [
      {
        $or: [{ department: null }, { department: new Types.ObjectId(query.departmentId) }],
      },
    ];
  }

  const skip = (query.page - 1) * query.limit;

  const [rows, total] = await Promise.all([
    Position.find(filter)
      .populate([
        { path: 'company', ...NAME_POPULATE },
        { path: 'department', ...NAME_POPULATE },
      ])
      .sort({ name: 1 })
      .skip(skip)
      .limit(query.limit),
    Position.countDocuments(filter),
  ]);

  return paginated(rows.map(toPositionListItemDto), total, query);
}

const POSITION_POPULATE = [
  { path: 'company', ...NAME_POPULATE },
  { path: 'department', ...NAME_POPULATE },
];

export async function createPosition(
  input: CreatePositionBody,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<PositionListItemDto> {
  const companyId = await requireCompanyId(input.companyId);
  const departmentId = await resolveDepartmentOfCompany(input.departmentId, companyId);

  const code = await allocateCode('POS', async (candidate) =>
    Boolean(await Position.exists({ company: companyId, code: candidate })),
  );

  const created = await Position.create({
    company: companyId,
    department: departmentId,
    code,
    name: input.name,
  });

  await recordAudit({
    entityType: POSITION_ENTITY,
    entityId: created._id,
    action: 'Created',
    actor: actorOf(actor),
    meta,
    newValue: {
      code: created.code,
      name: created.name,
      companyId: String(companyId),
      departmentId: departmentId ? String(departmentId) : null,
    },
  });

  return toPositionListItemDto(await created.populate(POSITION_POPULATE));
}

export async function updatePosition(
  positionId: string,
  input: UpdatePositionBody,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<PositionListItemDto> {
  const position = await Position.findById(positionId);
  if (!position) throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Албан тушаал олдсонгүй.');

  const before = {
    name: position.name,
    departmentId: position.department ? String(position.department) : null,
  };

  if (input.name !== undefined) position.name = input.name;
  if (input.departmentId !== undefined) {
    // Checked against the position's OWN company, not one supplied by the caller: the
    // company is fixed at creation and is the only thing the new department must match.
    position.department = await resolveDepartmentOfCompany(input.departmentId, position.company);
  }
  await position.save();

  await recordAudit({
    entityType: POSITION_ENTITY,
    entityId: position._id,
    action: 'Updated',
    actor: actorOf(actor),
    meta,
    oldValue: before,
    newValue: {
      name: position.name,
      departmentId: position.department ? String(position.department) : null,
    },
  });

  return toPositionListItemDto(await position.populate(POSITION_POPULATE));
}

export async function setPositionActive(
  positionId: string,
  isActive: boolean,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<PositionListItemDto> {
  const position = await Position.findById(positionId);
  if (!position) throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Албан тушаал олдсонгүй.');

  const before = position.isActive;
  position.isActive = isActive;
  await position.save();

  await recordAudit({
    entityType: POSITION_ENTITY,
    entityId: position._id,
    action: 'StatusChanged',
    actor: actorOf(actor),
    meta,
    oldValue: { isActive: before },
    newValue: { isActive: position.isActive },
  });

  return toPositionListItemDto(await position.populate(POSITION_POPULATE));
}

// -- Teams --------------------------------------------------------------------

/**
 * Teams are a lookup only: a bare array, scoped to one company, with no management
 * screen behind it yet. Left exactly as it was rather than paginated for symmetry,
 * because nothing consumes a page of teams.
 */
export async function listTeams(query: OrgListQuery): Promise<TeamDto[]> {
  if (!query.companyId) return [];

  const departmentClause = query.departmentId
    ? { $or: [{ department: null }, { department: new Types.ObjectId(query.departmentId) }] }
    : {};

  const teams = await Team.find({
    company: new Types.ObjectId(query.companyId),
    ...departmentClause,
    ...activeFilter(query),
    ...searchFilter(query),
  }).sort({ name: 1 });

  return teams.map(toTeamDto);
}
