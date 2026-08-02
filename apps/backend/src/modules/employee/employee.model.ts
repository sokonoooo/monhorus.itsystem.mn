import {
  EDUCATION_LEVELS,
  EMPLOYEE_STATUSES,
  EMPLOYEE_TYPES,
  GENDERS,
  MARITAL_STATUSES,
  QUALIFICATION_LEVELS,
  SAFETY_GRADES,
  type EducationLevel,
  type EmployeeStatus,
  type EmployeeType,
  type Gender,
  type MaritalStatus,
  type QualificationLevel,
  type SafetyGrade,
} from '@monhorus/shared';
import { Schema, Types, model, type HydratedDocument, type Model } from 'mongoose';

/**
 * Employee master record.
 *
 * Employee and User are deliberately separate entities: an employee may exist with no
 * login (requirements section 13.2 describes field staff who only use the mobile app,
 * and the Phase 1 brief requires supporting an employee without an account).
 * `systemUser` is the optional link.
 *
 * Salary lives in its own effective-dated collection, never on this document, so that
 * a query for employee data cannot accidentally leak compensation.
 */

export interface IEmployeeEducation {
  _id: Types.ObjectId;
  level: EducationLevel;
  school: string;
  major: string | null;
  startDate: Date | null;
  endDate: Date | null;
  diplomaNumber: string | null;
}

export interface IEmployeeWorkHistory {
  _id: Types.ObjectId;
  organization: string;
  position: string;
  startDate: Date | null;
  endDate: Date | null;
  leaveReason: string | null;
}

export interface IEmployeeCertificate {
  _id: Types.ObjectId;
  name: string;
  certificateNumber: string | null;
  issuedDate: Date | null;
  expiryDate: Date | null;
  document: Types.ObjectId | null;
}

export interface IEmployee {
  employeeCode: string;

  firstName: string;
  lastName: string;
  registrationNumber: string | null;
  email: string | null;
  phone: string | null;
  birthDate: Date | null;
  gender: Gender | null;
  photoDocument: Types.ObjectId | null;

  company: Types.ObjectId | null;
  department: Types.ObjectId | null;
  position: Types.ObjectId | null;
  team: Types.ObjectId | null;
  directManager: Types.ObjectId | null;
  workLocation: string | null;
  employmentStartDate: Date | null;
  employeeType: EmployeeType | null;
  status: EmployeeStatus;
  terminationDate: Date | null;
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

  education: IEmployeeEducation[];
  workHistory: IEmployeeWorkHistory[];
  certificates: IEmployeeCertificate[];

  systemUser: Types.ObjectId | null;

  createdBy: Types.ObjectId | null;
  updatedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export type EmployeeDocumentType_ = HydratedDocument<IEmployee>;

const educationSchema = new Schema<IEmployeeEducation>(
  {
    level: { type: String, enum: EDUCATION_LEVELS, required: true },
    school: { type: String, required: true, trim: true, maxlength: 200 },
    major: { type: String, default: null, trim: true, maxlength: 200 },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    diplomaNumber: { type: String, default: null, trim: true, maxlength: 64 },
  },
  { _id: true },
);

const workHistorySchema = new Schema<IEmployeeWorkHistory>(
  {
    organization: { type: String, required: true, trim: true, maxlength: 200 },
    position: { type: String, required: true, trim: true, maxlength: 200 },
    startDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    leaveReason: { type: String, default: null, trim: true, maxlength: 500 },
  },
  { _id: true },
);

const certificateSchema = new Schema<IEmployeeCertificate>(
  {
    name: { type: String, required: true, trim: true, maxlength: 200 },
    certificateNumber: { type: String, default: null, trim: true, maxlength: 64 },
    issuedDate: { type: Date, default: null },
    expiryDate: { type: Date, default: null },
    document: { type: Schema.Types.ObjectId, ref: 'StoredFile', default: null },
  },
  { _id: true },
);

const employeeSchema = new Schema<IEmployee>(
  {
    employeeCode: {
      type: String,
      required: [true, 'Ажилтны код заавал.'],
      unique: true,
      uppercase: true,
      trim: true,
      maxlength: 32,
    },

    firstName: { type: String, required: [true, 'Нэр заавал.'], trim: true, maxlength: 100 },
    lastName: { type: String, required: [true, 'Овог заавал.'], trim: true, maxlength: 100 },
    registrationNumber: { type: String, default: null, uppercase: true, trim: true, maxlength: 20 },
    email: { type: String, default: null, lowercase: true, trim: true, maxlength: 254 },
    phone: { type: String, default: null, trim: true, maxlength: 24 },
    birthDate: { type: Date, default: null },
    gender: { type: String, enum: [...GENDERS, null], default: null },
    photoDocument: { type: Schema.Types.ObjectId, ref: 'StoredFile', default: null },

    company: { type: Schema.Types.ObjectId, ref: 'Company', default: null, index: true },
    department: { type: Schema.Types.ObjectId, ref: 'Department', default: null, index: true },
    position: { type: Schema.Types.ObjectId, ref: 'Position', default: null, index: true },
    team: { type: Schema.Types.ObjectId, ref: 'Team', default: null, index: true },
    directManager: { type: Schema.Types.ObjectId, ref: 'Employee', default: null },
    workLocation: { type: String, default: null, trim: true, maxlength: 200 },
    employmentStartDate: { type: Date, default: null },
    employeeType: { type: String, enum: [...EMPLOYEE_TYPES, null], default: null, index: true },
    status: { type: String, enum: EMPLOYEE_STATUSES, default: 'DRAFT', index: true },
    terminationDate: { type: Date, default: null },
    terminationReason: { type: String, default: null, trim: true, maxlength: 500 },

    icCardNumber: { type: String, default: null, trim: true, maxlength: 64 },
    attendanceNumber: { type: String, default: null, trim: true, maxlength: 64 },
    skills: { type: [String], default: [] },
    qualificationLevel: {
      type: String,
      enum: [...QUALIFICATION_LEVELS, null],
      default: null,
    },
    safetyGrade: { type: String, enum: [...SAFETY_GRADES, null], default: null },
    permittedJobTypes: { type: [String], default: [] },
    hasDriverLicense: { type: Boolean, default: false },
    gpsVerificationEnabled: { type: Boolean, default: true },

    mealDiscountPercent: { type: Number, default: null, min: 0, max: 100 },
    dailyMealCount: { type: Number, default: null, min: 0 },
    mealConfigEnabled: { type: Boolean, default: false },

    birthProvince: { type: String, default: null, trim: true, maxlength: 120 },
    birthDistrict: { type: String, default: null, trim: true, maxlength: 120 },
    currentAddress: { type: String, default: null, trim: true, maxlength: 500 },
    residentialAddress: { type: String, default: null, trim: true, maxlength: 500 },
    maritalStatus: { type: String, enum: [...MARITAL_STATUSES, null], default: null },
    familySize: { type: Number, default: null, min: 0 },
    emergencyContactName: { type: String, default: null, trim: true, maxlength: 200 },
    emergencyContactRelation: { type: String, default: null, trim: true, maxlength: 120 },
    emergencyContactPhone: { type: String, default: null, trim: true, maxlength: 24 },

    education: { type: [educationSchema], default: [] },
    workHistory: { type: [workHistorySchema], default: [] },
    certificates: { type: [certificateSchema], default: [] },

    systemUser: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, versionKey: false },
);

// Sparse-unique: these identifiers are optional but must not collide when supplied.
// A partial filter on $type string is used rather than `sparse`, because sparse
// indexes still collide on explicit nulls.
const uniqueWhenPresent = (field: string): void => {
  employeeSchema.index(
    { [field]: 1 },
    { unique: true, partialFilterExpression: { [field]: { $type: 'string' } } },
  );
};
uniqueWhenPresent('registrationNumber');
uniqueWhenPresent('email');
uniqueWhenPresent('icCardNumber');
uniqueWhenPresent('attendanceNumber');

// One system user maps to at most one employee.
employeeSchema.index(
  { systemUser: 1 },
  { unique: true, partialFilterExpression: { systemUser: { $type: 'objectId' } } },
);

// List screen: filter by organisation and status, newest first.
employeeSchema.index({ company: 1, department: 1, status: 1, createdAt: -1 });
// Free-text search across the name fields.
employeeSchema.index({ firstName: 'text', lastName: 'text', employeeCode: 'text' });

export const Employee: Model<IEmployee> = model<IEmployee>('Employee', employeeSchema);
