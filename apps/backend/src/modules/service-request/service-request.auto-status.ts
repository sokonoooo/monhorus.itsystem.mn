import { canTransition, type ServiceRequestStatus } from '@monhorus/shared';
import { Types } from 'mongoose';

import type { AuthContext } from '../../common/types/express';
import { logger } from '../../config/logger';
import { notify } from '../notification/notification.service';
import { notifyStatusChanged } from './service-request.notify';
import { ServiceRequest } from './service-request.model';

/**
 * Status moves the CONCLUSION causes, as opposed to the ones a person asks for.
 *
 * ITS OWN MODULE BECAUSE OF THE IMPORT GRAPH, and the shape is worth stating: the manual
 * path lives in `changeServiceRequestStatus`, which `service-request.service.ts` owns, and
 * that file already imports `assertReportAllows` from `work-report.service.ts`. Driving the
 * manual path from the conclusion would close that cycle. This module is imported by both
 * and imports neither.
 *
 * IT IS ALSO A DIFFERENT ACT, not merely a reachable copy of one. `changeServiceRequestStatus`
 * asks whether this actor may move this request — self-progress scope, a reason where one is
 * required, and `assertReportAllows`, which exists to stop somebody declaring a job finished
 * with no conclusion behind it. None of those questions apply here: the mover is the
 * conclusion itself, its authority was established when the conclusion was written or
 * approved, and the thing `assertReportAllows` guards against is precisely what just
 * happened. Re-asking would be circular.
 */

/**
 * Moves a request because its conclusion moved, and says nothing if it cannot.
 *
 * NEVER THROWS. The conclusion is already written and approved by the time this runs; a
 * refusal here would fail an operation that has genuinely succeeded and leave the caller
 * believing their work was lost. A status that will not move is logged and left alone —
 * which is also the right answer for the ordinary case of it already being there, such as
 * a returned conclusion being submitted a second time while the request never left
 * REPORT_SUBMITTED.
 */
export async function advanceOnConclusion(
  requestId: Types.ObjectId | string,
  to: ServiceRequestStatus,
  actor: AuthContext,
): Promise<void> {
  try {
    const request = await ServiceRequest.findById(requestId).populate('building', 'name');
    if (!request) return;

    const from = request.status;
    if (from === to) return;

    if (!canTransition(from, to)) {
      logger.warn(
        { requestId: String(requestId), from, to },
        'Conclusion could not advance the request status',
      );
      return;
    }

    request.status = to;
    if (to === 'COMPLETED') request.completedAt = new Date();
    request.statusHistory.push({
      _id: new Types.ObjectId(),
      fromStatus: from,
      toStatus: to,
      reason: null,
      changedBy: new Types.ObjectId(actor.userId),
      changedByName: actor.fullName ?? null,
      changedAt: new Date(),
    });
    await request.save();

    /*
     * The same recipients as a hand-made status change, because it is the same event.
     *
     * A conclusion moving the request is an implementation detail of how it moved; the
     * technician on the job and the dispatch desk care that it moved. `notifyStatusChanged`
     * also decides on its own whether this status is one the customer should hear about,
     * which is why COMPLETED needs no special case here — see below.
     */
    await notifyStatusChanged({
      request,
      to,
      reason: null,
      actorUserId: actor.userId,
    });

    // COMPLETED is deliberately NOT in the customer-visible set above: this message says
    // more than a status line does, and two notifications for one event is worse than one.
    if (to === 'COMPLETED') await notifyCustomerResolved(request);
  } catch (error) {
    // Same contract as the notification writer: a bookkeeping failure must not turn a
    // successful conclusion into a 500.
    logger.error({ err: error, requestId: String(requestId), to }, 'Auto status change failed');
  }
}

/**
 * Tells the customer their request is finished.
 *
 * WHAT "ENOUGH TO IDENTIFY IT" MEANS HERE. The staff notification above is a status line and
 * a link into the admin console — useless to a customer, who cannot open that path and may
 * have several requests open at once. This one names the request number in the title and
 * the building in the body, which are the two things a customer recognises a request by, and
 * links into the PORTAL. Without the building, "SR-202608-0004 дууслаа" means nothing to
 * somebody responsible for four sites.
 */
async function notifyCustomerResolved(request: {
  _id: Types.ObjectId;
  requestNumber: string;
  customer: Types.ObjectId;
  building?: unknown;
}): Promise<void> {
  const building = request.building as { name?: string } | null | undefined;
  const where = building?.name ? `${building.name}. ` : '';

  await notify({
    event: 'SERVICE_REQUEST_STATUS_CHANGED',
    title: `${request.requestNumber} хүсэлт шийдэгдлээ`,
    body: `${where}Ажил дууссан. Дүгнэлтийг хүсэлтийн дэлгэрэнгүйгээс харна уу.`,
    entityType: 'Work',
    entityId: request._id,
    // The portal path, not the staff one: a customer following the admin link gets a
    // permission refusal, which is a worse answer than no link.
    linkPath: `/portal/requests/${String(request._id)}`,
    customerId: request.customer,
  });
}
