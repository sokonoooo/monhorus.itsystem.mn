import { z } from 'zod';

import {
  EDUCATION_LEVELS,
  EMPLOYEE_DOCUMENT_TYPES,
  EMPLOYEE_STATUSES,
  EMPLOYEE_TYPES,
  GENDERS,
  MARITAL_STATUSES,
  QUALIFICATION_LEVELS,
  SAFETY_GRADES,
  SALARY_CALCULATION_TYPES,
  SUPPORTED_CURRENCIES,
} from '../constants/employee';
import { USER_ROLES } from '../constants/roles';
import {
  booleanQuerySchema,
  emailSchema,
  isoDateSchema,
  objectIdSchema,
  phoneSchema,
  registrationNumberSchema,
  sortDirSchema,
} from './common.schema';

/**
 * Employee validation, shared verbatim by the Express request validator and the web
 * form. Defining it once is what stops the two layers from drifting apart.
 */

export const employeeCodeSchema = z
  .string()
  .trim()
  .min(2, 'Ажилтны код дор хаяж 2 тэмдэгттэй байна.')
  .max(32, 'Ажилтны код 32 тэмдэгтээс урт байж болохгүй.')
  .regex(/^[A-Za-z0-9-]+$/, 'Ажилтны код зөвхөн үсэг, тоо, зураас агуулна.');

export const educationEntrySchema = z
  .object({
    level: z.enum(EDUCATION_LEVELS, { required_error: 'Боловсролын түвшин заавал.' }),
    school: z.string().trim().min(1, 'Сургууль заавал.').max(200),
    major: z.string().trim().max(200).nullish(),
    startDate: isoDateSchema.nullish(),
    endDate: isoDateSchema.nullish(),
    diplomaNumber: z.string().trim().max(64).nullish(),
  })
  .superRefine((value, ctx) => {
    if (value.startDate && value.endDate && Date.parse(value.endDate) < Date.parse(value.startDate)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'Төгссөн огноо элссэн огнооноос өмнө байж болохгүй.',
      });
    }
  });

export const workHistoryEntrySchema = z
  .object({
    organization: z.string().trim().min(1, 'Байгууллага заавал.').max(200),
    position: z.string().trim().min(1, 'Албан тушаал заавал.').max(200),
    startDate: isoDateSchema.nullish(),
    endDate: isoDateSchema.nullish(),
    leaveReason: z.string().trim().max(500).nullish(),
  })
  .superRefine((value, ctx) => {
    if (value.startDate && value.endDate && Date.parse(value.endDate) < Date.parse(value.startDate)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'Дуусах огноо эхлэх огнооноос өмнө байж болохгүй.',
      });
    }
  });

export const certificateEntrySchema = z
  .object({
    name: z.string().trim().min(1, 'Сертификатын нэр заавал.').max(200),
    certificateNumber: z.string().trim().max(64).nullish(),
    issuedDate: isoDateSchema.nullish(),
    expiryDate: isoDateSchema.nullish(),
    documentId: objectIdSchema.nullish(),
  })
  .superRefine((value, ctx) => {
    // Explicit Phase 1 rule: certificate expiry must not precede its issue date.
    if (
      value.issuedDate &&
      value.expiryDate &&
      Date.parse(value.expiryDate) < Date.parse(value.issuedDate)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expiryDate'],
        message: 'Дуусах огноо олгосон огнооноос өмнө байж болохгүй.',
      });
    }
  });

const employeeBaseShape = {
  employeeCode: employeeCodeSchema,
  firstName: z.string().trim().min(1, 'Нэр заавал.').max(100),
  lastName: z.string().trim().min(1, 'Овог заавал.').max(100),
  registrationNumber: registrationNumberSchema.nullish(),
  email: emailSchema.nullish(),
  phone: phoneSchema.nullish(),
  birthDate: isoDateSchema.nullish(),
  gender: z.enum(GENDERS).nullish(),

  companyId: objectIdSchema.nullish(),
  departmentId: objectIdSchema.nullish(),
  positionId: objectIdSchema.nullish(),
  teamId: objectIdSchema.nullish(),
  directManagerId: objectIdSchema.nullish(),
  workLocation: z.string().trim().max(200).nullish(),
  employmentStartDate: isoDateSchema.nullish(),
  employeeType: z.enum(EMPLOYEE_TYPES).nullish(),
  status: z.enum(EMPLOYEE_STATUSES).default('DRAFT'),
  terminationDate: isoDateSchema.nullish(),
  terminationReason: z.string().trim().max(500).nullish(),

  icCardNumber: z.string().trim().max(64).nullish(),
  attendanceNumber: z.string().trim().max(64).nullish(),
  skills: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  qualificationLevel: z.enum(QUALIFICATION_LEVELS).nullish(),
  safetyGrade: z.enum(SAFETY_GRADES).nullish(),
  permittedJobTypes: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  hasDriverLicense: z.boolean().default(false),
  gpsVerificationEnabled: z.boolean().default(true),

  mealDiscountPercent: z
    .number()
    .min(0, 'Хоолны хөнгөлөлт 0-ээс бага байж болохгүй.')
    .max(100, 'Хоолны хөнгөлөлт 100-аас их байж болохгүй.')
    .nullish(),
  dailyMealCount: z
    .number()
    .int('Өдрийн хоолны тоо бүхэл тоо байна.')
    .min(0, 'Өдрийн хоолны тоо сөрөг байж болохгүй.')
    .nullish(),
  mealConfigEnabled: z.boolean().default(false),

  birthProvince: z.string().trim().max(120).nullish(),
  birthDistrict: z.string().trim().max(120).nullish(),
  currentAddress: z.string().trim().max(500).nullish(),
  residentialAddress: z.string().trim().max(500).nullish(),
  maritalStatus: z.enum(MARITAL_STATUSES).nullish(),
  familySize: z.number().int().min(0).max(50).nullish(),
  emergencyContactName: z.string().trim().max(200).nullish(),
  emergencyContactRelation: z.string().trim().max(120).nullish(),
  emergencyContactPhone: phoneSchema.nullish(),

  education: z.array(educationEntrySchema).max(20).default([]),
  workHistory: z.array(workHistoryEntrySchema).max(30).default([]),
  certificates: z.array(certificateEntrySchema).max(30).default([]),
};

/**
 * Cross-field rules that apply to both create and update.
 *
 * Only structural rules live here. Uniqueness and referential integrity require a
 * database round trip and are enforced in the backend service layer.
 */
function applyEmployeeRefinements(
  value: {
    status?: string;
    companyId?: string | null;
    departmentId?: string | null;
    positionId?: string | null;
    employeeType?: string | null;
    employmentStartDate?: string | null;
    terminationDate?: string | null;
    terminationReason?: string | null;
  },
  ctx: z.RefinementCtx,
): void {
  if (value.status === 'ACTIVE') {
    const required: Array<[keyof typeof value, string]> = [
      ['companyId', 'Идэвхтэй ажилтанд компани заавал.'],
      ['departmentId', 'Идэвхтэй ажилтанд харьяалагдах алба заавал.'],
      ['positionId', 'Идэвхтэй ажилтанд албан тушаал заавал.'],
      ['employeeType', 'Идэвхтэй ажилтанд ажилтны төрөл заавал.'],
      ['employmentStartDate', 'Идэвхтэй ажилтанд ажиллаж эхэлсэн огноо заавал.'],
    ];
    for (const [key, message] of required) {
      if (!value[key]) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key as string], message });
      }
    }
  }

  if (value.status === 'TERMINATED') {
    if (!value.terminationDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['terminationDate'],
        message: 'Ажлаас гарсан огноо заавал.',
      });
    }
    if (!value.terminationReason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['terminationReason'],
        message: 'Ажлаас гарсан шалтгаан заавал.',
      });
    }
  }

  if (
    value.terminationDate &&
    value.employmentStartDate &&
    Date.parse(value.terminationDate) < Date.parse(value.employmentStartDate)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['terminationDate'],
      message: 'Ажлаас гарсан огноо ажилд орсон огнооноос өмнө байж болохгүй.',
    });
  }
}

export const createEmployeeSchema = z
  .object(employeeBaseShape)
  .superRefine(applyEmployeeRefinements);

/** Every field optional; the same cross-field rules still apply to what is sent. */
export const updateEmployeeSchema = z
  .object(employeeBaseShape)
  .partial()
  .superRefine(applyEmployeeRefinements);

export const changeEmployeeStatusSchema = z
  .object({
    status: z.enum(EMPLOYEE_STATUSES, { required_error: 'Төлөв заавал.' }),
    reason: z.string().trim().max(500).optional(),
    terminationDate: isoDateSchema.optional(),
    terminationReason: z.string().trim().max(500).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.status === 'TERMINATED') {
      if (!value.terminationDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['terminationDate'],
          message: 'Ажлаас гарсан огноо заавал.',
        });
      }
      if (!value.terminationReason) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['terminationReason'],
          message: 'Ажлаас гарсан шалтгаан заавал.',
        });
      }
    }
  });

export const employeeSalarySchema = z
  .object({
    grade: z.string().trim().max(64).nullish(),
    baseSalary: z.number().min(0, 'Үндсэн цалин сөрөг байж болохгүй.'),
    currency: z.enum(SUPPORTED_CURRENCIES).default('MNT'),
    calculationType: z.enum(SALARY_CALCULATION_TYPES).default('MONTHLY'),
    bankName: z.string().trim().max(120).nullish(),
    bankAccountName: z.string().trim().max(200).nullish(),
    bankAccountNumber: z.string().trim().max(64).nullish(),
    socialInsurance: z.boolean().default(true),
    personalIncomeTax: z.boolean().default(true),
    transportAllowance: z.number().min(0, 'Нэмэгдэл сөрөг байж болохгүй.').default(0),
    mealAllowance: z.number().min(0, 'Нэмэгдэл сөрөг байж болохгүй.').default(0),
    phoneAllowance: z.number().min(0, 'Нэмэгдэл сөрөг байж болохгүй.').default(0),
    otherAllowance: z.number().min(0, 'Нэмэгдэл сөрөг байж болохгүй.').default(0),
    effectiveFrom: isoDateSchema,
    effectiveTo: isoDateSchema.nullish(),
  })
  .superRefine((value, ctx) => {
    if (
      value.effectiveTo &&
      Date.parse(value.effectiveTo) < Date.parse(value.effectiveFrom)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['effectiveTo'],
        message: 'Дуусах огноо эхлэх огнооноос өмнө байж болохгүй.',
      });
    }
  });

export const employeeDocumentMetaSchema = z
  .object({
    documentType: z.enum(EMPLOYEE_DOCUMENT_TYPES, { required_error: 'Баримтын төрөл заавал.' }),
    name: z.string().trim().min(1, 'Баримтын нэр заавал.').max(200),
    issueDate: isoDateSchema.nullish(),
    expiryDate: isoDateSchema.nullish(),
    notes: z.string().trim().max(1000).nullish(),
  })
  .superRefine((value, ctx) => {
    if (
      value.issueDate &&
      value.expiryDate &&
      Date.parse(value.expiryDate) < Date.parse(value.issueDate)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expiryDate'],
        message: 'Дуусах огноо олгосон огнооноос өмнө байж болохгүй.',
      });
    }
  });

export const linkSystemAccessSchema = z
  .object({
    mode: z.enum(['LINK_EXISTING', 'CREATE_NEW', 'DEACTIVATE']),
    userId: objectIdSchema.optional(),
    email: emailSchema.optional(),
    password: z.string().min(10, 'Нууц үг дор хаяж 10 тэмдэгттэй байна.').optional(),
    role: z.enum(USER_ROLES).optional(),
    roleIds: z.array(objectIdSchema).max(20).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.mode === 'LINK_EXISTING' && !value.userId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['userId'],
        message: 'Холбох хэрэглэгч заавал.',
      });
    }
    if (value.mode === 'CREATE_NEW') {
      if (!value.email) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['email'], message: 'Имэйл заавал.' });
      }
      if (!value.password) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['password'],
          message: 'Түр нууц үг заавал.',
        });
      }
      if (!value.role) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['role'], message: 'Эрх заавал.' });
      }
    }
  });

/**
 * Free-text justification carried into the audit trail. Optional everywhere: the
 * requirement asks for the actions themselves, and refusing an action for a missing
 * reason would be a rule the specification does not state.
 */
const accessReasonSchema = z.string().trim().min(1).max(500).optional();

export const updateSystemAccessRolesSchema = z.object({
  // An empty array is legitimate: it strips every dynamic role without unlinking
  // the account, which is how an administrator parks a login with no authority.
  roleIds: z.array(objectIdSchema).max(20),
  reason: accessReasonSchema,
});

export const systemAccessActionSchema = z.object({
  reason: accessReasonSchema,
});

export const employeeListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(200).optional(),
  firstName: z.string().trim().max(100).optional(),
  lastName: z.string().trim().max(100).optional(),
  employeeCode: z.string().trim().max(32).optional(),
  registrationNumber: z.string().trim().max(20).optional(),
  email: z.string().trim().max(254).optional(),
  phone: z.string().trim().max(24).optional(),
  icCardNumber: z.string().trim().max(64).optional(),
  companyId: objectIdSchema.optional(),
  departmentId: objectIdSchema.optional(),
  positionId: objectIdSchema.optional(),
  teamId: objectIdSchema.optional(),
  employeeType: z.enum(EMPLOYEE_TYPES).optional(),
  status: z.enum(EMPLOYEE_STATUSES).optional(),
  isActive: booleanQuerySchema.optional(),
  startDateFrom: isoDateSchema.optional(),
  startDateTo: isoDateSchema.optional(),
  sortBy: z
    .enum(['employeeCode', 'firstName', 'lastName', 'employmentStartDate', 'createdAt'])
    .default('createdAt'),
  sortDir: sortDirSchema,
});

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
export type ChangeEmployeeStatusInput = z.infer<typeof changeEmployeeStatusSchema>;
export type EmployeeSalaryInput = z.infer<typeof employeeSalarySchema>;
export type EmployeeDocumentMetaInput = z.infer<typeof employeeDocumentMetaSchema>;
export type LinkSystemAccessInput = z.infer<typeof linkSystemAccessSchema>;
export type UpdateSystemAccessRolesInput = z.infer<typeof updateSystemAccessRolesSchema>;
export type SystemAccessActionInput = z.infer<typeof systemAccessActionSchema>;
export type EmployeeListQueryInput = z.infer<typeof employeeListQuerySchema>;
