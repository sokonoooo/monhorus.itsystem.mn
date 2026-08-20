import { Types } from 'mongoose';

import { logger } from '../../config/logger';
import { recordAudit } from '../audit/audit.service';
import { notify } from '../notification/notification.service';
import { CLAIMABLE_STATUSES, ServiceRequest } from './service-request.model';

/**
 * The unclaimed-work chase.
 *
 * When a request enters the open queue and nobody takes it, scheduling has to happen by
 * hand — so the people who could take it are chased, repeatedly, until somebody does.
 * Everything about this is server-side: a browser timer would fire only while somebody
 * happened to have the board open, would fire once per open tab, and would stop existing
 * the moment they navigated away. This runs on the same interval-job mechanism the overdue
 * reconciliation uses.
 */

/**
 * How long a request may sit unclaimed before the first reminder, and the gap between
 * every reminder after it.
 *
 * One constant rather than two because the schedule is deliberately even: reminder N is due
 * at `openedForClaimAt + N * this`. Thirty minutes replaced a single two-hour alert — a
 * call nobody has taken in half an hour is already a scheduling problem, and one alert two
 * hours in was easy to miss and impossible to follow up.
 */
export const UNCLAIMED_ALERT_AFTER_MS = 30 * 60 * 1000;

/**
 * How many reminders one spell in the open queue may produce, ever.
 *
 * THE CAP IS THE REASON THE COUNTER EXISTS. A repeating alert with no ceiling means a call
 * that genuinely cannot be taken — out of hours, no qualified technician, a duplicate
 * nobody wants to close — buzzes every phone holding the claim permission all night, and
 * the predictable end of that is the whole event being muted. Three reminders span an hour
 * and a half: long enough for anyone on shift to see one, short enough that the noise stops
 * while people still care about it.
 *
 * Silence after the cap is not the system giving up quietly. The final reminder also goes
 * to the dispatchers, whose decision it then becomes — see `runUnclaimedSweep`.
 */
export const UNCLAIMED_ALERT_MAX_SENDS = 3;

/** One pass handles at most this many rows, so a backlog cannot stall a tick. */
const SWEEP_LIMIT = 200;

export interface UnclaimedSweepResult {
  /** Reminders actually sent by this pass. */
  notified: number;
  /** Rows examined, whether or not they produced a reminder. */
  examined: number;
}

/**
 * Stamps a request as newly open, so the chase starts from zero.
 *
 * Called whenever a request lands in — or returns to — the open queue. Re-stamping is the
 * mechanism behind "a work returned to the open queue starts a NEW chase": the stamp moves,
 * and every reminder is scheduled from the new one.
 *
 * RESETTING THE COUNT HERE IS WHAT GIVES A SECOND SPELL ITS OWN THREE REMINDERS. Without
 * it, a request that had exhausted its cap, was assigned, and then came back to the queue
 * would be born silent — the worst case for the cap to apply to, because a returned job is
 * one somebody has already refused. Clearing `unclaimedNotifiedFor` at the same time keeps
 * that true even if the two clocks land on the same millisecond and the stamp comparison
 * cannot tell the spells apart.
 */
export async function markOpenForClaim(
  requestId: Types.ObjectId,
  at: Date = new Date(),
): Promise<void> {
  await ServiceRequest.updateOne(
    { _id: requestId },
    { $set: { openedForClaimAt: at, unclaimedNotifiedFor: null, unclaimedAlertCount: 0 } },
  );
}

/** Clears the open stamp, and the chase with it, when a request stops being claimable. */
export async function clearOpenForClaim(requestId: Types.ObjectId): Promise<void> {
  await ServiceRequest.updateOne(
    { _id: requestId },
    { $set: { openedForClaimAt: null, unclaimedNotifiedFor: null, unclaimedAlertCount: 0 } },
  );
}

/**
 * One pass over the open queue.
 *
 * RERUN-SAFE AND ONCE-PER-REMINDER, by staking a claim rather than by holding a lock. A row
 * is due when it is still open and the next reminder's due time — derived from the open
 * stamp and the number already sent — has passed. The send is staked with an atomic
 * `updateOne` whose filter names the exact count that was read, so a second sweep running
 * concurrently (two instances, or a tick that overlapped a slow one) matches nothing,
 * advances nothing and sends nothing. The notification is written only after that write
 * wins, which is the ordering that makes a duplicate reminder impossible rather than merely
 * unlikely. Nothing here reads a value and then writes a value derived from it without the
 * database re-checking the read.
 *
 * A request claimed or assigned between reminders has had its stamp cleared by that path,
 * so it is never examined here again.
 *
 * RECIPIENTS. The reminder goes to `service_request.claim` — the permission that gates the
 * claim endpoint itself, held by TECHNICIAN and by nobody who could not act on it. The old
 * alert went to `dispatch.assign`, which TECHNICIAN does not hold, so the only people told a
 * call was going untaken were the ones who would then have to hand it to somebody. Telling
 * the people who can simply take it is the shorter path, and the owner's decision.
 *
 * Dispatchers are not dropped, they are escalated to: the LAST reminder is also sent to
 * `dispatch.assign`, with different wording, because that is the moment the automatic chase
 * stops and a human has to place the work. Two `notify` calls rather than one because
 * `notify` addresses a single permission; anyone holding both keys receives both messages,
 * which is correct — they are two different messages, to two different duties.
 */
export async function runUnclaimedSweep(now: Date = new Date()): Promise<UnclaimedSweepResult> {
  const firstReminderDueBy = new Date(now.getTime() - UNCLAIMED_ALERT_AFTER_MS);

  const due = await ServiceRequest.find({
    status: { $in: CLAIMABLE_STATUSES },
    assignedEmployees: { $size: 0 },
    assignedTeam: null,
    openedForClaimAt: { $ne: null, $lte: firstReminderDueBy },
    /*
     * Exhausted rows are excluded by the query rather than skipped in the loop, so a queue
     * full of calls nobody will ever take cannot fill the row cap and starve rows that are
     * still due.
     *
     * `$not: { $gte }` rather than `$lt`: a `$lt` does not match a document that has no
     * such field at all, and every request written before this counter existed is exactly
     * that. Those rows must still be chased, so the predicate has to read "missing" as
     * "none sent".
     */
    unclaimedAlertCount: { $not: { $gte: UNCLAIMED_ALERT_MAX_SENDS } },
  })
    .populate([
      { path: 'customer', select: 'name' },
      { path: 'project', select: 'name' },
      { path: 'building', select: 'name' },
    ])
    .limit(SWEEP_LIMIT);

  let notified = 0;

  for (const request of due) {
    const stamp = request.openedForClaimAt;
    if (!stamp) continue;

    /*
     * How many reminders belong to THIS spell in the queue.
     *
     * A count staked against a different stamp is a leftover from a previous spell and is
     * read as zero — the same reasoning that made the marker a date rather than a boolean
     * in the first place, and the reason the counter was added beside it instead of
     * replacing it.
     */
    const alreadySent =
      request.unclaimedNotifiedFor?.getTime() === stamp.getTime()
        ? request.unclaimedAlertCount
        : 0;
    if (alreadySent >= UNCLAIMED_ALERT_MAX_SENDS) continue;

    const sequence = alreadySent + 1;
    // Anchored on the open stamp, not on when the last reminder went out, so a slow or
    // missed tick cannot push the whole series later and later.
    const dueAt = stamp.getTime() + sequence * UNCLAIMED_ALERT_AFTER_MS;
    if (dueAt > now.getTime()) continue;

    const staked = await ServiceRequest.updateOne(
      {
        _id: request._id,
        openedForClaimAt: stamp,
        // Re-asserted so a request claimed between the find and this write is not alerted.
        status: { $in: CLAIMABLE_STATUSES },
        assignedEmployees: { $size: 0 },
        /*
         * The state this send was decided from, restated as a condition. Either no reminder
         * belongs to this stamp yet, or exactly `alreadySent` do — a concurrent sweep that
         * got there first has already moved the count on and matches none of these three.
         */
        $or: [
          { unclaimedNotifiedFor: null },
          { unclaimedNotifiedFor: { $ne: stamp } },
          { unclaimedNotifiedFor: stamp, unclaimedAlertCount: alreadySent },
        ],
      },
      { $set: { unclaimedNotifiedFor: stamp, unclaimedAlertCount: sequence } },
    );

    // The count always changes, so a won stake is always a modification and `modifiedCount`
    // separates the winner from the loser without a second read.
    if (staked.modifiedCount === 0) continue;

    const named = (value: unknown): string | null => {
      if (typeof value !== 'object' || value === null || !('name' in value)) return null;
      return (value as { name?: string }).name ?? null;
    };

    const openMinutes = Math.round((now.getTime() - stamp.getTime()) / 60000);
    const isFinal = sequence === UNCLAIMED_ALERT_MAX_SENDS;
    const facts = [
      named(request.customer) && `Харилцагч: ${named(request.customer)}`,
      named(request.project) && `Төсөл: ${named(request.project)}`,
      named(request.building) && `Барилга: ${named(request.building)}`,
      request.isUrgent ? 'Яаралтай' : 'Энгийн',
      `Нээлттэй болсон: ${stamp.toISOString()} (${openMinutes} мин)`,
    ].filter(Boolean);

    await notify({
      event: 'SERVICE_REQUEST_UNCLAIMED',
      title: `${request.requestNumber} ${openMinutes} минут эзэнгүй байна — ажил авах шаардлагатай (сануулга ${sequence}/${UNCLAIMED_ALERT_MAX_SENDS})`,
      body: isFinal ? [...facts, 'Энэ бол сүүлчийн сануулга.'].join(' · ') : facts.join(' · '),
      entityType: 'Work',
      entityId: request._id,
      // The request itself, which is where the "Өөртөө авах" action lives.
      linkPath: `/service-requests/${String(request._id)}`,
      permission: 'service_request.claim',
    });

    if (isFinal) {
      // The chase is over and nobody took it, so the decision goes back to the people who
      // can put somebody on it. Sent once, at the cap, rather than every time — otherwise
      // the cap would only have moved the all-night buzzing to a different inbox.
      await notify({
        event: 'SERVICE_REQUEST_UNCLAIMED',
        title: `${request.requestNumber} — ${UNCLAIMED_ALERT_MAX_SENDS} удаа сануулсан ч хэн ч аваагүй, хуваарилалт шаардлагатай`,
        body: [...facts, 'Автомат сануулга дууслаа.'].join(' · '),
        entityType: 'Work',
        entityId: request._id,
        // The dispatch board is where the reader can actually act on it.
        linkPath: `/dispatch?requestId=${String(request._id)}`,
        permission: 'dispatch.assign',
      });
    }

    await recordAudit({
      entityType: 'Work',
      entityId: request._id,
      action: 'Updated',
      actor: { id: null, role: null, label: 'Систем' },
      meta: { ip: null, userAgent: 'unclaimed-sweep' },
      reason: isFinal
        ? `unclaimed for ${openMinutes} minutes; final reminder ${sequence}/${UNCLAIMED_ALERT_MAX_SENDS} sent, escalated to dispatchers`
        : `unclaimed for ${openMinutes} minutes; reminder ${sequence}/${UNCLAIMED_ALERT_MAX_SENDS} sent to claimers`,
      oldValue: { openedForClaimAt: stamp.toISOString(), unclaimedAlertCount: alreadySent },
      newValue: {
        unclaimedNotifiedFor: stamp.toISOString(),
        unclaimedAlertCount: sequence,
        openMinutes,
      },
    });

    notified += 1;
  }

  if (notified > 0) {
    logger.info({ notified, examined: due.length }, 'Unclaimed service requests reported');
  }

  return { notified, examined: due.length };
}
