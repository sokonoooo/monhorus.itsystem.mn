import type {
  ApiResponse,
  CreateUserRequest,
  CreateUserResponse,
  ListUsersQuery,
  PaginatedData,
  ResetPasscodeRequest,
  ResetPasscodeResponse,
  UpdateUserRequest,
  UpdateUserStatusRequest,
  UserDto,
} from '@monhorus/shared';

import { apiClient, unwrap } from '../lib/api-client';

export const userService = {
  async list(query: ListUsersQuery = {}): Promise<PaginatedData<UserDto>> {
    return unwrap(
      await apiClient.get<ApiResponse<PaginatedData<UserDto>>>('/users', { params: query }),
    );
  },

  async getById(userId: string): Promise<UserDto> {
    return unwrap(await apiClient.get<ApiResponse<UserDto>>(`/users/${userId}`));
  },

  async create(payload: CreateUserRequest): Promise<CreateUserResponse> {
    return unwrap(await apiClient.post<ApiResponse<CreateUserResponse>>('/users', payload));
  },

  async resetPasscode(
    userId: string,
    payload: ResetPasscodeRequest,
  ): Promise<ResetPasscodeResponse> {
    return unwrap(
      await apiClient.post<ApiResponse<ResetPasscodeResponse>>(
        `/users/${userId}/reset-passcode`,
        payload,
      ),
    );
  },

  /**
   * Edits an account, including the customer organisation it is scoped to. Omitting
   * `customerId` keeps the current link; the server refuses to leave a customer unlinked.
   */
  async update(userId: string, payload: UpdateUserRequest): Promise<UserDto> {
    return unwrap(await apiClient.patch<ApiResponse<UserDto>>(`/users/${userId}`, payload));
  },

  async updateStatus(userId: string, payload: UpdateUserStatusRequest): Promise<UserDto> {
    return unwrap(await apiClient.patch<ApiResponse<UserDto>>(`/users/${userId}/status`, payload));
  },
};
