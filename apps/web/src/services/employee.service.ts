import type {
  ApiResponse,
  ChangeEmployeeStatusInput,
  CreateEmployeeInput,
  EmployeeCertificatePayloadDto,
  EmployeeDetailDto,
  EmployeeDocumentDto,
  EmployeeListItemDto,
  EmployeeListQuery,
  EmployeeSalaryDto,
  EmployeeSalaryInput,
  EmployeeSystemAccessDto,
  LinkSystemAccessInput,
  PaginatedData,
  SystemAccessActionInput,
  UpdateEmployeeInput,
  UpdateSystemAccessRolesInput,
} from '@monhorus/shared';

import { apiClient, unwrap } from '../lib/api-client';

export const employeeService = {
  async list(query: EmployeeListQuery = {}): Promise<PaginatedData<EmployeeListItemDto>> {
    return unwrap(
      await apiClient.get<ApiResponse<PaginatedData<EmployeeListItemDto>>>('/employees', {
        params: query,
      }),
    );
  },

  async getById(employeeId: string): Promise<EmployeeDetailDto> {
    return unwrap(
      await apiClient.get<ApiResponse<EmployeeDetailDto>>(`/employees/${employeeId}`),
    );
  },

  async create(payload: CreateEmployeeInput): Promise<EmployeeDetailDto> {
    return unwrap(await apiClient.post<ApiResponse<EmployeeDetailDto>>('/employees', payload));
  },

  async update(employeeId: string, payload: UpdateEmployeeInput): Promise<EmployeeDetailDto> {
    return unwrap(
      await apiClient.patch<ApiResponse<EmployeeDetailDto>>(`/employees/${employeeId}`, payload),
    );
  },

  async changeStatus(
    employeeId: string,
    payload: ChangeEmployeeStatusInput,
  ): Promise<EmployeeDetailDto> {
    return unwrap(
      await apiClient.post<ApiResponse<EmployeeDetailDto>>(
        `/employees/${employeeId}/status`,
        payload,
      ),
    );
  },

  async salaryHistory(employeeId: string): Promise<EmployeeSalaryDto[]> {
    return unwrap(
      await apiClient.get<ApiResponse<EmployeeSalaryDto[]>>(`/employees/${employeeId}/salary`),
    );
  },

  async saveSalary(employeeId: string, payload: EmployeeSalaryInput): Promise<EmployeeSalaryDto> {
    return unwrap(
      await apiClient.post<ApiResponse<EmployeeSalaryDto>>(
        `/employees/${employeeId}/salary`,
        payload,
      ),
    );
  },

  /** Creates or links the login that lets this employee into the system. */
  async manageSystemAccess(
    employeeId: string,
    payload: LinkSystemAccessInput,
  ): Promise<EmployeeSystemAccessDto> {
    return unwrap(
      await apiClient.post<ApiResponse<EmployeeSystemAccessDto>>(
        `/employees/${employeeId}/system-access`,
        payload,
      ),
    );
  },

  async updateSystemAccessRoles(
    employeeId: string,
    payload: UpdateSystemAccessRolesInput,
  ): Promise<EmployeeSystemAccessDto> {
    return unwrap(
      await apiClient.patch<ApiResponse<EmployeeSystemAccessDto>>(
        `/employees/${employeeId}/system-access/roles`,
        payload,
      ),
    );
  },

  async suspendSystemAccess(
    employeeId: string,
    payload: SystemAccessActionInput,
  ): Promise<EmployeeSystemAccessDto> {
    return unwrap(
      await apiClient.post<ApiResponse<EmployeeSystemAccessDto>>(
        `/employees/${employeeId}/system-access/suspend`,
        payload,
      ),
    );
  },

  async restoreSystemAccess(
    employeeId: string,
    payload: SystemAccessActionInput,
  ): Promise<EmployeeSystemAccessDto> {
    return unwrap(
      await apiClient.post<ApiResponse<EmployeeSystemAccessDto>>(
        `/employees/${employeeId}/system-access/restore`,
        payload,
      ),
    );
  },

  async revokeSystemAccess(
    employeeId: string,
    payload: SystemAccessActionInput,
  ): Promise<EmployeeSystemAccessDto> {
    return unwrap(
      await apiClient.post<ApiResponse<EmployeeSystemAccessDto>>(
        `/employees/${employeeId}/system-access/revoke`,
        payload,
      ),
    );
  },

  async documents(employeeId: string): Promise<EmployeeDocumentDto[]> {
    return unwrap(
      await apiClient.get<ApiResponse<EmployeeDocumentDto[]>>(`/employees/${employeeId}/documents`),
    );
  },

  /** Multipart upload; the browser sets the boundary so Content-Type is left unset. */
  async uploadDocument(employeeId: string, form: FormData): Promise<EmployeeDocumentDto> {
    return unwrap(
      await apiClient.post<ApiResponse<EmployeeDocumentDto>>(
        `/employees/${employeeId}/documents`,
        form,
      ),
    );
  },

  async deleteDocument(employeeId: string, documentId: string): Promise<void> {
    await apiClient.delete<ApiResponse<{ id: string }>>(
      `/employees/${employeeId}/documents/${documentId}`,
    );
  },

  async certificate(employeeId: string): Promise<EmployeeCertificatePayloadDto> {
    return unwrap(
      await apiClient.get<ApiResponse<EmployeeCertificatePayloadDto>>(
        `/employees/${employeeId}/certificate`,
      ),
    );
  },
};
