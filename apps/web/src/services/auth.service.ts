import type {
  ApiResponse,
  AuthSession,
  ChangePasswordRequest,
  CurrentUserDto,
  ForgotPasswordRequest,
  LoginRequest,
  ResetPasswordRequest,
} from '@monhorus/shared';

import { apiClient, unwrap } from '../lib/api-client';

export const authService = {
  async login(payload: LoginRequest): Promise<AuthSession> {
    return unwrap(await apiClient.post<ApiResponse<AuthSession>>('/auth/login', payload));
  },

  async me(): Promise<CurrentUserDto> {
    return unwrap(await apiClient.get<ApiResponse<CurrentUserDto>>('/auth/me'));
  },

  async changePassword(payload: ChangePasswordRequest): Promise<void> {
    await apiClient.post<ApiResponse<null>>('/auth/change-password', payload);
  },

  /**
   * Asks for a reset link.
   *
   * Resolves for an unregistered address exactly as it does for a registered one — the
   * server answers the same either way on purpose, so the caller must not treat a
   * resolution as proof the address exists.
   */
  async forgotPassword(payload: ForgotPasswordRequest): Promise<void> {
    await apiClient.post<ApiResponse<null>>('/auth/forgot-password', payload);
  },

  async resetPassword(payload: ResetPasswordRequest): Promise<void> {
    await apiClient.post<ApiResponse<null>>('/auth/reset-password', payload);
  },

  async logout(refreshToken: string): Promise<void> {
    await apiClient.post<ApiResponse<null>>('/auth/logout', { refreshToken });
  },
};
