import {
  PERMISSIONS,
  type ChangeEmployeeStatusInput,
  type CreateEmployeeInput,
  type EmployeeDetailDto,
  type EmployeeListItemDto,
  type EmployeeListQueryInput,
  type EmployeeSalaryInput,
  type EmployeeSalaryDto,
  type PaginatedData,
  type UpdateEmployeeInput,
} from '@monhorus/shared';
import { Types, type FilterQuery } from 'mongoose';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import type { AuthContext } from '../../common/types/express';
import { CREATOR_POPULATE } from '../../common/utils/creator.util';
import type { RequestMeta } from '../../common/utils/request-meta.util';
import { logger } from '../../config/logger';
import { hasPermission } from '../../middlewares/authorize.middleware';
import { recordAudit } from '../audit/audit.service';
import { Company, Department, Position, Team } from '../org/org.models';
import { buildSystemAccessDto } from './employee-access.service';
import { EmployeeDocument } from './employee-document.model';
import { getEmployeeWorkload } from './employee-workload.service';
import { EmployeeSalary } from './employee-salary.model';
import { EmployeeStatusHistory } from './employee-status-history.model';
import { Employee, type IEmployee } from './employee.model';
import {
  toEmployeeDetailDto,
  toEmployeeListItemDto,
  toEmployeeSelfDto,
  toSalaryDto,
  type EmployeeSelfDto,
} from './employee.mapper';

const ORG_POPULATE = [
  { path: 'company', select: 'name' },
  { path: 'department', select: 'name' },
  { path: 'position', select: 'name' },
  { path: 'team', select: 'name' },
] as const;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

// -- Relationship validation -------------------------------------------------

interface OrgSelection {
  companyId?: string | null;
  departmentId?: string | null;
  positionId?: string | null;
  teamId?: string | null;
  directManagerId?: string | null;
}

/**
 * Enforces the dependent-selector rules from the Phase 1 brief.
 *
 * The frontend clears invalid child selections when a parent changes, but that is a
 * convenience only. This function is the authority: a hand-crafted request that pairs
 * a department with the wrong company is rejected here.
 */
export async function validateOrgRelationships(
  selection: OrgSelection,
  employeeIdBeingEdited?: string,
): Promise<void> {
  const { companyId, departmentId, positionId, teamId, directManagerId } = selection;

  if (companyId) {
    const company = await Company.findById(companyId).select('_id isActive');
    if (!company) {
      throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Компани олдсонгүй.', [
        { field: 'companyId', message: 'Компани олдсонгүй.' },
      ]);
    }
  }

  if (departmentId) {
    const department = await Department.findById(departmentId).select('company');
    if (!department) {
      throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Алба олдсонгүй.', [
        { field: 'departmentId', message: 'Алба олдсонгүй.' },
      ]);
    }
    if (!companyId || String(department.company) !== companyId) {
      throw AppError.badRequest(
        ERROR_CODES.VALIDATION_ERROR,
        'Сонгосон алба тухайн компанид харьяалагдахгүй байна.',
        [{ field: 'departmentId', message: 'Алба сонгосон компанид харьяалагдахгүй.' }],
      );
    }
  }

  if (positionId) {
    const position = await Position.findById(positionId).select('company department');
    if (!position) {
      throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Албан тушаал олдсонгүй.', [
        { field: 'positionId', message: 'Албан тушаал олдсонгүй.' },
      ]);
    }
    if (!companyId || String(position.company) !== companyId) {
      throw AppError.badRequest(
        ERROR_CODES.VALIDATION_ERROR,
        'Сонгосон албан тушаал тухайн компанид харьяалагдахгүй байна.',
        [{ field: 'positionId', message: 'Албан тушаал сонгосон компанид харьяалагдахгүй.' }],
      );
    }
    // A position scoped to a department must match the selected department.
    if (position.department && (!departmentId || String(position.department) !== departmentId)) {
      throw AppError.badRequest(
        ERROR_CODES.VALIDATION_ERROR,
        'Сонгосон албан тушаал тухайн албанд харьяалагдахгүй байна.',
        [{ field: 'positionId', message: 'Албан тушаал сонгосон албанд харьяалагдахгүй.' }],
      );
    }
  }

  if (teamId) {
    const team = await Team.findById(teamId).select('company department');
    if (!team) {
      throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Баг олдсонгүй.', [
        { field: 'teamId', message: 'Баг олдсонгүй.' },
      ]);
    }
    if (!companyId || String(team.company) !== companyId) {
      throw AppError.badRequest(
        ERROR_CODES.VALIDATION_ERROR,
        'Сонгосон баг тухайн компанид харьяалагдахгүй байна.',
        [{ field: 'teamId', message: 'Баг сонгосон компанид харьяалагдахгүй.' }],
      );
    }
    if (team.department && departmentId && String(team.department) !== departmentId) {
      throw AppError.badRequest(
        ERROR_CODES.VALIDATION_ERROR,
        'Сонгосон баг тухайн албанд харьяалагдахгүй байна.',
        [{ field: 'teamId', message: 'Баг сонгосон албанд харьяалагдахгүй.' }],
      );
    }
  }

  if (directManagerId) {
    if (employeeIdBeingEdited && directManagerId === employeeIdBeingEdited) {
      throw AppError.badRequest(
        ERROR_CODES.VALIDATION_ERROR,
        'Ажилтан өөрийгөө удирдах боломжгүй.',
        [{ field: 'directManagerId', message: 'Өөрийгөө шууд удирдлагаар сонгох боломжгүй.' }],
      );
    }

    const manager = await Employee.findById(directManagerId).select('status company');
    if (!manager) {
      throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Шууд удирдлага олдсонгүй.', [
        { field: 'directManagerId', message: 'Шууд удирдлага олдсонгүй.' },
      ]);
    }
    if (manager.status !== 'ACTIVE') {
      throw AppError.badRequest(
        ERROR_CODES.VALIDATION_ERROR,
        'Шууд удирдлага идэвхтэй ажилтан байх ёстой.',
        [{ field: 'directManagerId', message: 'Зөвхөн идэвхтэй ажилтныг сонгоно.' }],
      );
    }
    if (companyId && manager.company && String(manager.company) !== companyId) {
      throw AppError.badRequest(
        ERROR_CODES.VALIDATION_ERROR,
        'Шууд удирдлага өөр компанид харьяалагдаж байна.',
        [{ field: 'directManagerId', message: 'Удирдлага өөр компанийнх байна.' }],
      );
    }
  }
}

/** Uniqueness checks that the shared Zod schema cannot perform. */
async function assertUniqueIdentifiers(
  input: Partial<CreateEmployeeInput>,
  excludeEmployeeId?: string,
): Promise<void> {
  const checks: Array<{ field: string; value: string | null | undefined; message: string }> = [
    { field: 'employeeCode', value: input.employeeCode?.toUpperCase(), message: 'Энэ ажилтны код бүртгэгдсэн байна.' },
    { field: 'registrationNumber', value: input.registrationNumber, message: 'Энэ регистрийн дугаар бүртгэгдсэн байна.' },
    { field: 'email', value: input.email, message: 'Энэ имэйл бүртгэгдсэн байна.' },
    { field: 'icCardNumber', value: input.icCardNumber, message: 'Энэ IC картын дугаар бүртгэгдсэн байна.' },
    { field: 'attendanceNumber', value: input.attendanceNumber, message: 'Энэ цаг бүртгэлийн дугаар бүртгэгдсэн байна.' },
  ];

  for (const check of checks) {
    if (!check.value) continue;

    const filter: FilterQuery<IEmployee> = { [check.field]: check.value };
    if (excludeEmployeeId) {
      filter._id = { $ne: new Types.ObjectId(excludeEmployeeId) };
    }

    const clash = await Employee.findOne(filter).select('_id');
    if (clash) {
      throw AppError.conflict(ERROR_CODES.DUPLICATE_KEY, check.message);
    }
  }
}

function toObjectIdOrNull(value: string | null | undefined): Types.ObjectId | null {
  return value ? new Types.ObjectId(value) : null;
}

/** Maps validated input onto the Mongoose document shape. */
function assignEmployeeFields(
  target: Partial<IEmployee>,
  input: Partial<CreateEmployeeInput>,
): void {
  const direct = [
    'firstName', 'lastName', 'workLocation', 'icCardNumber', 'attendanceNumber',
    'birthProvince', 'birthDistrict', 'currentAddress', 'residentialAddress',
    'emergencyContactName', 'emergencyContactRelation', 'emergencyContactPhone',
    'terminationReason',
  ] as const;
  for (const key of direct) {
    if (input[key] !== undefined) {
      (target as Record<string, unknown>)[key] = input[key] ?? null;
    }
  }

  const enums = [
    'gender', 'employeeType', 'status', 'qualificationLevel', 'safetyGrade', 'maritalStatus',
  ] as const;
  for (const key of enums) {
    if (input[key] !== undefined) {
      (target as Record<string, unknown>)[key] = input[key] ?? null;
    }
  }

  const numbers = ['mealDiscountPercent', 'dailyMealCount', 'familySize'] as const;
  for (const key of numbers) {
    if (input[key] !== undefined) {
      (target as Record<string, unknown>)[key] = input[key] ?? null;
    }
  }

  const booleans = ['hasDriverLicense', 'gpsVerificationEnabled', 'mealConfigEnabled'] as const;
  for (const key of booleans) {
    if (input[key] !== undefined) {
      (target as Record<string, unknown>)[key] = input[key];
    }
  }

  const arrays = ['skills', 'permittedJobTypes'] as const;
  for (const key of arrays) {
    if (input[key] !== undefined) {
      (target as Record<string, unknown>)[key] = input[key] ?? [];
    }
  }

  if (input.employeeCode !== undefined) target.employeeCode = input.employeeCode.toUpperCase();
  if (input.registrationNumber !== undefined) target.registrationNumber = input.registrationNumber ?? null;
  if (input.email !== undefined) target.email = input.email ?? null;
  if (input.phone !== undefined) target.phone = input.phone ?? null;

  if (input.birthDate !== undefined) target.birthDate = toDate(input.birthDate);
  if (input.employmentStartDate !== undefined) {
    target.employmentStartDate = toDate(input.employmentStartDate);
  }
  if (input.terminationDate !== undefined) target.terminationDate = toDate(input.terminationDate);

  if (input.companyId !== undefined) target.company = toObjectIdOrNull(input.companyId);
  if (input.departmentId !== undefined) target.department = toObjectIdOrNull(input.departmentId);
  if (input.positionId !== undefined) target.position = toObjectIdOrNull(input.positionId);
  if (input.teamId !== undefined) target.team = toObjectIdOrNull(input.teamId);
  if (input.directManagerId !== undefined) {
    target.directManager = toObjectIdOrNull(input.directManagerId);
  }

  if (input.education !== undefined) {
    target.education = input.education.map((entry) => ({
      _id: new Types.ObjectId(),
      level: entry.level,
      school: entry.school,
      major: entry.major ?? null,
      startDate: toDate(entry.startDate),
      endDate: toDate(entry.endDate),
      diplomaNumber: entry.diplomaNumber ?? null,
    }));
  }

  if (input.workHistory !== undefined) {
    target.workHistory = input.workHistory.map((entry) => ({
      _id: new Types.ObjectId(),
      organization: entry.organization,
      position: entry.position,
      startDate: toDate(entry.startDate),
      endDate: toDate(entry.endDate),
      leaveReason: entry.leaveReason ?? null,
    }));
  }

  if (input.certificates !== undefined) {
    target.certificates = input.certificates.map((entry) => ({
      _id: new Types.ObjectId(),
      name: entry.name,
      certificateNumber: entry.certificateNumber ?? null,
      issuedDate: toDate(entry.issuedDate),
      expiryDate: toDate(entry.expiryDate),
      document: toObjectIdOrNull(entry.documentId),
    }));
  }
}

// -- Create ------------------------------------------------------------------

export async function createEmployee(
  input: CreateEmployeeInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<EmployeeDetailDto> {
  await assertUniqueIdentifiers(input);
  await validateOrgRelationships({
    companyId: input.companyId,
    departmentId: input.departmentId,
    positionId: input.positionId,
    teamId: input.teamId,
    directManagerId: input.directManagerId,
  });

  const draft: Partial<IEmployee> = {
    createdBy: new Types.ObjectId(actor.userId),
    updatedBy: new Types.ObjectId(actor.userId),
  };
  assignEmployeeFields(draft, input);

  const employee = await Employee.create(draft);

  await EmployeeStatusHistory.create({
    employee: employee._id,
    fromStatus: null,
    toStatus: employee.status,
    reason: 'Ажилтан бүртгэгдсэн',
    changedBy: new Types.ObjectId(actor.userId),
    changedByName: actor.fullName,
  });

  await recordAudit({
    entityType: 'Employee',
    entityId: employee._id,
    action: 'Created',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    newValue: {
      employeeCode: employee.employeeCode,
      firstName: employee.firstName,
      lastName: employee.lastName,
      status: employee.status,
    },
  });

  return getEmployeeById(String(employee._id), actor);
}

// -- Update ------------------------------------------------------------------

/** Fields whose change is individually audited, per the Phase 1 audit requirements. */
const AUDITED_RELATION_FIELDS: Array<[keyof IEmployee, string]> = [
  ['company', 'company changed'],
  ['department', 'department changed'],
  ['position', 'position changed'],
  ['team', 'team changed'],
  ['directManager', 'manager changed'],
];

export async function updateEmployee(
  employeeId: string,
  input: UpdateEmployeeInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<EmployeeDetailDto> {
  const employee = await Employee.findById(employeeId);
  if (!employee) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Ажилтан олдсонгүй.');
  }

  await assertUniqueIdentifiers(input, employeeId);

  // Merge the incoming selection over the stored one so a partial update is validated
  // against the state it will actually produce, not against the fields sent alone.
  await validateOrgRelationships(
    {
      companyId:
        input.companyId !== undefined
          ? input.companyId
          : employee.company
            ? String(employee.company)
            : null,
      departmentId:
        input.departmentId !== undefined
          ? input.departmentId
          : employee.department
            ? String(employee.department)
            : null,
      positionId:
        input.positionId !== undefined
          ? input.positionId
          : employee.position
            ? String(employee.position)
            : null,
      teamId: input.teamId !== undefined ? input.teamId : employee.team ? String(employee.team) : null,
      directManagerId:
        input.directManagerId !== undefined
          ? input.directManagerId
          : employee.directManager
            ? String(employee.directManager)
            : null,
    },
    employeeId,
  );

  const before = employee.toObject();
  const previousStatus = employee.status;

  assignEmployeeFields(employee, input);
  employee.updatedBy = new Types.ObjectId(actor.userId);
  await employee.save();

  const changedFields = Object.keys(input).filter((key) => input[key as keyof UpdateEmployeeInput] !== undefined);

  await recordAudit({
    entityType: 'Employee',
    entityId: employee._id,
    action: 'Updated',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    oldValue: { changedFields, employeeCode: before.employeeCode },
    newValue: { changedFields },
  });

  // Relationship changes get their own audit rows so an org-change report can be
  // produced without diffing every generic Updated entry.
  for (const [field, label] of AUDITED_RELATION_FIELDS) {
    const oldValue = before[field] ? String(before[field]) : null;
    const newValue = employee[field] ? String(employee[field]) : null;
    if (oldValue !== newValue) {
      await recordAudit({
        entityType: 'Employee',
        entityId: employee._id,
        action: 'Updated',
        actor: { id: actor.userId, role: actor.role, label: actor.fullName },
        meta,
        reason: label,
        oldValue: { [field]: oldValue },
        newValue: { [field]: newValue },
      });
    }
  }

  if (input.status !== undefined && input.status !== previousStatus) {
    await EmployeeStatusHistory.create({
      employee: employee._id,
      fromStatus: previousStatus,
      toStatus: employee.status,
      reason: 'Ажилтны мэдээлэл засварласан',
      changedBy: new Types.ObjectId(actor.userId),
      changedByName: actor.fullName,
    });
  }

  return getEmployeeById(employeeId, actor);
}

// -- Status ------------------------------------------------------------------

export async function changeEmployeeStatus(
  employeeId: string,
  input: ChangeEmployeeStatusInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<EmployeeDetailDto> {
  const employee = await Employee.findById(employeeId);
  if (!employee) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Ажилтан олдсонгүй.');
  }

  const previousStatus = employee.status;
  if (previousStatus === input.status) {
    throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Ажилтан аль хэдийн энэ төлөвт байна.');
  }

  // Becoming ACTIVE requires the full organisational record. The shared schema cannot
  // check this on a status-only payload, so it is enforced here against stored state.
  if (input.status === 'ACTIVE') {
    const missing: Array<{ field: string; message: string }> = [];
    if (!employee.company) missing.push({ field: 'companyId', message: 'Компани заавал.' });
    if (!employee.department) missing.push({ field: 'departmentId', message: 'Харьяалагдах алба заавал.' });
    if (!employee.position) missing.push({ field: 'positionId', message: 'Албан тушаал заавал.' });
    if (!employee.employeeType) missing.push({ field: 'employeeType', message: 'Ажилтны төрөл заавал.' });
    if (!employee.employmentStartDate) {
      missing.push({ field: 'employmentStartDate', message: 'Ажиллаж эхэлсэн огноо заавал.' });
    }
    if (missing.length > 0) {
      throw AppError.badRequest(
        ERROR_CODES.VALIDATION_ERROR,
        'Идэвхтэй болгохын тулд байгууллагын мэдээллийг бүрэн бөглөнө үү.',
        missing,
      );
    }
  }

  if (input.status === 'TERMINATED') {
    const terminationDate = toDate(input.terminationDate);
    if (!terminationDate) {
      throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Ажлаас гарсан огноо заавал.', [
        { field: 'terminationDate', message: 'Ажлаас гарсан огноо заавал.' },
      ]);
    }
    if (
      employee.employmentStartDate &&
      terminationDate.getTime() < employee.employmentStartDate.getTime()
    ) {
      throw AppError.badRequest(
        ERROR_CODES.VALIDATION_ERROR,
        'Ажлаас гарсан огноо ажилд орсон огнооноос өмнө байж болохгүй.',
        [{ field: 'terminationDate', message: 'Огноо ажилд орсон огнооноос өмнө байна.' }],
      );
    }
    employee.terminationDate = terminationDate;
    employee.terminationReason = input.terminationReason ?? null;
  }

  employee.status = input.status;
  employee.updatedBy = new Types.ObjectId(actor.userId);
  await employee.save();

  await EmployeeStatusHistory.create({
    employee: employee._id,
    fromStatus: previousStatus,
    toStatus: input.status,
    reason: input.reason ?? null,
    changedBy: new Types.ObjectId(actor.userId),
    changedByName: actor.fullName,
  });

  await recordAudit({
    entityType: 'Employee',
    entityId: employee._id,
    action: 'StatusChanged',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    reason: input.reason ?? null,
    oldValue: { status: previousStatus },
    newValue: { status: input.status },
  });

  return getEmployeeById(employeeId, actor);
}

// -- Read --------------------------------------------------------------------

export async function listEmployees(
  query: EmployeeListQueryInput,
): Promise<PaginatedData<EmployeeListItemDto>> {
  const filter: FilterQuery<IEmployee> = {};

  if (query.companyId) filter.company = new Types.ObjectId(query.companyId);
  if (query.departmentId) filter.department = new Types.ObjectId(query.departmentId);
  if (query.positionId) filter.position = new Types.ObjectId(query.positionId);
  if (query.teamId) filter.team = new Types.ObjectId(query.teamId);
  if (query.employeeType) filter.employeeType = query.employeeType;
  if (query.status) filter.status = query.status;
  if (query.isActive !== undefined) {
    filter.status = query.isActive ? 'ACTIVE' : { $ne: 'ACTIVE' };
  }

  const fieldSearches: Array<[keyof EmployeeListQueryInput, string]> = [
    ['firstName', 'firstName'],
    ['lastName', 'lastName'],
    ['employeeCode', 'employeeCode'],
    ['registrationNumber', 'registrationNumber'],
    ['email', 'email'],
    ['phone', 'phone'],
    ['icCardNumber', 'icCardNumber'],
  ];
  for (const [queryKey, field] of fieldSearches) {
    const value = query[queryKey];
    if (typeof value === 'string' && value.length > 0) {
      filter[field] = new RegExp(escapeRegex(value), 'i');
    }
  }

  if (query.search) {
    const pattern = new RegExp(escapeRegex(query.search), 'i');
    filter.$or = [
      { firstName: pattern },
      { lastName: pattern },
      { employeeCode: pattern },
      { registrationNumber: pattern },
      { email: pattern },
      { phone: pattern },
      { icCardNumber: pattern },
    ];
  }

  if (query.startDateFrom || query.startDateTo) {
    const range: Record<string, Date> = {};
    if (query.startDateFrom) range.$gte = new Date(query.startDateFrom);
    if (query.startDateTo) range.$lte = new Date(query.startDateTo);
    filter.employmentStartDate = range;
  }

  const skip = (query.page - 1) * query.limit;
  const sort: Record<string, 1 | -1> = { [query.sortBy]: query.sortDir === 'asc' ? 1 : -1 };

  const [items, total] = await Promise.all([
    // `CREATOR_POPULATE` is added here rather than to `ORG_POPULATE`, which the detail and
    // self endpoints also use: only the directory row renders a creator.
    Employee.find(filter)
      .populate([...ORG_POPULATE, CREATOR_POPULATE])
      .sort(sort)
      .skip(skip)
      .limit(query.limit),
    Employee.countDocuments(filter),
  ]);

  return {
    items: items.map((item) => toEmployeeListItemDto(item)),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}

/**
 * The signed-in account's own employee record.
 *
 * TAKES NO IDENTIFIER. The only input is `actor.employeeId`, which the authenticate
 * middleware derives from `Employee.systemUser` on every request. There is no parameter a
 * caller could aim at somebody else, so the endpoint is safe to expose to any authenticated
 * account without a permission of its own — see the route comment for that argument.
 *
 * Fails closed on every ambiguity: no link, a link to a record that has since been deleted,
 * or a link the record no longer agrees with all produce the same 404. An employee-facing
 * account whose link is missing gets a clear instruction to contact an administrator rather
 * than a silently wrong profile, which is what the directory-search workaround produced.
 *
 * The three refusals are deliberately INDISTINGUISHABLE TO THE CLIENT and must stay that way:
 * the Flutter app maps 404 to `notLinked` and `employee-self.api.test.ts` pins the status and
 * the message. They are told apart in the SERVER LOG instead, because the overwhelmingly
 * common cause is a database whose accounts were never linked to employee cards — which reads
 * on the device as a broken app and in the log as nothing at all unless the reason is spelled
 * out. Each branch therefore names what is missing and the admin action that fixes it.
 */
export async function getMyEmployeeRecord(actor: AuthContext): Promise<EmployeeSelfDto> {
  if (!actor.employeeId) {
    logger.warn(
      { userId: actor.userId, email: actor.email, role: actor.role },
      'GET /employees/me: no Employee has systemUser set to this user id, so the account is ' +
        'not linked to an employee card. Link it with ' +
        "POST /employees/:employeeId/system-access {mode:'LINK_EXISTING', userId}, or run " +
        'npm run seed:dev --workspace @monhorus/backend to provision linked dev technicians.',
    );
    throw AppError.notFound(
      ERROR_CODES.NOT_FOUND,
      'Таны бүртгэл ажилтны картад холбогдоогүй байна. Системийн админд хандана уу.',
    );
  }

  const employee = await Employee.findById(actor.employeeId).populate([...ORG_POPULATE]);
  if (!employee) {
    // The middleware found the link a moment ago, so this is a record deleted mid-request.
    logger.warn(
      { userId: actor.userId, employeeId: actor.employeeId },
      'GET /employees/me: the Employee this user was linked to no longer exists. Re-link the ' +
        "account with POST /employees/:employeeId/system-access {mode:'LINK_EXISTING', userId}.",
    );
    throw AppError.notFound(
      ERROR_CODES.NOT_FOUND,
      'Таны бүртгэл ажилтны картад холбогдоогүй байна. Системийн админд хандана уу.',
    );
  }

  // Defence in depth. `actor.employeeId` can only have come from a query keyed on this
  // account, so this cannot currently fail; it is asserted anyway so that any future change
  // which lets an employee id reach the AuthContext from somewhere else fails closed here
  // rather than serving one employee's record to another.
  if (String(employee.systemUser ?? '') !== actor.userId) {
    logger.error(
      {
        userId: actor.userId,
        employeeId: actor.employeeId,
        employeeSystemUser: String(employee.systemUser ?? ''),
      },
      'GET /employees/me: the resolved employee does not agree that it belongs to this user. ' +
        'An employee id reached the AuthContext from somewhere other than the systemUser ' +
        'lookup in authenticate.middleware; this is a code defect, not a data one.',
    );
    throw AppError.notFound(
      ERROR_CODES.NOT_FOUND,
      'Таны бүртгэл ажилтны картад холбогдоогүй байна. Системийн админд хандана уу.',
    );
  }

  return toEmployeeSelfDto(employee, await getEmployeeWorkload(employee._id));
}

export async function getEmployeeById(
  employeeId: string,
  actor: AuthContext,
): Promise<EmployeeDetailDto> {
  const employee = await Employee.findById(employeeId).populate([...ORG_POPULATE]);
  if (!employee) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Ажилтан олдсонгүй.');
  }

  const canViewSalary = hasPermission(actor, PERMISSIONS.EMPLOYEE_VIEW_SALARY);

  const [documents, statusHistory, currentSalary, directManager, systemAccess, workload] =
    await Promise.all([
    EmployeeDocument.find({ employee: employee._id })
      .populate({ path: 'file', select: 'mimeType sizeBytes' })
      .sort({ createdAt: -1 }),
    EmployeeStatusHistory.find({ employee: employee._id }).sort({ createdAt: -1 }).limit(50),
    // Salary is only read when permitted; the query is skipped entirely otherwise.
    canViewSalary
      ? EmployeeSalary.findOne({ employee: employee._id, effectiveTo: null })
      : Promise.resolve(undefined),
    employee.directManager ? Employee.findById(employee.directManager) : Promise.resolve(null),
    // Built by the access service so the detail payload and every lifecycle response
    // describe the account in exactly the same shape.
    buildSystemAccessDto(employee.systemUser, actor),
    getEmployeeWorkload(employee._id),
  ]);

  return toEmployeeDetailDto({
    employee,
    documents,
    statusHistory,
    currentSalary: canViewSalary ? (currentSalary ?? null) : undefined,
    directManager,
    systemAccess,
    workload,
  });
}

// -- Salary ------------------------------------------------------------------

export async function listSalaryHistory(employeeId: string): Promise<EmployeeSalaryDto[]> {
  const rows = await EmployeeSalary.find({ employee: new Types.ObjectId(employeeId) }).sort({
    effectiveFrom: -1,
  });
  return rows.map(toSalaryDto);
}

/**
 * Records a new salary period.
 *
 * History is never overwritten. The currently open period is closed one day before
 * the new period starts, and a fresh row is inserted, so payroll can reconstruct the
 * figure that applied on any historical date.
 */
export async function upsertSalary(
  employeeId: string,
  input: EmployeeSalaryInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<EmployeeSalaryDto> {
  const employee = await Employee.findById(employeeId).select('_id employeeCode');
  if (!employee) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Ажилтан олдсонгүй.');
  }

  const effectiveFrom = new Date(input.effectiveFrom);
  const current = await EmployeeSalary.findOne({ employee: employee._id, effectiveTo: null });

  if (current) {
    if (effectiveFrom.getTime() <= current.effectiveFrom.getTime()) {
      throw AppError.badRequest(
        ERROR_CODES.VALIDATION_ERROR,
        'Шинэ цалингийн хугацаа одоогийн хугацаанаас хойш эхлэх ёстой.',
        [
          {
            field: 'effectiveFrom',
            message: `Одоогийн хүчинтэй огноо: ${current.effectiveFrom.toISOString().slice(0, 10)}`,
          },
        ],
      );
    }

    // Close the open period the day before the new one begins.
    const closedAt = new Date(effectiveFrom.getTime() - 24 * 60 * 60 * 1000);
    current.effectiveTo = closedAt;
    await current.save();
  }

  const created = await EmployeeSalary.create({
    employee: employee._id,
    grade: input.grade ?? null,
    baseSalary: input.baseSalary,
    currency: input.currency,
    calculationType: input.calculationType,
    bankName: input.bankName ?? null,
    bankAccountName: input.bankAccountName ?? null,
    bankAccountNumber: input.bankAccountNumber ?? null,
    socialInsurance: input.socialInsurance,
    personalIncomeTax: input.personalIncomeTax,
    transportAllowance: input.transportAllowance,
    mealAllowance: input.mealAllowance,
    phoneAllowance: input.phoneAllowance,
    otherAllowance: input.otherAllowance,
    effectiveFrom,
    effectiveTo: toDate(input.effectiveTo),
    createdBy: new Types.ObjectId(actor.userId),
  });

  // Amounts are deliberately not written into the audit payload: audit rows are
  // readable by audit.view holders, who do not necessarily hold employee.view_salary.
  await recordAudit({
    entityType: 'Employee',
    entityId: employee._id,
    action: 'Updated',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    reason: 'salary changed',
    oldValue: current ? { effectiveFrom: current.effectiveFrom.toISOString() } : null,
    newValue: { effectiveFrom: created.effectiveFrom.toISOString() },
  });

  return toSalaryDto(created);
}
