import type {
  DispatchBoardColumnId,
  ServiceRequestStatus,
  ServiceRequestType,
  SlaState,
} from '../constants/service-request';
import type { EmployeeRefDto } from './employee.types';
import type { PlanPositionDto } from './object-master.types';
import type { ObjectBreadcrumbDto } from './object.types';

export interface ServiceRequestListItemDto {
  id: string;
  requestNumber: string;
  customer: { id: string; name: string } | null;
  project: { id: string; name: string } | null;
  building: { id: string; name: string } | null;
  floor: { id: string; name: string } | null;
  /** The zone (ROOM node) named on the request, when one was chosen. */
  room: { id: string; name: string } | null;
  device: { id: string; name: string } | null;
  /**
   * Optional pin on the floor plan, normalised 0..1 exactly as an object's placement is.
   *
   * Null when the caller named a location but never pointed at a spot, which is the common
   * case. Optional on the type rather than required so a consumer written before pins
   * existed still compiles; the server always sends the field.
   */
  planPosition?: PlanPositionDto | null;
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
  /**
   * Whether this request's conclusion has been approved and is therefore readable.
   *
   * Exists so a client can decide whether to OFFER the conclusion at all. A customer cannot
   * ask for a conclusion's status — `GET /:id/report/customer` answers 404 for anything not
   * approved, precisely so the state of an unapproved one cannot be inferred — so without
   * this flag the portal's only way to find out would be to call that endpoint and show or
   * hide a tab on the strength of an error, which means every request detail screen would
   * fire a request it expects to fail.
   *
   * NOT a proxy for the request's own status: `COMPLETED` is set by a human and live data
   * has a COMPLETED request whose conclusion is still an empty draft. The flag is read from
   * the conclusion itself.
   *
   * Optional on the type for the reason `planPosition` is: a consumer written before this
   * existed still compiles. The server always sends it.
   */
  hasApprovedReport?: boolean;
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
  /** Optional pin on the floor plan. Rejected without `floorId`; independent of `roomId`. */
  planPosition?: PlanPositionDto | null;
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
  /** Stable key from DISPATCH_BOARD_COLUMNS. Not a status: the open column covers two. */
  id: DispatchBoardColumnId;
  /** Every status this column collects, so a consumer never has to re-derive the mapping. */
  statuses: ServiceRequestStatus[];
  label: string;
  total: number;
  items: ServiceRequestListItemDto[];
}

export interface DispatchBoardDto {
  columns: DispatchBoardColumnDto[];
  generatedAt: string;
}
