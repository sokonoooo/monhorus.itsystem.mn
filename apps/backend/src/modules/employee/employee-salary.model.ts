import {
  SALARY_CALCULATION_TYPES,
  SUPPORTED_CURRENCIES,
  type Currency,
  type SalaryCalculationType,
} from '@monhorus/shared';
import { Schema, Types, model, type Model } from 'mongoose';

/**
 * Effective-dated salary history.
 *
 * Records are never overwritten. Changing an employee's salary closes the open period
 * by stamping `effectiveTo` and inserts a new row, so payroll can always reconstruct
 * what was in force on any past date.
 *
 * Stored in a separate collection from Employee so that a permission-less read of the
 * employee document cannot expose compensation.
 */
export interface IEmployeeSalary {
  employee: Types.ObjectId;
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
  effectiveFrom: Date;
  /** Null means this is the currently active period. */
  effectiveTo: Date | null;
  createdBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const employeeSalarySchema = new Schema<IEmployeeSalary>(
  {
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    grade: { type: String, default: null, trim: true, maxlength: 64 },
    baseSalary: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: SUPPORTED_CURRENCIES, default: 'MNT' },
    calculationType: { type: String, enum: SALARY_CALCULATION_TYPES, default: 'MONTHLY' },
    bankName: { type: String, default: null, trim: true, maxlength: 120 },
    bankAccountName: { type: String, default: null, trim: true, maxlength: 200 },
    bankAccountNumber: { type: String, default: null, trim: true, maxlength: 64 },
    socialInsurance: { type: Boolean, default: true },
    personalIncomeTax: { type: Boolean, default: true },
    transportAllowance: { type: Number, default: 0, min: 0 },
    mealAllowance: { type: Number, default: 0, min: 0 },
    phoneAllowance: { type: Number, default: 0, min: 0 },
    otherAllowance: { type: Number, default: 0, min: 0 },
    effectiveFrom: { type: Date, required: true },
    effectiveTo: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, versionKey: false },
);

// Newest-first history lookup per employee.
employeeSalarySchema.index({ employee: 1, effectiveFrom: -1 });
// At most one open period per employee. Enforced by the database, not only in code.
employeeSalarySchema.index(
  { employee: 1 },
  { unique: true, partialFilterExpression: { effectiveTo: null } },
);

export const EmployeeSalary: Model<IEmployeeSalary> = model<IEmployeeSalary>(
  'EmployeeSalary',
  employeeSalarySchema,
);
