import type { ServiceAgreementStatus, ServiceFrequency } from '../constants/service-agreement';

/** Requirements 6.2 field list, one to one. */
export interface ServiceAgreementDto {
  id: string;
  agreementNumber: string;
  customerId: string;
  customerName: string;
  startDate: string;
  endDate: string;
  serviceType: string;
  /** Requirements 6.2 SLA: urgent and standard hours per agreement. */
  slaUrgentHours: number;
  slaStandardHours: number;
  frequency: ServiceFrequency | null;
  calendarRule: string | null;
  monthlyFee: number;
  currency: string;
  responsibleEmployeeId: string | null;
  responsibleEmployeeName: string | null;
  status: ServiceAgreementStatus;
  statusReason: string | null;
  attachmentIds: string[];
  notes: string | null;
  /**
   * Who created the record, resolved to a display name.
   *
   * Null where it is not known: rows created before the creator was recorded, and
   * records the system itself made. The screen renders that as a dash rather than
   * guessing, because an absent creator is a real answer here.
   */
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateServiceAgreementRequest {
  customerId: string;
  agreementNumber?: string;
  startDate: string;
  endDate: string;
  serviceType: string;
  slaUrgentHours?: number;
  slaStandardHours?: number;
  frequency?: ServiceFrequency | null;
  calendarRule?: string | null;
  monthlyFee: number;
  responsibleEmployeeId?: string | null;
  notes?: string | null;
}

export interface ChangeAgreementStatusRequest {
  status: ServiceAgreementStatus;
  reason?: string;
}
