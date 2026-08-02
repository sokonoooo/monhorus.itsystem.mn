import type {
  AdminPermission,
  Locale,
  UserRole,
  UserStatus,
} from '../../common/constants/roles.constant';

/** Claims carried inside the signed access token. Kept small: JWTs travel on every request. */
export interface AccessTokenClaims {
  sub: string;
  role: UserRole;
  perms: AdminPermission[];
  org: string | null;
  office: string | null;
  /** Refresh-token family id, so a session can be traced end to end in the audit log. */
  sid: string;
}

/** Attached to `req.auth` after authentication. Reflects live database state, not just claims. */
export interface AuthContext {
  userId: string;
  email: string;
  fullName: string;
  role: UserRole;
  permissions: AdminPermission[];
  organizationId: string | null;
  officeId: string | null;
  sessionId: string;
}

/** Shape returned to clients. Never includes hashes or invitation material. */
export interface AuthUserDto {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: UserRole;
  permissions: AdminPermission[];
  organizationId: string | null;
  officeId: string | null;
  status: UserStatus;
  employeeCode: string | null;
  jobTitle: string | null;
  department: string | null;
  locale: Locale;
  lastLoginAt: string | null;
}

export interface AuthTokensDto {
  accessToken: string;
  /** Seconds until the access token expires; clients schedule refresh from this. */
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: string;
  tokenType: 'Bearer';
}

export interface AuthSessionDto {
  user: AuthUserDto;
  tokens: AuthTokensDto;
}
