import { Types } from 'mongoose';

import { logger } from '../../config/logger';
import { notify } from '../notification/notification.service';
import { ServiceRequest } from '../service-request/service-request.model';
import { SurveyInvitation, SurveyQuestion } from './survey.models';

/**
 * Issuing the invitation a completed request earns.
 *
 * ITS OWN MODULE BECAUSE OF THE IMPORT GRAPH. There are two completion paths — the common
 * one through `advanceOnConclusion` when a conclusion is approved, and the manual one
 * through `changeServiceRequestStatus` — and both must issue, or requests finished the
 * other way are silently never surveyed. Putting the emitter here lets both call it without
 * either service importing the other, exactly as `service-request.auto-status.ts` does. It
 * imports the request MODEL, which imports nothing back, so no cycle is closed.
 */

/**
 * Issues the survey invitation for a completed request, at most once.
 *
 * NEVER THROWS. The request is already completed by the time this runs; a refusal here
 * would fail an operation that genuinely succeeded, and nobody would trade a finished job
 * for a satisfaction survey. Same contract as the notification writer and the audit writer.
 */
export async function issueSurveyInvitation(requestId: Types.ObjectId | string): Promise<void> {
  try {
    const request = await ServiceRequest.findById(requestId)
      .select('_id requestNumber customer building assignedEmployees completedAt')
      .populate('building', 'name');
    if (!request) return;

    /*
     * Nobody to rate.
     *
     * A request can reach COMPLETED with an empty roster — cancelled-then-closed paths and
     * office-resolved calls both do it. An invitation naming no technicians is a form with
     * no questions on it.
     */
    if (request.assignedEmployees.length === 0) return;

    /*
     * No catalogue, no invitation.
     *
     * An invitation nobody can answer is worse than none: it sits in the customer's pending
     * list forever, collects a reminder, and can never be closed because there is no form to
     * submit. This is also what keeps the feature switched off until an administrator has
     * actually written the questions — the rollout gate is the catalogue itself rather than
     * a flag somebody has to remember to turn on.
     */
    if ((await SurveyQuestion.countDocuments({ isActive: true })) === 0) return;

    const now = new Date();
    const building = request.building as unknown as { name?: string } | null | undefined;

    /*
     * Upsert, and announce only on the insert.
     *
     * `new: false` returns the document as it stood BEFORE the write, so a null return means
     * this call is the one that inserted. A request that reaches COMPLETED a second time —
     * reopened, re-finished, or a conclusion approved twice — therefore re-issues nothing
     * and, more importantly, re-announces nothing. `$setOnInsert` alone would keep the
     * document intact but would still let a second completion send a second notification.
     */
    const existing = await SurveyInvitation.findOneAndUpdate(
      { serviceRequest: request._id },
      {
        $setOnInsert: {
          serviceRequest: request._id,
          customer: request.customer,
          requestNumber: request.requestNumber,
          buildingName: building?.name ?? null,
          employees: [...request.assignedEmployees],
          issuedAt: now,
          completedAt: request.completedAt ?? now,
          reminderSentFor: null,
          closedAt: null,
        },
      },
      { upsert: true, new: false },
    );
    if (existing) return;

    const where = building?.name ? `${building.name}. ` : '';
    await notify({
      event: 'SURVEY_REQUESTED',
      title: `${request.requestNumber} үйлчилгээгээ үнэлнэ үү`,
      body: `${where}Ажилласан мэргэжилтнүүдийг үнэлж, сэтгэгдлээ үлдээнэ үү.`,
      // LOAD BEARING. The Flutter notification sheet deep-links on exactly this entity type,
      // so naming the invitation here instead would produce a notification that opens
      // nothing.
      entityType: 'Work',
      entityId: request._id,
      linkPath: `/portal/requests/${String(request._id)}/survey`,
      customerId: request.customer,
    });
  } catch (error) {
    logger.error(
      { err: error, requestId: String(requestId) },
      'Failed to issue the satisfaction survey invitation',
    );
  }
}
