import type { PermissionKey } from '../constants/permissions';
import type { UserDto } from './user.types';

/**
 * Response of GET /auth/me. Carries the caller's effective permission set so the web
 * shell can hide actions it knows will be refused. The backend remains the authority;
 * this exists to avoid presenting dead controls, not to enforce anything.
 */
export interface CurrentUserDto extends UserDto {
  roleIds: string[];
  permissions: PermissionKey[];
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface AuthSession {
  user: UserDto;
  tokens: AuthTokens;
  /** True when status is must_change_password; the client must route to change-password. */
  mustChangePassword: boolean;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/**
 * Asking for a reset link.
 *
 * There is no response type to pair with this. The endpoint answers the same fixed message
 * whether or not the address is registered, and returns no data at all, precisely so a
 * caller cannot learn which it was.
 */
export interface ForgotPasswordRequest {
  email: string;
}

/** Redeeming a reset link. The token comes from the emailed URL, never from the user. */
export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
}
