import type {
  ApiResponse,
  CancelInvoiceInput,
  CreateInvoiceInput,
  GenerateMonthlyInvoicesInput,
  InvoiceDetailDto,
  InvoiceGenerationPreviewDto,
  InvoiceListItemDto,
  InvoiceListQuery,
  InvoiceSummaryDto,
  PaginatedData,
  RecordInvoicePaymentInput,
  SendInvoiceInput,
  UpdateInvoiceInput,
} from '@monhorus/shared';

import { apiClient, unwrap } from '../lib/api-client';

/** The list carries its own receivables roll-up, so the header needs no second call. */
export type InvoicePage = PaginatedData<InvoiceListItemDto> & { summary: InvoiceSummaryDto };

export interface GenerationResult {
  created: readonly InvoiceListItemDto[];
  skipped: readonly { customerId: string; reason: string }[];
}

function toParams(query: Record<string, unknown>): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params[key] = typeof value === 'boolean' ? String(value) : (value as string | number);
  }
  return params;
}

export const invoiceService = {
  async list(query: InvoiceListQuery = {}): Promise<InvoicePage> {
    return unwrap(
      await apiClient.get<ApiResponse<InvoicePage>>('/invoices', {
        params: toParams(query as Record<string, unknown>),
      }),
    );
  },

  async getById(invoiceId: string): Promise<InvoiceDetailDto> {
    return unwrap(await apiClient.get<ApiResponse<InvoiceDetailDto>>(`/invoices/${invoiceId}`));
  },

  async create(payload: CreateInvoiceInput): Promise<InvoiceDetailDto> {
    return unwrap(await apiClient.post<ApiResponse<InvoiceDetailDto>>('/invoices', payload));
  },

  async update(invoiceId: string, payload: UpdateInvoiceInput): Promise<InvoiceDetailDto> {
    return unwrap(
      await apiClient.patch<ApiResponse<InvoiceDetailDto>>(`/invoices/${invoiceId}`, payload),
    );
  },

  async send(invoiceId: string, payload: SendInvoiceInput = {}): Promise<InvoiceDetailDto> {
    return unwrap(
      await apiClient.post<ApiResponse<InvoiceDetailDto>>(`/invoices/${invoiceId}/send`, payload),
    );
  },

  async recordPayment(
    invoiceId: string,
    payload: RecordInvoicePaymentInput,
  ): Promise<InvoiceDetailDto> {
    return unwrap(
      await apiClient.post<ApiResponse<InvoiceDetailDto>>(
        `/invoices/${invoiceId}/payment`,
        payload,
      ),
    );
  },

  async cancel(invoiceId: string, payload: CancelInvoiceInput): Promise<InvoiceDetailDto> {
    return unwrap(
      await apiClient.post<ApiResponse<InvoiceDetailDto>>(`/invoices/${invoiceId}/cancel`, payload),
    );
  },

  async remove(invoiceId: string): Promise<void> {
    await apiClient.delete(`/invoices/${invoiceId}`);
  },

  async generationPreview(billingPeriod: string): Promise<InvoiceGenerationPreviewDto> {
    return unwrap(
      await apiClient.get<ApiResponse<InvoiceGenerationPreviewDto>>('/invoices/generation-preview', {
        params: { billingPeriod },
      }),
    );
  },

  async generateMonthly(payload: GenerateMonthlyInvoicesInput): Promise<GenerationResult> {
    return unwrap(
      await apiClient.post<ApiResponse<GenerationResult>>('/invoices/generate-monthly', payload),
    );
  },
};
