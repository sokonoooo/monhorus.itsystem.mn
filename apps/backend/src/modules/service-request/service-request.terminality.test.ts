import { SERVICE_REQUEST_TRANSITIONS, type ServiceRequestStatus } from '@monhorus/shared';
import { describe, expect, it } from 'vitest';

import {
  TERMINAL_SERVICE_REQUEST_STATUSES,
  TERMINAL_SERVICE_REQUEST_STATUS_LIST,
  isTerminalServiceRequestStatus,
} from './service-request.terminality';
import { evaluateSla } from './sla.service';

/**
 * One definition of "finished", asserted rather than trusted.
 *
 * The rule used to be written out six times. These fix the two properties that made the
 * copies dangerous: the answer is READ from the transition matrix, and it still names the
 * statuses everything downstream was built around.
 */
describe('service request terminality', () => {
  it('is exactly the statuses the matrix gives no outbound move', () => {
    const fromMatrix = (Object.keys(SERVICE_REQUEST_TRANSITIONS) as ServiceRequestStatus[]).filter(
      (status) => SERVICE_REQUEST_TRANSITIONS[status].length === 0,
    );

    expect([...TERMINAL_SERVICE_REQUEST_STATUSES].sort()).toEqual([...fromMatrix].sort());
  });

  /*
   * The six literals this replaced all said COMPLETED and CANCELLED. If the matrix ever
   * disagrees with that, the change is a lifecycle change and wants a deliberate decision —
   * not a silent one discovered through a stuck SLA clock.
   */
  it('still means COMPLETED and CANCELLED', () => {
    expect([...TERMINAL_SERVICE_REQUEST_STATUSES].sort()).toEqual(['CANCELLED', 'COMPLETED']);
  });

  it('agrees with itself across the predicate and both list forms', () => {
    expect(TERMINAL_SERVICE_REQUEST_STATUS_LIST).toEqual([...TERMINAL_SERVICE_REQUEST_STATUSES]);

    for (const status of Object.keys(SERVICE_REQUEST_TRANSITIONS) as ServiceRequestStatus[]) {
      expect(isTerminalServiceRequestStatus(status)).toBe(
        TERMINAL_SERVICE_REQUEST_STATUSES.includes(status),
      );
    }
  });

  it('is not true of a live status', () => {
    expect(isTerminalServiceRequestStatus('NEW')).toBe(false);
    expect(isTerminalServiceRequestStatus('IN_PROGRESS')).toBe(false);
  });

  /*
   * The SLA engine was one of the six copies, and the one where being wrong is least
   * visible: a terminal request that is not recognised as terminal keeps counting down and
   * eventually reports itself breached. This pins the behaviour through the public function
   * rather than through the constant it now reads.
   */
  it('makes the SLA engine grade a finished request historically', () => {
    const startedAt = new Date('2026-08-01T00:00:00.000Z');
    const dueAt = new Date('2026-08-01T06:00:00.000Z');

    const onTime = evaluateSla({
      status: 'COMPLETED',
      isUrgent: true,
      slaStartedAt: startedAt,
      slaDueAt: dueAt,
      completedAt: new Date('2026-08-01T05:00:00.000Z'),
      now: new Date('2026-08-09T00:00:00.000Z'),
    });
    expect(onTime.state).toBe('WITHIN_SLA');

    const late = evaluateSla({
      status: 'COMPLETED',
      isUrgent: true,
      slaStartedAt: startedAt,
      slaDueAt: dueAt,
      completedAt: new Date('2026-08-01T09:00:00.000Z'),
      now: new Date('2026-08-09T00:00:00.000Z'),
    });
    expect(late.state).toBe('LATE');

    // A live request long past its deadline is the contrast: still counting, and breached.
    const live = evaluateSla({
      status: 'IN_PROGRESS',
      isUrgent: true,
      slaStartedAt: startedAt,
      slaDueAt: dueAt,
      completedAt: null,
      now: new Date('2026-08-09T00:00:00.000Z'),
    });
    expect(live.state).toBe('BREACHED');
  });
});
