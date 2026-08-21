import type {
  DispatchBoardColumnId,
  ServiceRequestStatus,
  SlaState,
} from '../constants/service-request';
import type { StageColour } from '../constants/service-request-stage';
import type { EmployeeRefDto } from './employee.types';
import type { PlanPositionDto } from './object-master.types';
import type { ObjectBreadcrumbDto } from './object.types';

/** The stage a request is shown under: stable key, administrator's name, palette colour. */
export interface ServiceRequestStageRefDto {
  key: string;
  label: string;
  colour: StageColour;
}

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
  isUrgent: boolean;
  status: ServiceRequestStatus;
  /**
   * The stage the status belongs to, resolved by the server from the configured grouping.
   *
   * Sent alongside `status`, never instead of it: the raw status is what the engine and
   * the audit trail speak, while the stage is what a screen should show. A client that
   * renders `status` directly will disagree with the administrator's naming, which is the
   * whole reason this field exists.
   *
   * Optional on the type so a client written before stages existed still compiles; the
   * server always sends it.
   */
  stage?: ServiceRequestStageRefDto | null;
  assignedEmployees: EmployeeRefDto[];
  assignedTeam: { id: string; name: string } | null;
  /**
   * Who created the record, resolved to a display name.
   *
   * Null where it is not known: rows created before the creator was recorded, and
   * records the system itself made. The screen renders that as a dash rather than
   * guessing, because an absent creator is a real answer here.
   */
  createdByName: string | null;
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
  /** A stage key; the server expands it to that stage's statuses. `status` wins if both. */
  stage?: string;
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
  /**
   * The stage key this column shows. Not a status: a stage covers one or more of them,
   * and which ones is the administrator's configuration, not a constant.
   */
  id: string;
  /** Every status this column collects, so a consumer never has to re-derive the mapping. */
  statuses: ServiceRequestStatus[];
  label: string;
  /** Palette colour for the column heading, from the stage configuration. */
  colour?: StageColour;
  total: number;
  items: ServiceRequestListItemDto[];
}

export interface DispatchBoardDto {
  columns: DispatchBoardColumnDto[];
  generatedAt: string;
}

/**
 * One option in a call form's equipment-type picker.
 *
 * Deliberately not `ObjectTypeDto`: a picker needs a label, a value, and the window the
 * choice implies. The rest of a catalogue row is administrative data that a customer-portal
 * account should not receive merely to fill in a dropdown.
 */
export interface CallableObjectTypeDto {
  id: string;
  name: string;
  /** Hours. What the call's deadline will be set from, and worth showing beside the name. */
  callSlaHours: number;
}
