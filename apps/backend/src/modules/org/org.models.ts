import { Schema, Types, model, type HydratedDocument, type Model } from 'mongoose';

/**
 * Internal organisation master data for the service provider.
 *
 * Distinct from the customer hierarchy: a Company here is one of the provider's own
 * legal entities, whereas a Customer is an organisation that buys electrical services.
 */

// -- Company -----------------------------------------------------------------

export interface ICompany {
  code: string;
  name: string;
  registrationNumber: string | null;
  address: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const companySchema = new Schema<ICompany>(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 32 },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    registrationNumber: { type: String, default: null, trim: true, maxlength: 32 },
    address: { type: String, default: null, trim: true, maxlength: 500 },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true, versionKey: false },
);

export const Company: Model<ICompany> = model<ICompany>('Company', companySchema);
export type CompanyDocument = HydratedDocument<ICompany>;

// -- Department --------------------------------------------------------------

export interface IDepartment {
  company: Types.ObjectId;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const departmentSchema = new Schema<IDepartment>(
  {
    company: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    code: { type: String, required: true, uppercase: true, trim: true, maxlength: 32 },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, versionKey: false },
);

// Codes are unique per company, not globally.
departmentSchema.index({ company: 1, code: 1 }, { unique: true });

export const Department: Model<IDepartment> = model<IDepartment>('Department', departmentSchema);

// -- Position ----------------------------------------------------------------

export interface IPosition {
  company: Types.ObjectId;
  /** Null means valid in every department of the company. */
  department: Types.ObjectId | null;
  code: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const positionSchema = new Schema<IPosition>(
  {
    company: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    department: { type: Schema.Types.ObjectId, ref: 'Department', default: null, index: true },
    code: { type: String, required: true, uppercase: true, trim: true, maxlength: 32 },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, versionKey: false },
);

positionSchema.index({ company: 1, code: 1 }, { unique: true });

export const Position: Model<IPosition> = model<IPosition>('Position', positionSchema);

// -- Team --------------------------------------------------------------------

export interface ITeam {
  company: Types.ObjectId;
  department: Types.ObjectId | null;
  code: string;
  name: string;
  leaderEmployee: Types.ObjectId | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const teamSchema = new Schema<ITeam>(
  {
    company: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    department: { type: Schema.Types.ObjectId, ref: 'Department', default: null, index: true },
    code: { type: String, required: true, uppercase: true, trim: true, maxlength: 32 },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    leaderEmployee: { type: Schema.Types.ObjectId, ref: 'Employee', default: null },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, versionKey: false },
);

teamSchema.index({ company: 1, code: 1 }, { unique: true });

export const Team: Model<ITeam> = model<ITeam>('Team', teamSchema);
