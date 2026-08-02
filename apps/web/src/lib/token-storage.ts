import type { AuthTokens, UserDto } from '@monhorus/shared';

const ACCESS_KEY = 'monhorus.access';
const REFRESH_KEY = 'monhorus.refresh';
const USER_KEY = 'monhorus.user';

/**
 * Single owner of token persistence, so the axios interceptor and the auth context
 * never disagree about where credentials live.
 *
 * Trade-off: localStorage is readable by any script on the origin, so a successful
 * XSS can exfiltrate the token. The alternative, httpOnly cookies, requires the
 * backend to issue cookies and brings CSRF handling with it. Revisit before launch;
 * the current mitigations are a strict CSP and the 15-minute access token lifetime.
 */
export const tokenStorage = {
  getAccessToken(): string | null {
    return localStorage.getItem(ACCESS_KEY);
  },

  getRefreshToken(): string | null {
    return localStorage.getItem(REFRESH_KEY);
  },

  getUser(): UserDto | null {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as UserDto;
    } catch {
      // Corrupted cache is not fatal; treat it as absent.
      return null;
    }
  },

  setSession(tokens: AuthTokens, user: UserDto): void {
    localStorage.setItem(ACCESS_KEY, tokens.accessToken);
    localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },

  setUser(user: UserDto): void {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },

  clear(): void {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
  },
};
