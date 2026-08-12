import type { CurrentUserDto, PermissionKey, UserRole } from '@monhorus/shared';
import { render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';

import { ToastProvider } from '../components/ui/ToastProvider';
import { AuthProvider } from '../contexts/auth-context';
import { authService } from '../services/auth.service';
import { tokenStorage } from '../lib/token-storage';

/**
 * The signed-in user a test renders against.
 *
 * `role` is a parameter because a screen may gate on the coarse tier rather than on a
 * permission key: user management is role-gated on the server, so a test of it has to be
 * able to sign in as something other than an admin.
 */
export function makeUser(
  permissions: readonly PermissionKey[],
  role: UserRole = 'admin',
  /**
   * Anything else about the account.
   *
   * Added for the portal: `customerId`/`customerName` were hardcoded null, so a customer
   * who actually belongs to an organisation — the only kind the server will create, since
   * `User.customer` is required on the customer tier — could not be expressed here at all.
   */
  overrides: Partial<CurrentUserDto> = {},
): CurrentUserDto {
  return {
    id: 'u1',
    fullName: 'Тест Хэрэглэгч',
    email: 'test@monhorus.mn',
    phone: null,
    role,
    status: 'active',
    customerId: null,
    customerName: null,
    lastLoginAt: null,
    createdBy: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    roleIds: ['r1'],
    permissions: [...permissions],
    ...overrides,
  };
}

/**
 * Renders a component inside a router and an AuthProvider that has already resolved
 * to the supplied permission set, by stubbing the /auth/me call the provider makes
 * during session restore.
 */
export function renderWithAuth(
  ui: ReactElement,
  options: {
    permissions?: readonly PermissionKey[];
    route?: string;
    /**
     * Route pattern to mount the component at. Required for a screen that reads
     * `useParams`, because a bare render has no matched route to take params from.
     */
    path?: string;
    /** Coarse role tier of the signed-in user. Defaults to admin. */
    role?: UserRole;
    /** Anything else about the account — `customerId` for a portal caller, say. */
    user?: Partial<CurrentUserDto>;
  } = {},
): RenderResult {
  const user = makeUser(options.permissions ?? [], options.role, options.user);

  tokenStorage.setSession(
    { accessToken: 'test-token', refreshToken: 'test-refresh', expiresIn: 900, tokenType: 'Bearer' },
    user,
  );

  vi.spyOn(authService, 'me').mockResolvedValue(user);

  // ToastProvider is part of the real app shell, so pages that raise a toast must
  // find it here too, otherwise a component-level test fails for the wrong reason.
  const content = options.path ? (
    <Routes>
      <Route path={options.path} element={ui} />
    </Routes>
  ) : (
    ui
  );

  return render(
    <MemoryRouter initialEntries={[options.route ?? '/']}>
      <AuthProvider>
        <ToastProvider>{content}</ToastProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}
