import type {
  ApiResponse,
  ChangeAgreementStatusInput,
  CreateServiceAgreementInput,
  ServiceAgreementDto,
  UpdateServiceAgreementInput,
} from '@monhorus/shared';

import { apiClient, unwrap } from '../lib/api-client';

export const serviceAgreementService = {
  async listForCustomer(customerId: string): Promise<ServiceAgreementDto[]> {
    return unwrap(
      await apiClient.get<ApiResponse<ServiceAgreementDto[]>>('/service-agreements', {
        params: { customerId },
      }),
    );
  },

  async create(payload: CreateServiceAgreementInput): Promise<ServiceAgreementDto> {
    return unwrap(
      await apiClient.post<ApiResponse<ServiceAgreementDto>>('/service-agreements', payload),
    );
  },

  async update(
    agreementId: string,
    payload: UpdateServiceAgreementInput,
  ): Promise<ServiceAgreementDto> {
    return unwrap(
      await apiClient.patch<ApiResponse<ServiceAgreementDto>>(
        `/service-agreements/${agreementId}`,
        payload,
      ),
    );
  },

  async changeStatus(
    agreementId: string,
    payload: ChangeAgreementStatusInput,
  ): Promise<ServiceAgreementDto> {
    return unwrap(
      await apiClient.post<ApiResponse<ServiceAgreementDto>>(
        `/service-agreements/${agreementId}/status`,
        payload,
      ),
    );
  },
};
