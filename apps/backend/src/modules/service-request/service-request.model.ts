import {
  SERVICE_REQUEST_STATUSES,
  SERVICE_REQUEST_TYPES,
  type PlanPositionDto,
  type ServiceRequestStatus,
  type ServiceRequestType,
} from '@monhorus/shared';
import { Schema, Types, model, type Model } from 'mongoose';

export interface IServiceRequestStatusHistory {
  _id: Types.ObjectId;
  fromStatus: ServiceRequestStatus | null;
  toStatus: ServiceRequestStatus;
  reason: string | null;
  changedBy: Types.ObjectId | null;
  changedByName: string | null;
  changedAt: Date;
}

export interface IServiceRequest {
  requestNumber: string;

  customer: Types.ObjectId;
  branch: string | null;
  project: Types.ObjectId | null;
  building: Types.ObjectId;
  floor: Types.ObjectId | null;
  room: Types.ObjectId | null;
  panel: Types.ObjectId | null;
  circuit: Types.ObjectId | null;
  device: Types.ObjectId | null;

  /**
   * Where on the floor's plan image the problem is, normalised to 0..1 of the drawing's
   * width and height — the same convention, and the same shape, an object's placement uses.
   *
   * Meaningless without `floor`, since there is no drawing to point at, and deliberately
   * independent of `room`: a caller may know the spot without a zone having been named.
   */
  planPosition: PlanPositionDto | null;

  requestType: ServiceRequestType;
  isUrgent: boolean;
  description: string;
  contactName: string;
  contactPhone: string;
  attachments: Types.ObjectId[];

  status: ServiceRequestStatus;
  assignedEmployees: Types.ObjectId[];
  assignedTeam: Types.ObjectId | null;
  teamLeaderEmployee: Types.ObjectId | null;

  /** SLA clock starts when the request is created (requirements 8.4 STARTED). */
  slaStartedAt: Date;
  slaDueAt: Date;
  slaExtendedMinutes: number;
  slaExtensionReason: string | null;
  completedAt: Date | null;

  revisitReason: string | null;
  revisitDueAt: Date | null;
  parentRequest: Types.ObjectId | null;

  statusHistory: IServiceRequestStatusHistory[];

  /**
   * When this request most recently entered the open, unassigned queue.
   *
   * The trigger for the two-hour scheduling alert, and re-stamped every time the request
   * returns to that queue — an assignment that is later withdrawn starts a NEW interval,
   * so the second spell in the queue is alerted on its own merits rather than being
   * suppressed because the first one already was. Null whenever the request is not open.
   */
  openedForClaimAt: Date | null;
  /**
   * The value of `openedForClaimAt` the unclaimed alert last fired for.
   *
   * Comparing the two is what makes the job rerun-safe AND once-per-interval with one
   * field: equal means this spell has been alerted, different (or null) means it has not.
   * A boolean flag could not tell a re-opened request from an already-notified one.
   */
  unclaimedNotifiedFor: Date | null;

  /**
   * The `slaDueAt` each SLA warning has already been sent for.
   *
   * Staked against the deadline rather than a boolean because `slaDueAt` is mutable: the
   * extension path recomputes it. A request whose deadline moves is therefore a request
   * that can be warned about again, which is the desired behaviour — the old warning was
   * about a deadline that no longer exists.
   */
  slaNearBreachNotifiedFor: Date | null;
  slaBreachNotifiedFor: Date | null;

  createdBy: Types.ObjectId | null;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const statusHistorySchema = new Schema<IServiceRequestStatusHistory>(
  {
    fromStatus: { type: String, enum: [...SERVICE_REQUEST_STATUSES, null], default: null },
    toStatus: { type: String, enum: SERVICE_REQUEST_STATUSES, required: true },
    reason: { type: String, default: null, maxlength: 1000 },
    changedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    changedByName: { type: String, default: null },
    changedAt: { type: Date, required: true, default: () => new Date() },
  },
  { _id: true },
);

/**
 * The pin, bounded here as well as in the shared schema.
 *
 * The service is not the only writer of a request document — the seed script and any future
 * migration write it directly — and a coordinate outside the drawing is unusable.
 */
const planPositionSchema = new Schema<PlanPositionDto>(
  {
    x: { type: Number, required: true, min: 0, max: 1 },
    y: { type: Number, required: true, min: 0, max: 1 },
  },
  { _id: false },
);

const serviceRequestSchema = new Schema<IServiceRequest>(
  {
    requestNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },

    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    branch: { type: String, default: null, trim: true, maxlength: 200 },
    project: { type: Schema.Types.ObjectId, ref: 'ObjectNode', default: null, index: true },
    building: { type: Schema.Types.ObjectId, ref: 'ObjectNode', required: true, index: true },
    floor: { type: Schema.Types.ObjectId, ref: 'ObjectNode', default: null },
    room: { type: Schema.Types.ObjectId, ref: 'ObjectNode', default: null },
    panel: { type: Schema.Types.ObjectId, ref: 'ObjectNode', default: null },
    circuit: { type: Schema.Types.ObjectId, ref: 'ObjectNode', default: null },
    device: { type: Schema.Types.ObjectId, ref: 'ObjectNode', default: null },
    planPosition: { type: planPositionSchema, default: null },

    requestType: { type: String, enum: SERVICE_REQUEST_TYPES, required: true, index: true },
    isUrgent: { type: Boolean, default: false, index: true },
    description: { type: String, required: true, trim: true, maxlength: 4000 },
    contactName: { type: String, required: true, trim: true, maxlength: 200 },
    contactPhone: { type: String, required: true, trim: true, maxlength: 24 },
    attachments: { type: [{ type: Schema.Types.ObjectId, ref: 'StoredFile' }], default: [] },

    status: { type: String, enum: SERVICE_REQUEST_STATUSES, default: 'NEW', index: true },
    assignedEmployees: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Employee' }],
      default: [],
      index: true,
    },
    assignedTeam: { type: Schema.Types.ObjectId, ref: 'Team', default: null, index: true },
    teamLeaderEmployee: { type: Schema.Types.ObjectId, ref: 'Employee', default: null },

    slaStartedAt: { type: Date, required: true },
    slaDueAt: { type: Date, required: true, index: true },
    slaExtendedMinutes: { type: Number, default: 0, min: 0 },
    slaExtensionReason: { type: String, default: null, maxlength: 1000 },
    completedAt: { type: Date, default: null },

    revisitReason: { type: String, default: null, maxlength: 1000 },
    revisitDueAt: { type: Date, default: null },
    parentRequest: { type: Schema.Types.ObjectId, ref: 'ServiceRequest', default: null },

    statusHistory: { type: [statusHistorySchema], default: [] },

    openedForClaimAt: { type: Date, default: null },
    unclaimedNotifiedFor: { type: Date, default: null },
    slaNearBreachNotifiedFor: { type: Date, default: null },
    slaBreachNotifiedFor: { type: Date, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    createdByName: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);

/**
 * The two statuses that mean "nobody has this yet".
 *
 * Defined on the model rather than in the claim service because the claim path, the sweep
 * and the status-change path all need it — and importing it from the claim service made
 * `claim.service -> service-request.service -> claim.service` a cycle, which left the
 * constant `undefined` at module-init time in whichever file lost the race. The sweep then
 * matched no statuses at all and silently notified nobody.
 */
export const CLAIMABLE_STATUSES = ['NEW', 'UNASSIGNED'] as const;

// Dispatch board: group by status, newest first.
serviceRequestSchema.index({ status: 1, createdAt: -1 });
// The unclaimed sweep, which reads only rows that are open and due an alert. Sparse
// because the overwhelming majority of requests are assigned and carry no open stamp.
serviceRequestSchema.index({ openedForClaimAt: 1 }, { sparse: true });
// SLA sweep for the dashboard breach counters.
serviceRequestSchema.index({ slaDueAt: 1, status: 1 });
// Customer-scoped list.
serviceRequestSchema.index({ customer: 1, status: 1, createdAt: -1 });
// Serves the dashboard's user-built breakdowns, whose headline question is "which building
// did the last N days of requests come from". Without it that grouping scans by date alone.
serviceRequestSchema.index({ building: 1, createdAt: -1 });

export const ServiceRequest: Model<IServiceRequest> = model<IServiceRequest>(
  'ServiceRequest',
  serviceRequestSchema,
);

/**
 * Generates the next request number in the form SR-YYYYMM-NNNN.
 *
 * Counting existing documents in the month is acceptable at V1 volumes and keeps the
 * schema free of a counter collection. If concurrent creation ever produces a
 * collision the unique index rejects it, and the caller retries.
 */
export async function nextRequestNumber(now: Date = new Date()): Promise<string> {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const prefix = `SR-${year}${month}-`;

  const latest = await ServiceRequest.findOne({ requestNumber: new RegExp(`^${prefix}`) })
    .sort({ requestNumber: -1 })
    .select('requestNumber')
    .lean();

  const lastSequence = latest ? Number.parseInt(latest.requestNumber.slice(prefix.length), 10) : 0;
  const next = Number.isFinite(lastSequence) ? lastSequence + 1 : 1;

  return `${prefix}${String(next).padStart(4, '0')}`;
}
