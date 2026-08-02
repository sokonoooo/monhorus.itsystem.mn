/**
 * Employee domain vocabulary.
 *
 * Statuses are taken verbatim from the Phase 1 specification. Requirements section
 * 14.1 defines work statuses, not employee lifecycle statuses, so there was no
 * pre-existing enum to reuse.
 */
export const EMPLOYEE_STATUSES = [
  'DRAFT',
  'ACTIVE',
  'ON_LEAVE',
  'SUSPENDED',
  'TERMINATED',
  'INACTIVE',
] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

export const EMPLOYEE_STATUS_LABELS: Record<EmployeeStatus, string> = {
  DRAFT: 'Ноорог',
  ACTIVE: 'Идэвхтэй',
  ON_LEAVE: 'Чөлөөтэй',
  SUSPENDED: 'Түр түдгэлзсэн',
  TERMINATED: 'Ажлаас гарсан',
  INACTIVE: 'Идэвхгүй',
};

/** Statuses that permit new work assignment. Enforced by the backend, not the UI. */
export const ASSIGNABLE_EMPLOYEE_STATUSES: readonly EmployeeStatus[] = ['ACTIVE'];

export function isAssignableStatus(status: EmployeeStatus): boolean {
  return ASSIGNABLE_EMPLOYEE_STATUSES.includes(status);
}

/** Organisational fields that must be present before an employee may become ACTIVE. */
export const ACTIVE_REQUIRED_FIELDS = [
  'company',
  'department',
  'position',
  'employeeType',
  'employmentStartDate',
] as const;

export const EMPLOYEE_TYPES = [
  'FULL_TIME',
  'PART_TIME',
  'CONTRACT',
  'TEMPORARY',
  'INTERN',
] as const;
export type EmployeeType = (typeof EMPLOYEE_TYPES)[number];

export const EMPLOYEE_TYPE_LABELS: Record<EmployeeType, string> = {
  FULL_TIME: 'Үндсэн ажилтан',
  PART_TIME: 'Цагийн ажилтан',
  CONTRACT: 'Гэрээт ажилтан',
  TEMPORARY: 'Түр ажилтан',
  INTERN: 'Дадлагажигч',
};

export const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;
export type Gender = (typeof GENDERS)[number];

export const GENDER_LABELS: Record<Gender, string> = {
  MALE: 'Эрэгтэй',
  FEMALE: 'Эмэгтэй',
  OTHER: 'Бусад',
};

export const MARITAL_STATUSES = ['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED'] as const;
export type MaritalStatus = (typeof MARITAL_STATUSES)[number];

export const MARITAL_STATUS_LABELS: Record<MaritalStatus, string> = {
  SINGLE: 'Гэрлээгүй',
  MARRIED: 'Гэрлэсэн',
  DIVORCED: 'Салсан',
  WIDOWED: 'Бэлэвсэн',
};

export const EDUCATION_LEVELS = [
  'SECONDARY',
  'VOCATIONAL',
  'DIPLOMA',
  'BACHELOR',
  'MASTER',
  'DOCTORATE',
] as const;
export type EducationLevel = (typeof EDUCATION_LEVELS)[number];

export const EDUCATION_LEVEL_LABELS: Record<EducationLevel, string> = {
  SECONDARY: 'Бүрэн дунд',
  VOCATIONAL: 'Мэргэжлийн сургалт',
  DIPLOMA: 'Дипломын боловсрол',
  BACHELOR: 'Бакалавр',
  MASTER: 'Магистр',
  DOCTORATE: 'Доктор',
};

/**
 * Electrical safety qualification grade. Requirements section 4 and 9 require a
 * safety grade on the employee record but do not enumerate the national grades, so
 * these are stored as a free ordinal I..V which matches Mongolian practice.
 */
export const SAFETY_GRADES = ['I', 'II', 'III', 'IV', 'V'] as const;
export type SafetyGrade = (typeof SAFETY_GRADES)[number];

export const QUALIFICATION_LEVELS = ['JUNIOR', 'MIDDLE', 'SENIOR', 'LEAD', 'EXPERT'] as const;
export type QualificationLevel = (typeof QUALIFICATION_LEVELS)[number];

export const QUALIFICATION_LEVEL_LABELS: Record<QualificationLevel, string> = {
  JUNIOR: 'Дадлагажигч',
  MIDDLE: 'Дунд',
  SENIOR: 'Ахлах',
  LEAD: 'Багийн ахлагч',
  EXPERT: 'Мэргэшсэн',
};

export const EMPLOYEE_DOCUMENT_TYPES = [
  'PHOTO',
  'ID_COPY',
  'EMPLOYMENT_CONTRACT',
  'JOB_DESCRIPTION',
  'DIPLOMA',
  'CERTIFICATE',
  'OTHER',
] as const;
export type EmployeeDocumentType = (typeof EMPLOYEE_DOCUMENT_TYPES)[number];

export const EMPLOYEE_DOCUMENT_TYPE_LABELS: Record<EmployeeDocumentType, string> = {
  PHOTO: 'Ажилтны зураг',
  ID_COPY: 'Иргэний үнэмлэхийн хуулбар',
  EMPLOYMENT_CONTRACT: 'Хөдөлмөрийн гэрээ',
  JOB_DESCRIPTION: 'Ажлын байрны тодорхойлолт',
  DIPLOMA: 'Диплом',
  CERTIFICATE: 'Сертификат',
  OTHER: 'Бусад хавсралт',
};

export const SALARY_CALCULATION_TYPES = ['MONTHLY', 'HOURLY', 'DAILY', 'PIECE_RATE'] as const;
export type SalaryCalculationType = (typeof SALARY_CALCULATION_TYPES)[number];

export const SALARY_CALCULATION_TYPE_LABELS: Record<SalaryCalculationType, string> = {
  MONTHLY: 'Сарын цалин',
  HOURLY: 'Цагийн цалин',
  DAILY: 'Өдрийн цалин',
  PIECE_RATE: 'Гүйцэтгэлийн цалин',
};

/** Requirements section 16.1 fixes the system currency to MNT. */
export const SUPPORTED_CURRENCIES = ['MNT', 'USD'] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];
export const DEFAULT_CURRENCY: Currency = 'MNT';
