import type { AccountStatus, UserRole } from '../constants/roles';

/** Public user shape. Never contains the password hash. */
export interface UserDto {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: UserRole;
  status: AccountStatus;
  /**
   * The customer organisation this account belongs to.
   *
   * Required for a `customer` account and null for staff. This is the security boundary for
   * every customer-owned read, so it is resolved from the account on the server and is never
   * accepted from a request.
   */
  customerId: string | null;
  customerName: string | null;
  lastLoginAt: string | null;
  createdBy: string | null;
  /**
   * Who created the record, resolved to a display name.
   *
   * Null where it is not known: rows created before the creator was recorded, and
   * records the system itself made. The screen renders that as a dash rather than
   * guessing, because an absent creator is a real answer here.
   */
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserRequest {
  fullName: string;
  email: string;
  password: string;
  phone?: string | null;
  role: UserRole;
  /**
   * The customer organisation to link the new account to.
   *
   * Mandatory for a `customer` role and refused for any staff role. The server enforces
   * both rules; sending it is never enough on its own.
   */
  customerId?: string | null;
  /** When true the user must replace the admin-issued passcode at first login. */
  requirePasswordChange?: boolean;
}

/**
 * Administrative edit of an existing account.
 *
 * Every field is optional and an absent field is left untouched. `customerId` is the one
 * field where null and absent differ: absent keeps the current link, null asks to clear it,
 * and clearing the link of an account that is still a `customer` is refused.
 */
export interface UpdateUserRequest {
  fullName?: string;
  phone?: string | null;
  role?: UserRole;
  customerId?: string | null;
  reason?: string;
}

export interface CreateUserResponse {
  user: UserDto;
  /** Echoed once so the admin can hand the passcode over. Never stored in plaintext. */
  temporaryPassword: string;
}

export interface ResetPasscodeRequest {
  newPassword: string;
  reason?: string;
}

export interface ResetPasscodeResponse {
  user: UserDto;
  temporaryPassword: string;
}

export interface UpdateUserStatusRequest {
  status: Extract<AccountStatus, 'active' | 'suspended'>;
  reason?: string;
}

export interface ListUsersQuery {
  page?: number;
  limit?: number;
  role?: UserRole;
  status?: AccountStatus;
  search?: string;
  /** The organisation a portal account belongs to. Staff accounts carry no link. */
  customerId?: string;
}
