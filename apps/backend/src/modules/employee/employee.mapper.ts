import type {
  EmployeeCertificateDto,
  EmployeeDetailDto,
  EmployeeDocumentDto,
  EmployeeEducationDto,
  EmployeeListItemDto,
  EmployeeRefDto,
  EmployeeSalaryDto,
  EmployeeStatusHistoryDto,
  EmployeeType,
  EmployeeStatus,
  EmployeeWorkHistoryDto,
  EmployeeWorkloadDto,
  QualificationLevel,
} from '@monhorus/shared';
import type { Types } from 'mongoose';

import type { IEmployeeDocument } from './employee-document.model';
import type { IEmployeeSalary } from './employee-salary.model';
import type { IEmployeeStatusHistory } from './employee-status-history.model';
import type { IEmployee } from './employee.model';

type WithId<T> = T & { _id: Types.ObjectId };
type NamedRef = { _id: Types.ObjectId; name: string } | null | undefined;

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function ref(value: NamedRef): { id: string; name: string } | null {
  if (!value || !value.name) return null;
  return { id: String(value._id), name: value.name };
}

function photoUrlOf(employee: WithId<IEmployee>): string | null {
  return employee.photoDocument ? `/api/v1/files/${String(employee.photoDocument)}` : null;
}

export function toEmployeeRefDto(employee: WithId<IEmployee>): EmployeeRefDto {
  return {
    id: String(employee._id),
    employeeCode: employee.employeeCode,
    firstName: employee.firstName,
    lastName: employee.lastName,
    photoUrl: photoUrlOf(employee),
  };
}

export function toEmployeeListItemDto(
  employee: WithId<IEmployee>,
): EmployeeListItemDto {
  return {
    id: String(employee._id),
    employeeCode: employee.employeeCode,
    firstName: employee.firstName,
    lastName: employee.lastName,
    registrationNumber: employee.registrationNumber,
    email: employee.email,
    phone: employee.phone,
    photoUrl: photoUrlOf(employee),
    company: ref(employee.company as unknown as NamedRef),
    department: ref(employee.department as unknown as NamedRef),
    position: ref(employee.position as unknown as NamedRef),
    team: ref(employee.team as unknown as NamedRef),
    employeeType: employee.employeeType,
    status: employee.status,
    employmentStartDate: iso(employee.employmentStartDate),
    hasSystemAccess: employee.systemUser !== null,
    isActive: employee.status === 'ACTIVE',
  };
}

/**
 * The signed-in employee's own record, as returned by `GET /employees/me`.
 *
 * WHY A THIRD EMPLOYEE SHAPE
 *
 * Neither existing DTO fits. `EmployeeDetailDto` carries the whole HR file — registration
 * number, birth data, home and residential addresses, marital status and family size,
 * emergency contacts, education, previous employers, uploaded documents, status history and
 * (for a privileged reader) salary. `EmployeeListItemDto` is a directory row: it exists to
 * describe someone ELSE and still carries the registration number, which is the field that
 * made the old "search the directory for myself" workaround a data leak.
 *
 * So this is an explicit allowlist rather than a subtraction. Adding a sensitive field to
 * the employee model cannot leak through this endpoint by default; it has to be written in
 * here deliberately.
 *
 * WHAT IS DELIBERATELY ABSENT, and why:
 *   - salary and bank details — a separate collection behind `employee.view_salary`, never
 *     joined here at all, so the endpoint cannot return them even by mistake;
 *   - documents (contracts, diplomas, scans) — `employee.manage_documents`;
 *   - status history — `employee.view_audit`;
 *   - emergency contacts, addresses, marital status, family size, birth date and place —
 *     personal data the profile screen does not render and the app has no use for;
 *   - registrationNumber (РД) — a national identifier. The holder already knows their own,
 *     so returning it buys nothing, while every copy of it in a mobile cache, a crash
 *     report or a proxy log is a liability;
 *   - the `systemAccess` block — account state, roles and permissions are `GET /auth/me`;
 *   - `directManager` — a second employee's identity, which is exactly what this endpoint
 *     exists to stop being reachable.
 */
export interface EmployeeSelfDto {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  /** Work contact only. Both are the caller's own, and the app shows them on Профайл. */
  email: string | null;
  phone: string | null;
  photoUrl: string | null;

  company: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  position: { id: string; name: string } | null;
  team: { id: string; name: string } | null;
  workLocation: string | null;
  employmentStartDate: string | null;
  employeeType: EmployeeType | null;
  status: EmployeeStatus;

  qualificationLevel: QualificationLevel | null;
  safetyGrade: string | null;
  skills: string[];
  permittedJobTypes: string[];
  hasDriverLicense: boolean;
  /**
   * Whether this employee's field actions must capture a GPS fix. Included because the
   * app has to know before it starts a job, not because the profile screen renders it.
   */
  gpsVerificationEnabled: boolean;

  /** The three counters the Нүүр tab scopes to one person. */
  workload: EmployeeWorkloadDto;
}

export function toEmployeeSelfDto(
  employee: WithId<IEmployee>,
  workload: EmployeeWorkloadDto,
): EmployeeSelfDto {
  return {
    id: String(employee._id),
    employeeCode: employee.employeeCode,
    firstName: employee.firstName,
    lastName: employee.lastName,
    email: employee.email,
    phone: employee.phone,
    photoUrl: photoUrlOf(employee),

    company: ref(employee.company as unknown as NamedRef),
    department: ref(employee.department as unknown as NamedRef),
    position: ref(employee.position as unknown as NamedRef),
    team: ref(employee.team as unknown as NamedRef),
    workLocation: employee.workLocation,
    employmentStartDate: iso(employee.employmentStartDate),
    employeeType: employee.employeeType,
    status: employee.status,

    qualificationLevel: employee.qualificationLevel,
    safetyGrade: employee.safetyGrade,
    skills: employee.skills,
    permittedJobTypes: employee.permittedJobTypes,
    hasDriverLicense: employee.hasDriverLicense,
    gpsVerificationEnabled: employee.gpsVerificationEnabled,

    workload,
  };
}

export function toEducationDto(entry: IEmployee['education'][number]): EmployeeEducationDto {
  return {
    id: String(entry._id),
    level: entry.level,
    school: entry.school,
    major: entry.major,
    startDate: iso(entry.startDate),
    endDate: iso(entry.endDate),
    diplomaNumber: entry.diplomaNumber,
  };
}

export function toWorkHistoryDto(
  entry: IEmployee['workHistory'][number],
): EmployeeWorkHistoryDto {
  return {
    id: String(entry._id),
    organization: entry.organization,
    position: entry.position,
    startDate: iso(entry.startDate),
    endDate: iso(entry.endDate),
    leaveReason: entry.leaveReason,
  };
}

export function toCertificateDto(
  entry: IEmployee['certificates'][number],
): EmployeeCertificateDto {
  return {
    id: String(entry._id),
    name: entry.name,
    certificateNumber: entry.certificateNumber,
    issuedDate: iso(entry.issuedDate),
    expiryDate: iso(entry.expiryDate),
    documentId: entry.document ? String(entry.document) : null,
  };
}

export function toEmployeeDocumentDto(
  doc: WithId<IEmployeeDocument>,
): EmployeeDocumentDto {
  const file = doc.file as unknown as
    | { _id: Types.ObjectId; mimeType: string; sizeBytes: number }
    | Types.ObjectId;
  const fileIsPopulated = typeof file === 'object' && 'mimeType' in file;

  return {
    id: String(doc._id),
    documentType: doc.documentType,
    name: doc.name,
    downloadUrl: `/api/v1/files/${String(fileIsPopulated ? file._id : file)}`,
    mimeType: fileIsPopulated ? file.mimeType : 'application/octet-stream',
    sizeBytes: fileIsPopulated ? file.sizeBytes : 0,
    issueDate: iso(doc.issueDate),
    expiryDate: iso(doc.expiryDate),
    notes: doc.notes,
    uploadedByName: doc.uploadedByName,
    uploadedAt: doc.createdAt.toISOString(),
    isExpired: doc.expiryDate ? doc.expiryDate.getTime() < Date.now() : false,
  };
}

export function toSalaryDto(salary: WithId<IEmployeeSalary>): EmployeeSalaryDto {
  return {
    id: String(salary._id),
    grade: salary.grade,
    baseSalary: salary.baseSalary,
    currency: salary.currency,
    calculationType: salary.calculationType,
    bankName: salary.bankName,
    bankAccountName: salary.bankAccountName,
    bankAccountNumber: salary.bankAccountNumber,
    socialInsurance: salary.socialInsurance,
    personalIncomeTax: salary.personalIncomeTax,
    transportAllowance: salary.transportAllowance,
    mealAllowance: salary.mealAllowance,
    phoneAllowance: salary.phoneAllowance,
    otherAllowance: salary.otherAllowance,
    effectiveFrom: salary.effectiveFrom.toISOString(),
    effectiveTo: iso(salary.effectiveTo),
    isCurrent: salary.effectiveTo === null,
    createdAt: salary.createdAt.toISOString(),
  };
}

export function toStatusHistoryDto(
  entry: WithId<IEmployeeStatusHistory>,
): EmployeeStatusHistoryDto {
  return {
    id: String(entry._id),
    fromStatus: entry.fromStatus,
    toStatus: entry.toStatus,
    reason: entry.reason,
    changedByName: entry.changedByName,
    changedAt: entry.createdAt.toISOString(),
  };
}

export interface EmployeeDetailSources {
  employee: WithId<IEmployee>;
  documents: Array<WithId<IEmployeeDocument>>;
  statusHistory: Array<WithId<IEmployeeStatusHistory>>;
  /** Undefined when the caller lacks employee.view_salary. */
  currentSalary: WithId<IEmployeeSalary> | null | undefined;
  systemAccess: EmployeeDetailDto['systemAccess'];
  workload: EmployeeDetailDto['workload'];
  directManager: WithId<IEmployee> | null;
}

export function toEmployeeDetailDto(sources: EmployeeDetailSources): EmployeeDetailDto {
  const { employee } = sources;

  return {
    id: String(employee._id),
    employeeCode: employee.employeeCode,

    firstName: employee.firstName,
    lastName: employee.lastName,
    registrationNumber: employee.registrationNumber,
    email: employee.email,
    phone: employee.phone,
    birthDate: iso(employee.birthDate),
    gender: employee.gender,
    photoUrl: photoUrlOf(employee),

    company: ref(employee.company as unknown as NamedRef),
    department: ref(employee.department as unknown as NamedRef),
    position: ref(employee.position as unknown as NamedRef),
    team: ref(employee.team as unknown as NamedRef),
    directManager: sources.directManager ? toEmployeeRefDto(sources.directManager) : null,
    workLocation: employee.workLocation,
    employmentStartDate: iso(employee.employmentStartDate),
    employeeType: employee.employeeType,
    status: employee.status,
    terminationDate: iso(employee.terminationDate),
    terminationReason: employee.terminationReason,

    icCardNumber: employee.icCardNumber,
    attendanceNumber: employee.attendanceNumber,
    skills: employee.skills,
    qualificationLevel: employee.qualificationLevel,
    safetyGrade: employee.safetyGrade,
    permittedJobTypes: employee.permittedJobTypes,
    hasDriverLicense: employee.hasDriverLicense,
    gpsVerificationEnabled: employee.gpsVerificationEnabled,

    mealDiscountPercent: employee.mealDiscountPercent,
    dailyMealCount: employee.dailyMealCount,
    mealConfigEnabled: employee.mealConfigEnabled,

    birthProvince: employee.birthProvince,
    birthDistrict: employee.birthDistrict,
    currentAddress: employee.currentAddress,
    residentialAddress: employee.residentialAddress,
    maritalStatus: employee.maritalStatus,
    familySize: employee.familySize,
    emergencyContactName: employee.emergencyContactName,
    emergencyContactRelation: employee.emergencyContactRelation,
    emergencyContactPhone: employee.emergencyContactPhone,

    education: employee.education.map(toEducationDto),
    workHistory: employee.workHistory.map(toWorkHistoryDto),
    certificates: employee.certificates.map(toCertificateDto),
    documents: sources.documents.map(toEmployeeDocumentDto),

    // Key omitted entirely, not nulled, when the caller cannot view salary.
    ...(sources.currentSalary === undefined
      ? {}
      : { currentSalary: sources.currentSalary ? toSalaryDto(sources.currentSalary) : null }),

    systemAccess: sources.systemAccess,
    workload: sources.workload,
    statusHistory: sources.statusHistory.map(toStatusHistoryDto),

    createdAt: employee.createdAt.toISOString(),
    updatedAt: employee.updatedAt.toISOString(),
  };
}
