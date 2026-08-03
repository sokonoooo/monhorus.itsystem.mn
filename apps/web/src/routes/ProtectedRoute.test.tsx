import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '../contexts/auth-context';
import { ApiError } from '../lib/api-client';
import { tokenStorage } from '../lib/token-storage';
import { authService } from '../services/auth.service';
import { makeUser } from '../test/render';
import { ProtectedRoute } from './ProtectedRoute';

/**
 * The behaviour under test is what an operator sees when the API is down but their
 * credentials are still good — the state the whole admin console was in while mongod
 * was stopped. The cached user makes `isAuthenticated` true while the permission set is
 * still empty, and the sidebar hides every entry the caller lacks, so rendering the shell
 * would have shown an admin an app with no navigation and no stated reason.
 */
function renderProtected(): void {
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <AuthProvider>
        <Routes>
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <p>Хамгаалагдсан контент</p>
              </ProtectedRoute>
            }
          />
          <Route path="/login" element={<p>Нэвтрэх хуудас</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function seedCachedSession(): void {
  tokenStorage.setSession(
    { accessToken: 'test-token', refreshToken: 'test-refresh', expiresIn: 900, tokenType: 'Bearer' },
    makeUser(['service_request.view']),
  );
}

afterEach(() => {
  tokenStorage.clear();
  vi.restoreAllMocks();
});

describe('ProtectedRoute', () => {
  it('blocks on a retry screen when the server cannot confirm the session', async () => {
    seedCachedSession();
    vi.spyOn(authService, 'me').mockRejectedValue(
      new ApiError('Сервер алдаа.', 'INTERNAL_ERROR', 500),
    );

    renderProtected();

    expect(await screen.findByText('Сервертэй холбогдож чадсангүй')).toBeInTheDocument();
    // The critical half: the shell must not render alongside the outage notice, because a
    // permission-less shell is what made the failure look like a working but empty app.
    expect(screen.queryByText('Хамгаалагдсан контент')).not.toBeInTheDocument();
    // And an outage is not a logout — the credentials are untouched.
    expect(tokenStorage.getAccessToken()).toBe('test-token');
    expect(screen.queryByText('Нэвтрэх хуудас')).not.toBeInTheDocument();
  });

  it('recovers without a re-login once the server answers again', async () => {
    seedCachedSession();
    const user = makeUser(['service_request.view']);
    const me = vi
      .spyOn(authService, 'me')
      .mockRejectedValueOnce(new ApiError('Сервер алдаа.', 'INTERNAL_ERROR', 500))
      .mockResolvedValueOnce(user);

    renderProtected();

    await screen.findByText('Сервертэй холбогдож чадсангүй');
    await userEvent.click(screen.getByRole('button', { name: 'Дахин оролдох' }));

    expect(await screen.findByText('Хамгаалагдсан контент')).toBeInTheDocument();
    expect(screen.queryByText('Сервертэй холбогдож чадсангүй')).not.toBeInTheDocument();
    expect(me).toHaveBeenCalledTimes(2);
  });

  it('still signs the user out when the session is genuinely rejected', async () => {
    seedCachedSession();
    vi.spyOn(authService, 'me').mockRejectedValue(
      new ApiError('Эрх хүчингүй.', 'UNAUTHORIZED', 401),
    );

    renderProtected();

    // A 401 means the credentials are dead, which is a different thing from the server
    // being unreachable, and must still clear them rather than offer a retry.
    expect(await screen.findByText('Нэвтрэх хуудас')).toBeInTheDocument();
    expect(screen.queryByText('Сервертэй холбогдож чадсангүй')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(tokenStorage.getAccessToken()).toBeNull();
    });
  });

  it('renders the content when the session confirms', async () => {
    seedCachedSession();
    vi.spyOn(authService, 'me').mockResolvedValue(makeUser(['service_request.view']));

    renderProtected();

    expect(await screen.findByText('Хамгаалагдсан контент')).toBeInTheDocument();
  });
});
