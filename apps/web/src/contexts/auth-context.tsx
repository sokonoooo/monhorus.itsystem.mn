import {
  isAdminRole,
  type LoginRequest,
  type PermissionKey,
  type UserDto,
  type UserRole,
} from '@monhorus/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

import { ApiError, setSessionExpiredHandler } from '../lib/api-client';
import { tokenStorage } from '../lib/token-storage';
import { authService } from '../services/auth.service';

interface AuthContextValue {
  user: UserDto | null;
  /**
   * Effective permission set from GET /auth/me. Empty until the session restores.
   * Used only to hide dead controls; the backend re-checks everything.
   */
  permissions: PermissionKey[];
  /** True until the initial session restore settles. Gate routing on this. */
  initialising: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  mustChangePassword: boolean;
  login: (credentials: LoginRequest) => Promise<UserDto>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  hasRole: (...roles: UserRole[]) => boolean;
  can: (permission: PermissionKey) => boolean;
  canAny: (...permissions: PermissionKey[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }): ReactElement {
  const [user, setUser] = useState<UserDto | null>(() => tokenStorage.getUser());
  // Permissions are never cached in localStorage: a revoked permission must not
  // survive a page reload. They are re-fetched from /auth/me on every restore.
  const [permissions, setPermissions] = useState<PermissionKey[]>([]);
  const [initialising, setInitialising] = useState(true);

  const clearSession = useCallback(() => {
    tokenStorage.clear();
    setUser(null);
    setPermissions([]);
  }, []);

  // Lets the axios interceptor drop React state when a refresh finally fails.
  useEffect(() => {
    setSessionExpiredHandler(clearSession);
  }, [clearSession]);

  // Restore on mount. The cached user renders immediately; /auth/me then confirms it
  // against the server, so a role or status change lands without needing a re-login.
  useEffect(() => {
    let cancelled = false;

    async function restore(): Promise<void> {
      if (!tokenStorage.getAccessToken()) {
        setInitialising(false);
        return;
      }

      try {
        const fresh = await authService.me();
        if (cancelled) return;
        tokenStorage.setUser(fresh);
        setUser(fresh);
        setPermissions(fresh.permissions);
      } catch (error) {
        if (cancelled) return;
        // /auth/me is reachable even while a password change is pending, so a 401 or
        // 403 here means the session is genuinely dead rather than merely restricted.
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          clearSession();
        }
      } finally {
        if (!cancelled) setInitialising(false);
      }
    }

    void restore();
    return () => {
      cancelled = true;
    };
  }, [clearSession]);

  const login = useCallback(async (credentials: LoginRequest): Promise<UserDto> => {
    const session = await authService.login(credentials);
    tokenStorage.setSession(session.tokens, session.user);
    setUser(session.user);

    // The login response carries no permission set, so fetch it immediately. A
    // must_change_password account is still allowed to reach /auth/me.
    try {
      const current = await authService.me();
      setPermissions(current.permissions);
    } catch {
      setPermissions([]);
    }

    return session.user;
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    const refreshToken = tokenStorage.getRefreshToken();
    if (refreshToken) {
      // A failed revoke must not trap the user inside a logged-in shell.
      await authService.logout(refreshToken).catch(() => undefined);
    }
    clearSession();
  }, [clearSession]);

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string): Promise<void> => {
      await authService.changePassword({ currentPassword, newPassword });
      // The backend revokes every session on password change, so the local one is dead.
      clearSession();
    },
    [clearSession],
  );

  const hasRole = useCallback(
    (...roles: UserRole[]): boolean => (user ? roles.includes(user.role) : false),
    [user],
  );

  const can = useCallback(
    (permission: PermissionKey): boolean => permissions.includes(permission),
    [permissions],
  );

  const canAny = useCallback(
    (...required: PermissionKey[]): boolean =>
      required.length === 0 || required.some((key) => permissions.includes(key)),
    [permissions],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      permissions,
      initialising,
      isAuthenticated: user !== null,
      isAdmin: user !== null && isAdminRole(user.role),
      mustChangePassword: user?.status === 'must_change_password',
      login,
      logout,
      changePassword,
      hasRole,
      can,
      canAny,
    }),
    [user, permissions, initialising, login, logout, changePassword, hasRole, can, canAny],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
