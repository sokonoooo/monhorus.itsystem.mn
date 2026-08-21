import {
  SERVICE_REQUEST_STATUSES,
  SERVICE_REQUEST_STATUS_LABELS,
  SERVICE_REQUEST_TRANSITIONS,
  type ServiceRequestStatus,
} from '@monhorus/shared';
import { Types } from 'mongoose';

import { notify } from '../notification/notification.service';
import { userIdsForEmployees } from '../notification/recipient.util';
import { ObjectNode } from '../objects/object.models';
import { ServiceRequest } from './service-request.model';

/**
 * WHO HEARS ABOUT A SERVICE REQUEST, decided in one place.
 *
 * A status change has two call sites — the manual one in `service-request.service.ts` and
 * the conclusion-driven one in `service-request.auto-status.ts` — and each used to carry
 * its own copy of the recipient decision. From a recipient's point of view the two are the
 * same event ("my job moved"), so a copy that drifts is a bug nobody notices until somebody
 * is not told. Keeping the decision here makes drift impossible.
 *
 * THIS MODULE IS A LEAF. It imports the notification writer, the request model and the
 * shared vocabulary, and nothing from the service layer — so neither caller closes an
 * import cycle through it. That is the same constraint `service-request.auto-status.ts`
 * documents for itself, for the same reason.
 */

/** Staff read the admin console; a portal account cannot open that path at all. */
function staffLink(requestId: Types.ObjectId): string {
  return `/service-requests/${String(requestId)}`;
}

function portalLink(requestId: Types.ObjectId): string {
  return `/portal/requests/${String(requestId)}`;
}

/**
 * The parts of a request every notifier here needs.
 *
 * Structural rather than the model type, so a caller can hand over a value it has
 * deliberately assembled — `changeServiceRequestStatus` passes the assignment as it stood
 * when the request moved, which is not always what the document holds by the time it saves.
 */
export interface NotifiableRequest {
  _id: Types.ObjectId;
  requestNumber: string;
  customer: Types.ObjectId;
  assignedEmployees: readonly Types.ObjectId[];
}

/**
 * What a customer is told when their request reaches a given status, and nothing else.
 *
 * THE LINE IS DRAWN AT "does this change what the customer should expect or do next?".
 * A request moves through fourteen states, but most of them are our own bookkeeping, and a
 * customer whose phone buzzes fourteen times per fault stops reading any of them — which
 * costs us the two that actually matter.
 *
 * Included, each because it changes something on the customer's side of the door:
 *   - ON_THE_WAY and ON_SITE are the highest-value moments in field service. Somebody has
 *     to unlock a door, meet the technician, clear the area or move a car; this is the
 *     notification a customer otherwise telephones the office to ask for.
 *   - CANCELLED is terminal. Nothing further will ever be sent about this request and the
 *     "шийдэгдлээ" message will never come, so silence here leaves a customer waiting
 *     indefinitely for work that is not going to happen.
 *
 * Excluded, each for its own reason rather than by omission:
 *   - COMPLETED — the customer is already told, once, by `notifyCustomerResolved` in
 *     `service-request.auto-status.ts`, which names the building and the conclusion.
 *     Adding it here would send two notifications for one event.
 *   - NEW, UNASSIGNED, ASSIGNED, RETURNED, REVISIT_REQUIRED — dispatch decisions. Who does
 *     the job, and how many attempts it takes us, is our problem; the customer hears
 *     "somebody is handling it" once, from the assignment path.
 *   - ACCEPTED and IN_PROGRESS — steps inside our own workflow that say nothing
 *     ON_THE_WAY does not say better, and sooner.
 *   - WAITING — the honest explanation is its `reason`, which is internal free text that
 *     `narrowDetailForCustomer` strips out of the timeline on purpose. A bare
 *     "Түр хүлээгдсэн" would alarm without informing.
 *   - REPORT_SUBMITTED and VERIFICATION — our paperwork and our sign-off.
 *
 * The map is the single source of truth: a status is customer-visible exactly when it has
 * wording here, so the set and the text can never disagree.
 */
const CUSTOMER_STATUS_MESSAGES: Partial<
  Record<ServiceRequestStatus, { title: string; body: string }>
> = {
  ON_THE_WAY: {
    title: 'хүсэлтэд ажилтан замдаа гарлаа',
    body: 'Хариуцах ажилтан таны байршил руу замдаа гарлаа.',
  },
  ON_SITE: {
    title: 'хүсэлтэд ажилтан ирлээ',
    body: 'Хариуцах ажилтан таны байршилд хүрэлцэн ирлээ.',
  },
  CANCELLED: {
    title: 'хүсэлт цуцлагдлаа',
    body: 'Таны хүсэлт цуцлагдсан тул ажил гүйцэтгэхгүй. Дэлгэрэнгүйг хүсэлтийн мэдээллээс харна уу.',
  },
};

/** Exposed for tests, so the chosen set is asserted rather than re-derived by eye. */
export function isCustomerVisibleStatus(status: ServiceRequestStatus): boolean {
  return CUSTOMER_STATUS_MESSAGES[status] !== undefined;
}

/**
 * The statuses a request can never leave, derived rather than listed.
 *
 * COMPLETED and CANCELLED are today's answer, and `SERVICE_REQUEST_TRANSITIONS` already
 * says so by giving them no outbound moves. Reading it from there means a status that
 * becomes terminal later is picked up here without anybody remembering to come back.
 */
const FINISHED_STATUSES: readonly ServiceRequestStatus[] = SERVICE_REQUEST_STATUSES.filter(
  (status) => SERVICE_REQUEST_TRANSITIONS[status].length === 0,
);

/**
 * Announces that a request has moved, to the people the move actually concerns.
 *
 * WHAT WAS WRONG BEFORE. Both call sites addressed `permission: 'service_request.view'` and
 * nothing else. TECHNICIAN holds that key, so every technician in the company was told
 * about every status change on every request in the company — while the technician actually
 * assigned to the job was never addressed as such, and only heard about their own work by
 * being caught in the same net as everybody else. The customer heard nothing at all.
 *
 * WHAT IT IS NOW. The assignees are named through `userIds`, which is what makes narrowing
 * the permission fan-out to `dispatch.view` safe: the field hears about its own work
 * because it is assigned to it, not because it happens to hold a read key. `dispatch.view`
 * is the desk that owns the flow of a request — DISPATCH, MANAGEMENT and ADMIN by default,
 * plus head_admin unconditionally — and is the same audience a NEW call already goes to.
 */
export async function notifyStatusChanged(input: {
  request: NotifiableRequest;
  to: ServiceRequestStatus;
  /** The internal reason, for the staff line only. Never shown to a customer. */
  reason?: string | null;
  actorUserId: string;
}): Promise<void> {
  const { request, to } = input;

  await notify({
    event: 'SERVICE_REQUEST_STATUS_CHANGED',
    title: `${request.requestNumber} төлөв "${SERVICE_REQUEST_STATUS_LABELS[to]}" боллоо`,
    body: input.reason ?? null,
    entityType: 'Work',
    entityId: request._id,
    linkPath: staffLink(request._id),
    permission: 'dispatch.view',
    userIds: await userIdsForEmployees(request.assignedEmployees.map(String)),
    excludeUserId: input.actorUserId,
  });

  const message = CUSTOMER_STATUS_MESSAGES[to];
  if (!message) return;

  /*
   * A SECOND notification rather than another recipient on the first.
   *
   * The two audiences need different words and different links. The staff line carries the
   * internal `reason` and points into the admin console, which a portal account cannot
   * open — following it would earn the customer a permission refusal, which is a worse
   * answer than no link at all.
   *
   * No `excludeUserId`: the customer channel is addressed to an organisation, not to a
   * person, and every status that reaches this point is moved by staff.
   */
  await notify({
    event: 'SERVICE_REQUEST_STATUS_CHANGED',
    title: `${request.requestNumber} ${message.title}`,
    body: message.body,
    entityType: 'Work',
    entityId: request._id,
    linkPath: portalLink(request._id),
    customerId: request.customer,
  });
}

/**
 * Confirms to the customer that we have their request.
 *
 * NOT EXCLUDED: the person who submitted it. Everywhere else the house rule is that telling
 * somebody about the thing they just did is noise, but this one is a receipt rather than
 * news — it carries the request number, which is minted server-side and is what the caller
 * will quote when they follow it up. Excluding the submitter would also silence the whole
 * feature for the common case of an organisation with a single portal account.
 */
export async function notifyCustomerRequestReceived(request: NotifiableRequest): Promise<void> {
  await notify({
    event: 'SERVICE_REQUEST_CREATED',
    title: `${request.requestNumber} хүсэлт бүртгэгдлээ`,
    body: 'Таны хүсэлтийг хүлээн авлаа. Ажилтан хуваарилагдмагц мэдэгдэнэ.',
    entityType: 'Work',
    entityId: request._id,
    linkPath: portalLink(request._id),
    customerId: request.customer,
  });
}

/**
 * Tells the customer that somebody is now on their request.
 *
 * THE EMPLOYEE IS NAMED, and that is checked rather than assumed: `narrowDetailForCustomer`
 * keeps `firstName` and `lastName` on every assigned employee and blanks only the internal
 * `employeeCode`, so a customer already reads these names on their own request screen.
 * Withholding them here would be a privacy gesture the rest of the portal does not make,
 * while costing the customer the one fact that lets them recognise who knocks on the door.
 * If that decision is ever reversed, it must be reversed in both places.
 */
export async function notifyCustomerAssigned(
  request: NotifiableRequest,
  employeeNames: readonly string[],
  isReassignment: boolean,
): Promise<void> {
  await notify({
    event: isReassignment ? 'SERVICE_REQUEST_REASSIGNED' : 'SERVICE_REQUEST_ASSIGNED',
    title: `${request.requestNumber} хүсэлтэд ажилтан хуваарилагдлаа`,
    body:
      employeeNames.length > 0
        ? `Хариуцах ажилтан: ${employeeNames.join(', ')}.`
        : // A team was assigned without naming its members; the schema guarantees one or
          // the other, so there is always somebody, even when we cannot name them yet.
          'Таны хүсэлтийг гүйцэтгэх баг томилогдлоо.',
    entityType: 'Work',
    entityId: request._id,
    linkPath: portalLink(request._id),
    customerId: request.customer,
  });
}

/**
 * Tells whoever is already working at a building that another call has come in for it.
 *
 * WHY IT IS WORTH A NOTIFICATION OF ITS OWN. A technician standing in a building is the
 * cheapest person in the company to send to a second fault in that same building: no
 * travel, and they are already through the door and past reception. Nothing surfaced that
 * coincidence before, so the second call went back into the queue and was dispatched as if
 * the site were empty.
 *
 * WHO IS ADDRESSED, and who is not. Only the employees assigned to the OPEN requests at
 * that building — the whole value of the message is "you are already there", which is untrue
 * of anybody else, so there is no permission fan-out here at all. If the open requests carry
 * no assignee, nobody is on site and nothing is sent: an unassigned request at the same
 * building is a queue entry, not a person.
 *
 * The link points at the NEW request, because that is the thing being offered.
 */
export async function notifySiteBusy(
  request: {
    _id: Types.ObjectId;
    requestNumber: string;
    building: Types.ObjectId;
    description: string;
  },
  actorUserId: string,
): Promise<void> {
  const openAtSite = await ServiceRequest.find({
    building: request.building,
    // The request that triggered this is obviously at its own building.
    _id: { $ne: request._id },
    status: { $nin: FINISHED_STATUSES },
    // Cheaper than loading every open request and filtering in memory, and it states the
    // condition that actually matters: somebody is on it.
    'assignedEmployees.0': { $exists: true },
  })
    .select('assignedEmployees')
    .lean();

  // One message per person, not per matching request. Somebody holding three open jobs in
  // the same tower is one technician who could take the new call, not three.
  const employeeIds = new Set<string>();
  for (const open of openAtSite) {
    for (const employeeId of open.assignedEmployees) employeeIds.add(String(employeeId));
  }
  if (employeeIds.size === 0) return;

  const userIds = await userIdsForEmployees([...employeeIds]);
  if (userIds.length === 0) return;

  // Looked up only once there is somebody to tell, so the ordinary case of a quiet building
  // costs the single query above and nothing more. The name matters because a technician
  // may hold open work at several sites and the point of the message is WHICH one.
  const building = await ObjectNode.findById(request.building).select('name').lean();
  const where = building?.name ? `${building.name}. ` : '';

  await notify({
    event: 'SERVICE_REQUEST_SITE_BUSY',
    title: `${request.requestNumber} — ажиллаж буй байршилд шинэ дуудлага`,
    body: `${where}${request.description}`.slice(0, 300),
    entityType: 'Work',
    entityId: request._id,
    linkPath: staffLink(request._id),
    userIds,
    excludeUserId: actorUserId,
  });
}
