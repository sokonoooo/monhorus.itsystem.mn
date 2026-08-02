import {
  ACCOUNT_STATUSES,
  USER_ROLES,
  type AccountStatus,
  type UserRole,
} from '@monhorus/shared';
import { Schema, Types, model, type HydratedDocument, type Model } from 'mongoose';

export interface IUser {
  fullName: string;
  email: string;
  /** bcrypt hash. `select: false` so it never loads unless explicitly requested. */
  password: string;
  phone: string | null;
  role: UserRole;
  /**
   * Dynamic RBAC role references. Additive to `role`, which remains the coarse tier
   * used by the mobile client and the existing guards. Effective permissions are the
   * union of these roles' permission sets; head_admin is an unconditional superuser.
   */
  roles: Types.ObjectId[];
  status: AccountStatus;

  /**
   * The customer organisation this account belongs to.
   *
   * Set for a `customer` account, null for staff. This is the security boundary for every
   * customer-owned read: the scope resolver takes it from here, never from the request, so
   * a customer cannot widen their own view by sending a different id.
   *
   * Nullable rather than required because staff accounts legitimately have none, and
   * because accounts that predate this field must keep working. A `customer` account
   * without one is refused at request time rather than silently reading nothing.
   */
  customer: Types.ObjectId | null;

  lastLoginAt: Date | null;
  passwordChangedAt: Date | null;
  failedLoginAttempts: number;
  lockedUntil: Date | null;

  /** Admin who provisioned this account. Null only for the bootstrap head_admin. */
  createdBy: Types.ObjectId | null;

  createdAt: Date;
  updatedAt: Date;
}

export type UserDocument = HydratedDocument<IUser>;

const userSchema = new Schema<IUser>(
  {
    fullName: {
      type: String,
      required: [true, 'Нэр заавал бөглөнө.'],
      trim: true,
      minlength: [2, 'Нэр дор хаяж 2 тэмдэгттэй байна.'],
      maxlength: [200, 'Нэр 200 тэмдэгтээс урт байж болохгүй.'],
    },
    email: {
      type: String,
      required: [true, 'Имэйл заавал бөглөнө.'],
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Имэйл хаяг буруу форматтай байна.'],
    },
    password: {
      type: String,
      required: [true, 'Нууц үг заавал.'],
      select: false,
    },
    phone: {
      type: String,
      default: null,
      trim: true,
      // Mongolian mobile format, country code optional.
      match: [/^(\+976)?[- ]?\d{4}[- ]?\d{4}$/, 'Утасны дугаар буруу форматтай байна.'],
    },
    role: {
      type: String,
      enum: { values: [...USER_ROLES], message: 'Эрх буруу байна.' },
      required: [true, 'Эрх заавал сонгоно.'],
      index: true,
    },
    roles: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Role' }],
      default: [],
      index: true,
    },
    status: {
      type: String,
      enum: { values: [...ACCOUNT_STATUSES], message: 'Төлөв буруу байна.' },
      default: 'active',
      index: true,
    },

    lastLoginAt: { type: Date, default: null },
    passwordChangedAt: { type: Date, default: null },
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },

    customer: {
      type: Schema.Types.ObjectId,
      ref: 'Customer',
      default: null,
      index: true,
      // A staff account must not carry a customer link. Without this a demoted account
      // could keep a stale tenant binding that nothing else would notice.
      validate: {
        validator(this: IUser, value: Types.ObjectId | null): boolean {
          return this.role === 'customer' || value === null;
        },
        message: 'Зөвхөн харилцагчийн эрхтэй хэрэглэгч байгууллагад холбогдоно.',
      },
    },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: {
      transform(_doc, ret) {
        // Defence in depth: `select: false` already hides this, but a document that
        // explicitly selected the hash must still never serialise into a response.
        const plain = ret as Record<string, unknown>;
        delete plain.password;
        return plain;
      },
    },
  },
);

// Admin console listing: filter by role and status, newest first.
userSchema.index({ role: 1, status: 1, createdAt: -1 });

export const User: Model<IUser> = model<IUser>('User', userSchema);
