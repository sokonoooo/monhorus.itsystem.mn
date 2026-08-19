import { Types } from 'mongoose';

import { logger } from '../../config/logger';
import { recordAudit } from '../audit/audit.service';
import { notify } from '../notification/notification.service';
import { CLAIMABLE_STATUSES, ServiceRequest } from './service-request.model';

/**
 * The two-hour unclaimed-work alert.
 *
 * When a request enters the open queue and nobody takes it, scheduling has to happen by
 * hand — so after two hours the people who can dispatch are told. Everything about this is
 * server-side: a browser timer would fire only while somebody happened to have the board
 * open, would fire once per open tab, and would stop existing the moment they navigated
 * away. This runs on the same interval-job mechanism the overdue reconciliation uses.
 */
export const UNCLAIMED_ALERT_AFTER_MS = 2 * 60 * 60 * 1000;

export interface UnclaimedSweepResult {
  /** Rows that were past the threshold and had not been alerted for this interval. */
  notified: number;
  /** Rows examined, whether or not they produced an alert. */
  examined: number;
}

/**
 * Stamps a request as newly open, so the two-hour clock starts.
 *
 * Called whenever a request lands in — or returns to — the open queue. Re-stamping is the
 * mechanism behind "a work returned to the open queue starts a NEW interval": the stamp
 * moves, `unclaimedNotifiedFor` no longer equals it, and the sweep therefore treats the
 * second spell as un-alerted. Clearing `unclaimedNotifiedFor` at the same time is what
 * keeps that true even if the clocks land on the same millisecond.
 */
export async function markOpenForClaim(
  requestId: Types.ObjectId,
  at: Date = new Date(),
): Promise<void> {
  await ServiceRequest.updateOne(
    { _id: requestId },
    { $set: { openedForClaimAt: at, unclaimedNotifiedFor: null } },
  );
}

/** Clears the open stamp when a request stops being claimable. */
export async function clearOpenForClaim(requestId: Types.ObjectId): Promise<void> {
  await ServiceRequest.updateOne(
    { _id: requestId },
    { $set: { openedForClaimAt: null, unclaimedNotifiedFor: null } },
  );
}

/**
 * One pass over the open queue.
 *
 * RERUN-SAFE AND ONCE-PER-INTERVAL, by comparing two dates rather than by holding a lock.
 * A row is due when it is still open, its stamp is older than the threshold, and
 * `unclaimedNotifiedFor` does not already equal that stamp. The claim is staked with an
 * atomic `updateOne` carrying the same predicate, so a second sweep running concurrently —
 * two instances, or a tick that overlapped a slow one — matches nothing and sends nothing.
 * The notification is written only after that write wins, which is the ordering that makes
 * a duplicate alert impossible rather than merely unlikely.
 *
 * A request claimed inside the two hours has had its stamp cleared by the claim, so it is
 * never examined here at all.
 */
export async function runUnclaimedSweep(now: Date = new Date()): Promise<UnclaimedSweepResult> {
  const threshold = new Date(now.getTime() - UNCLAIMED_ALERT_AFTER_MS);

  const due = await ServiceRequest.find({
    status: { $in: CLAIMABLE_STATUSES },
    assignedEmployees: { $size: 0 },
    assignedTeam: null,
    openedForClaimAt: { $ne: null, $lte: threshold },
  })
    .populate([
      { path: 'customer', select: 'name' },
      { path: 'project', select: 'name' },
      { path: 'building', select: 'name' },
    ])
    .limit(200);

  let notified = 0;

  for (const request of due) {
    const stamp = request.openedForClaimAt;
    if (!stamp) continue;

    // Already alerted for THIS spell in the queue. A re-opened request has a newer stamp
    // and so does not match here, which is what allows a second alert for a second spell.
    if (request.unclaimedNotifiedFor?.getTime() === stamp.getTime()) continue;

    const staked = await ServiceRequest.updateOne(
      {
        _id: request._id,
        openedForClaimAt: stamp,
        // Re-asserted so a request claimed between the find and this write is not alerted.
        status: { $in: CLAIMABLE_STATUSES },
        assignedEmployees: { $size: 0 },
        $or: [{ unclaimedNotifiedFor: null }, { unclaimedNotifiedFor: { $ne: stamp } }],
      },
      { $set: { unclaimedNotifiedFor: stamp } },
    );

    if (staked.modifiedCount === 0) continue;

    const named = (value: unknown): string | null => {
      if (typeof value !== 'object' || value === null || !('name' in value)) return null;
      return (value as { name?: string }).name ?? null;
    };

    const openMinutes = Math.round((now.getTime() - stamp.getTime()) / 60000);
    const facts = [
      named(request.customer) && `Харилцагч: ${named(request.customer)}`,
      named(request.project) && `Төсөл: ${named(request.project)}`,
      named(request.building) && `Барилга: ${named(request.building)}`,
      request.isUrgent ? 'Яаралтай' : 'Энгийн',
      `Нээлттэй болсон: ${stamp.toISOString()} (${openMinutes} мин)`,
    ].filter(Boolean);

    await notify({
      event: 'SERVICE_REQUEST_UNCLAIMED',
      title: `${request.requestNumber} 2 цаг эзэнгүй байна — хуваарилалт шаардлагатай`,
      body: facts.join(' · '),
      entityType: 'Work',
      entityId: request._id,
      // The dispatch board is where the reader can actually act on it.
      linkPath: `/dispatch?requestId=${String(request._id)}`,
      permission: 'dispatch.assign',
    });

    await recordAudit({
      entityType: 'Work',
      entityId: request._id,
      action: 'Updated',
      actor: { id: null, role: null, label: 'Систем' },
      meta: { ip: null, userAgent: 'unclaimed-sweep' },
      reason: 'unclaimed for two hours; dispatchers notified',
      oldValue: { openedForClaimAt: stamp.toISOString() },
      newValue: { unclaimedNotifiedFor: stamp.toISOString(), openMinutes },
    });

    notified += 1;
  }

  if (notified > 0) {
    logger.info({ notified, examined: due.length }, 'Unclaimed service requests reported');
  }

  return { notified, examined: due.length };
}
