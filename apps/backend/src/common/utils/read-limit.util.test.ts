import { afterEach, describe, expect, it, vi } from 'vitest';

import { logger } from '../../config/logger';
import {
  CALENDAR_EVENTS_PER_SOURCE_LIMIT,
  EMPLOYEE_STATUS_HISTORY_LIMIT,
  OBJECT_NODE_CHILDREN_DEFAULT_LIMIT,
  OBJECT_NODE_CHILDREN_MAX_LIMIT,
  OBJECT_TIMELINE_AUDIT_LIMIT,
  OBJECT_TIMELINE_REPORT_ITEM_LIMIT,
  noteTruncation,
} from './read-limit.util';

/**
 * A capped read must leave a trace.
 *
 * The defect these limits caused was never the cap itself — it was that reaching one looked
 * exactly like reaching the end of the data. A calendar window that stops at 500 renders as
 * a quiet quarter; a device timeline that stops at 100 renders as a short history.
 */
describe('read limits', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('says so when a read reaches its cap', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);

    noteTruncation('calendar.plannedWork', 500, CALENDAR_EVENTS_PER_SOURCE_LIMIT, {
      from: '2026-06-01T00:00:00.000Z',
    });

    expect(warn).toHaveBeenCalledTimes(1);
    const [context, message] = warn.mock.calls[0] as [Record<string, unknown>, string];
    // The line has to name the read and the cap, or an operator cannot act on it.
    expect(context).toMatchObject({
      read: 'calendar.plannedWork',
      limit: CALENDAR_EVENTS_PER_SOURCE_LIMIT,
      from: '2026-06-01T00:00:00.000Z',
    });
    expect(message).toContain('calendar.plannedWork');
  });

  it('stays quiet for a read that fits', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);

    noteTruncation('calendar.plannedWork', 499, CALENDAR_EVENTS_PER_SOURCE_LIMIT);

    expect(warn).not.toHaveBeenCalled();
  });

  /*
   * Over-reporting by one — the read whose row count is exactly the cap — is deliberate.
   * The alternative is a second count query on every read, and being wrong in this
   * direction costs an operator a log line rather than a missed truncation.
   */
  it('warns on the boundary rather than risking a missed truncation', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);

    noteTruncation('objectHistory.audit', OBJECT_TIMELINE_AUDIT_LIMIT, OBJECT_TIMELINE_AUDIT_LIMIT);

    expect(warn).toHaveBeenCalledTimes(1);
  });

  /*
   * The numbers themselves. Not a tautology: these were bare literals scattered across four
   * modules, and this is the record of what each one is, so a change to one is a change
   * somebody made on purpose.
   */
  it('keeps the documented ceilings', () => {
    expect(CALENDAR_EVENTS_PER_SOURCE_LIMIT).toBe(500);
    expect(OBJECT_TIMELINE_REPORT_ITEM_LIMIT).toBe(100);
    expect(OBJECT_TIMELINE_AUDIT_LIMIT).toBe(100);
    expect(EMPLOYEE_STATUS_HISTORY_LIMIT).toBe(50);
    expect(OBJECT_NODE_CHILDREN_DEFAULT_LIMIT).toBe(100);
    expect(OBJECT_NODE_CHILDREN_MAX_LIMIT).toBe(200);
  });
});
