import type { ApiErrorResponse, ApiResponse, AuthSession, FieldIssue } from '@monhorus/shared';
import axios, { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';

import { tokenStorage } from './token-storage';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/v1';

/** Normalised error surface, so every component handles exactly one shape. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly issues: FieldIssue[];

  constructor(message: string, code: string, status: number, issues: FieldIssue[] = []) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.issues = issues;
  }

  /** Field-keyed map for inline form validation messages. */
  get fieldErrors(): Record<string, string> {
    return this.issues.reduce<Record<string, string>>((acc, issue) => {
      if (!acc[issue.field]) acc[issue.field] = issue.message;
      return acc;
    }, {});
  }
}

export const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 20_000,
  headers: { 'Content-Type': 'application/json', 'X-Client-Channel': 'WEB' },
});

// -- Request interceptor: attach the Bearer token -----------------------------

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = tokenStorage.getAccessToken();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

// -- Response interceptor: refresh once on 401, then replay ------------------

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

/** Installed by AuthProvider so a terminal refresh failure can clear React state. */
let onSessionExpired: (() => void) | null = null;

export function setSessionExpiredHandler(handler: () => void): void {
  onSessionExpired = handler;
}

/**
 * Concurrent 401s must not each fire their own refresh. The first owns the refresh;
 * the rest await the same promise and then replay.
 */
let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const refreshToken = tokenStorage.getRefreshToken();
  if (!refreshToken) {
    throw new ApiError('Сессийн хугацаа дууссан.', 'REFRESH_TOKEN_INVALID', 401);
  }

  // Bare axios, not apiClient: this call must skip the interceptors above.
  const response = await axios.post<ApiResponse<AuthSession>>(
    `${BASE_URL}/auth/refresh`,
    { refreshToken },
    { headers: { 'Content-Type': 'application/json' } },
  );

  const session = response.data.data;
  if (!session) {
    throw new ApiError('Сессийн хугацаа дууссан.', 'REFRESH_TOKEN_INVALID', 401);
  }

  tokenStorage.setSession(session.tokens, session.user);
  return session.tokens.accessToken;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiErrorResponse>) => {
    const config = error.config as RetriableConfig | undefined;
    const status = error.response?.status ?? 0;
    const payload = error.response?.data;

    // Never attempt a refresh for the endpoints that mint tokens in the first place.
    const isAuthEndpoint =
      config?.url?.includes('/auth/login') || config?.url?.includes('/auth/refresh');

    if (status === 401 && config && !config._retried && !isAuthEndpoint) {
      config._retried = true;
      try {
        refreshPromise ??= refreshAccessToken().finally(() => {
          refreshPromise = null;
        });
        const newToken = await refreshPromise;
        config.headers.set('Authorization', `Bearer ${newToken}`);
        return await apiClient.request(config);
      } catch {
        tokenStorage.clear();
        onSessionExpired?.();
        return Promise.reject(
          new ApiError(
            'Сессийн хугацаа дууссан. Дахин нэвтэрнэ үү.',
            'REFRESH_TOKEN_INVALID',
            401,
          ),
        );
      }
    }

    if (payload) {
      return Promise.reject(
        new ApiError(payload.message, payload.code, status, payload.issues ?? []),
      );
    }

    if (error.code === 'ECONNABORTED') {
      return Promise.reject(new ApiError('Хүсэлтийн хугацаа дууслаа.', 'TIMEOUT', 0));
    }

    return Promise.reject(new ApiError('Сервертэй холбогдож чадсангүй.', 'NETWORK_ERROR', status));
  },
);

/**
 * Unwraps the envelope so callers work with `T`, not `ApiResponse<T>`.
 *
 * `success` is the only failure signal. A null payload on a successful response is valid
 * data, not an error: the backend uses it to say "nothing here yet", as `GET /floors/:id/plan`
 * does for a floor with no plan image, and `noContent` does for a delete.
 *
 * Treating null as a failure previously turned those into an ApiError carrying the success
 * message, so a floor without a plan reported "Амжилттай." as its error and the whole
 * screen fell back to the error state. Endpoints whose payload is genuinely optional
 * declare it, for example `ApiResponse<FloorPlanDto | null>`, so the nullability stays
 * visible in the type rather than being enforced at runtime here.
 */
export function unwrap<T>(response: { data: ApiResponse<T> }): T {
  const { data } = response;
  if (!data.success) {
    throw new ApiError(data.message, 'INTERNAL_ERROR', 500);
  }
  // `ApiResponse<T>` types `data` as `T | null` because the envelope also carries
  // no-content responses. A successful payload is `T` by contract, and callers whose
  // payload is genuinely optional say so in their own type argument.
  return data.data as T;
}
