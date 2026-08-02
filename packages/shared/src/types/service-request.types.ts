import type {
  ServiceRequestStatus,
  ServiceRequestType,
  SlaState,
} from '../constants/service-request';
import type { EmployeeRefDto } from './employee.types';
import type { ObjectBreadcrumbDto } from './object.types';

export interface ServiceRequestListItemDto {
  id: string;
  requestNumber: string;
  customer: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
  building: { id: string; name: string } | null;
  floor: { id: string; name: string } | null;
  room: { id: string; name: string } | null;
  device: { id: string; name: string } | null;
  requestType: ServiceRequestType;
  isUrgent: boolean;
  status: ServiceRequestStatus;
  assignedEmployees: EmployeeRefDto[];
  assignedTeam: { id: string; name: string } | null;
  createdAt: string;
  slaDueAt: string | null;
  slaState: SlaState;
  /** Backend-computed. Negative means overdue. Frontend may re-derive a countdown. */
  slaRemainingMinutes: number | null;
}

export interface ServiceRequestAttachmentDto {
  id: string;
  name: string;
  downloadUrl: string;
  mimeType: string;
  sizeBytes: number;
  uploadedByName: string | null;
  uploadedAt: string;
}

export interface ServiceRequestStatusHistoryDto {
  id: string;
  fromStatus: ServiceRequestStatus | null;
  toStatus: ServiceRequestStatus;
  reason: string | null;
  changedByName: string | null;
  changedAt: string;
}

export interface ServiceRequestDetailDto extends ServiceRequestListItemDto {
  panel: { id: string; name: string } | null;
  circuit: { id: string; name: string } | null;
  branch: string | null;
  description: string;
  contactName: string;
  contactPhone: string;
  attachments: ServiceRequestAttachmentDto[];
  statusHistory: ServiceRequestStatusHistoryDto[];
  locationPath: ObjectBreadcrumbDto[];
  teamLeaderEmployeeId: string | null;
  slaStartedAt: string | null;
  slaExtendedMinutes: number;
  slaExtensionReason: string | null;
  revisitReason: string | null;
  revisitDueAt: string | null;
  parentRequestId: string | null;
  createdByName: string | null;
  updatedAt: string;
}

export interface ServiceRequestListQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: ServiceRequestStatus;
  requestType?: ServiceRequestType;
  isUrgent?: boolean;
  slaState?: SlaState;
  customerId?: string;
  projectId?: string;
  buildingId?: string;
  employeeId?: string;
  teamId?: string;
  createdFrom?: string;
  createdTo?: string;
  sortBy?: 'createdAt' | 'slaDueAt' | 'requestNumber';
  sortDir?: 'asc' | 'desc';
}

export interface CreateServiceRequestRequest {
  customerId: string;
  branch?: string | null;
  projectId?: string | null;
  buildingId: string;
  floorId?: string | null;
  roomId?: string | null;
  panelId?: string | null;
  circuitId?: string | null;
  deviceId?: string | null;
  requestType: ServiceRequestType;
  isUrgent: boolean;
  description: string;
  contactName: string;
  contactPhone: string;
  attachmentIds?: string[];
}

export interface AssignServiceRequestRequest {
  employeeIds: string[];
  teamId?: string | null;
  teamLeaderEmployeeId?: string | null;
  note?: string;
}

export interface ChangeServiceRequestStatusRequest {
  status: ServiceRequestStatus;
  reason?: string;
}

export interface ExtendSlaRequest {
  additionalMinutes: number;
  reason: string;
}

export interface DispatchBoardColumnDto {
  status: ServiceRequestStatus;
  total: number;
  items: ServiceRequestListItemDto[];
}

export interface DispatchBoardDto {
  columns: DispatchBoardColumnDto[];
  generatedAt: string;
}
