import type {
  ApiResponse,
  AuthSession,
  ChangePasswordRequest,
  CurrentUserDto,
  LoginRequest,
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

  async logout(refreshToken: string): Promise<void> {
    await apiClient.post<ApiResponse<null>>('/auth/logout', { refreshToken });
  },
};
