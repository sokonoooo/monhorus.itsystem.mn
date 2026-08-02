import type { PermissionKey, UserRole } from '@monhorus/shared';

export interface AuthContext {
  userId: string;
  email: string;
  fullName: string;
  role: UserRole;
  /**
   * The customer organisation this account belongs to, read from the account on every
   * request. Null for staff.
   *
   * Never populated from the query string, the path or the body. A customer-owned read
   * derives its tenant from here through `resolveCustomerScope`, which is what stops a
   * caller widening their own view by sending someone else's id.
   */
  customerId: string | null;
  /**
   * The employee (HR) record this account is linked to, resolved from the CURRENT
   * `Employee.systemUser` relationship on every authenticated request.
   *
   * Null is legitimate and common: admin, finance and system accounts frequently have
   * no employee card, and a customer never does. A self operation must therefore treat
   * null as "no record", never as "any record".
   *
   * Deliberately NOT carried in the access token, for the same reason as `customerId`
   * and `permissions`: relinking an account to a different employee, or revoking the
   * link entirely, has to take effect on the next request rather than when a 15 minute
   * token happens to expire. A token-borne employeeId would also be a claim the holder
   * could not change but the server could not re-verify cheaply either.
   *
   * Never populated from the query string, the path or the body. `GET /employees/me`
   * reads this and nothing else, which is what makes it impossible to aim at a
   * colleague's record.
   */
  employeeId: string | null;
  /** Dynamic role document ids assigned to this user. */
  roleIds: string[];
  /**
   * Effective permission set, resolved per request from the user's dynamic roles.
   * Deliberately not carried in the JWT: a permission revoked in the RBAC screen
   * must take effect immediately, not after the 15 minute access token expires.
   */
  permissions: ReadonlySet<PermissionKey>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Populated by the authenticate middleware on protected routes. */
      auth?: AuthContext;
    }
  }
}

export {};
