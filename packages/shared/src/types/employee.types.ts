import type {
  Currency,
  EducationLevel,
  EmployeeDocumentType,
  EmployeeStatus,
  EmployeeType,
  Gender,
  MaritalStatus,
  QualificationLevel,
  SafetyGrade,
  SalaryCalculationType,
} from '../constants/employee';
import type { AccountStatus, UserRole } from '../constants/roles';

export interface EmployeeRefDto {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
}

/** Row shape for the employee list. Deliberately narrower than the detail DTO. */
export interface EmployeeListItemDto {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  registrationNumber: string | null;
  email: string | null;
  phone: string | null;
  photoUrl: string | null;
  company: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  position: { id: string; name: string } | null;
  team: { id: string; name: string } | null;
  employeeType: EmployeeType | null;
  status: EmployeeStatus;
  employmentStartDate: string | null;
  hasSystemAccess: boolean;
  isActive: boolean;
}

export interface EmployeeEducationDto {
  id: string;
  level: EducationLevel;
  school: string;
  major: string | null;
  startDate: string | null;
  endDate: string | null;
  diplomaNumber: string | null;
}

export interface EmployeeWorkHistoryDto {
  id: string;
  organization: string;
  position: string;
  startDate: string | null;
  endDate: string | null;
  leaveReason: string | null;
}

export interface EmployeeCertificateDto {
  id: string;
  name: string;
  certificateNumber: string | null;
  issuedDate: string | null;
  expiryDate: string | null;
  documentId: string | null;
}

export interface EmployeeDocumentDto {
  id: string;
  documentType: EmployeeDocumentType;
  name: string;
  /** Authenticated download route. Never a server file-system path. */
  downloadUrl: string;
  mimeType: string;
  sizeBytes: number;
  issueDate: string | null;
  expiryDate: string | null;
  notes: string | null;
  uploadedByName: string | null;
  uploadedAt: string;
  isExpired: boolean;
}

/**
 * Salary record. Only ever returned to a holder of employee.view_salary; the
 * backend omits the whole field rather than sending a masked object.
 */
export interface EmployeeSalaryDto {
  id: string;
  grade: string | null;
  baseSalary: number;
  currency: Currency;
  calculationType: SalaryCalculationType;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  socialInsurance: boolean;
  personalIncomeTax: boolean;
  transportAllowance: number;
  mealAllowance: number;
  phoneAllowance: number;
  otherAllowance: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  isCurrent: boolean;
  createdAt: string;
}

export interface EmployeeStatusHistoryDto {
  id: string;
  fromStatus: EmployeeStatus | null;
  toStatus: EmployeeStatus;
  reason: string | null;
  changedByName: string | null;
  changedAt: string;
}

/** Assigned role, resolved to its name so the UI needs no second lookup. */
export interface EmployeeAccessRoleDto {
  id: string;
  key: string;
  name: string;
}

export interface EmployeeSystemAccessDto {
  hasAccount: boolean;
  userId: string | null;
  /** Login identity. Null when the employee has no account. */
  email: string | null;
  fullName: string | null;
  role: UserRole | null;
  roleIds: string[];
  roles: EmployeeAccessRoleDto[];
  accountStatus: AccountStatus | null;
  lastLoginAt: string | null;
  /**
   * Whether the linked account belongs to the caller. The server refuses every
   * lifecycle action in that case, so the UI hides the controls rather than
   * offering a button that can only fail.
   */
  isSelf: boolean;
}

export interface EmployeeWorkloadDto {
  activeAssignments: number;
  completedAssignments: number;
  openServiceRequests: number;
}

export interface EmployeeDetailDto {
  id: string;
  employeeCode: string;

  firstName: string;
  lastName: string;
  registrationNumber: string | null;
  email: string | null;
  phone: string | null;
  birthDate: string | null;
  gender: Gender | null;
  photoUrl: string | null;

  company: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  position: { id: string; name: string } | null;
  team: { id: string; name: string } | null;
  directManager: EmployeeRefDto | null;
  workLocation: string | null;
  employmentStartDate: string | null;
  employeeType: EmployeeType | null;
  status: EmployeeStatus;
  terminationDate: string | null;
  terminationReason: string | null;

  icCardNumber: string | null;
  attendanceNumber: string | null;
  skills: string[];
  qualificationLevel: QualificationLevel | null;
  safetyGrade: SafetyGrade | null;
  permittedJobTypes: string[];
  hasDriverLicense: boolean;
  gpsVerificationEnabled: boolean;

  mealDiscountPercent: number | null;
  dailyMealCount: number | null;
  mealConfigEnabled: boolean;

  birthProvince: string | null;
  birthDistrict: string | null;
  currentAddress: string | null;
  residentialAddress: string | null;
  maritalStatus: MaritalStatus | null;
  familySize: number | null;
  emergencyContactName: string | null;
  emergencyContactRelation: string | null;
  emergencyContactPhone: string | null;

  education: EmployeeEducationDto[];
  workHistory: EmployeeWorkHistoryDto[];
  certificates: EmployeeCertificateDto[];
  documents: EmployeeDocumentDto[];

  /** Present only when the caller holds employee.view_salary. */
  currentSalary?: EmployeeSalaryDto | null;

  systemAccess: EmployeeSystemAccessDto;
  workload: EmployeeWorkloadDto;
  statusHistory: EmployeeStatusHistoryDto[];

  createdAt: string;
  updatedAt: string;
}

export interface EmployeeListQuery {
  page?: number;
  limit?: number;
  search?: string;
  firstName?: string;
  lastName?: string;
  employeeCode?: string;
  registrationNumber?: string;
  email?: string;
  phone?: string;
  icCardNumber?: string;
  companyId?: string;
  departmentId?: string;
  positionId?: string;
  teamId?: string;
  employeeType?: EmployeeType;
  status?: EmployeeStatus;
  isActive?: boolean;
  startDateFrom?: string;
  startDateTo?: string;
  sortBy?: 'employeeCode' | 'firstName' | 'lastName' | 'employmentStartDate' | 'createdAt';
  sortDir?: 'asc' | 'desc';
}

export interface ChangeEmployeeStatusRequest {
  status: EmployeeStatus;
  reason?: string;
  terminationDate?: string;
  terminationReason?: string;
}

export interface LinkSystemAccessRequest {
  mode: 'LINK_EXISTING' | 'CREATE_NEW' | 'DEACTIVATE';
  userId?: string;
  email?: string;
  password?: string;
  role?: UserRole;
  roleIds?: string[];
}

export interface UpdateSystemAccessRolesRequest {
  roleIds: string[];
  reason?: string;
}

/** Body of the suspend, restore and revoke actions. */
export interface SystemAccessActionRequest {
  reason?: string;
}

export interface EmployeeCertificatePayloadDto {
  employeeCode: string;
  fullName: string;
  registrationNumber: string | null;
  companyName: string | null;
  departmentName: string | null;
  positionName: string | null;
  employmentStartDate: string | null;
  status: EmployeeStatus;
  generatedAt: string;
  generatedByName: string;
}

/** Dispatch-facing projection. Dispatch never queries the employee table directly. */
export interface DispatchCandidateDto {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  team: { id: string; name: string } | null;
  workLocation: string | null;
  skills: string[];
  qualificationLevel: QualificationLevel | null;
  safetyGrade: SafetyGrade | null;
  permittedJobTypes: string[];
  activeAssignments: number;
  isAvailable: boolean;
}
