import { PERMISSIONS } from '@monhorus/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CALENDAR_EVENTS_PER_SOURCE_LIMIT } from '../../common/utils/read-limit.util';
import { logger } from '../../config/logger';
import {
  createObjectFixture,
  createUserWithPermissions,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
  type ObjectFixture,
} from '../../test/helpers';
import { PlannedWork } from '../planned-work/planned-work.models';

const API = '/api/v1';

/**
 * The calendar stops at a cap, and has to say so.
 *
 * A window may be 92 days wide and the cap applies per source, so a busy quarter reaches it
 * for real. Before this, the calendar simply stopped drawing: the response was a normal
 * calendar, shorter, with nothing in it or in the logs to distinguish a capped read from a
 * quiet quarter. Telling the CLIENT needs a field on `CalendarResultDto`, which lives in
 * `packages/shared`; what is asserted here is the half that does not — that a truncated
 * read is now visible to whoever is running the server.
 */
describe('calendar truncation disclosure', () => {
  let app: Express;
  let objects: ObjectFixture;
  let token: string;

  beforeAll(async () => {
    app = await startTestApp();
  });

  afterAll(async () => {
    await stopTestApp();
  });

  beforeEach(async () => {
    await resetDomainCollections();
    objects = await createObjectFixture();
    const user = await createUserWithPermissions('calendar-cap@test.mn', [
      PERMISSIONS.PLANNED_WORK_VIEW,
      PERMISSIONS.PLANNED_WORK_CREATE,
      PERMISSIONS.PLANNED_WORK_UPDATE,
      PERMISSIONS.SERVICE_REQUEST_VIEW,
    ]);
    const login = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: user.email, password: user.password });
    token = login.body.data.tokens.accessToken as string;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Seeded through the model rather than the API: this needs more works than the cap, and
   * five hundred lifecycle transitions would dominate the suite's runtime for no extra
   * coverage. The lifecycle is exercised properly in `calendar.api.test.ts`.
   */
  async function seedWorks(count: number): Promise<void> {
    const start = new Date('2026-07-05T00:00:00.000Z');
    const end = new Date('2026-07-20T00:00:00.000Z');

    await PlannedWork.insertMany(
      Array.from({ length: count }, (_, index) => ({
        workNumber: `PW-CAP-${String(index).padStart(5, '0')}`,
        project: objects.projectId,
        building: objects.buildingId,
        customer: objects.customerId,
        title: `Улирлын үзлэг ${index}`,
        plannedStartDate: start,
        plannedEndDate: end,
        originalPlannedEndDate: end,
        status: 'PLANNED',
      })),
    );
  }

  it('warns when a window reaches the per-source cap', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);

    await seedWorks(CALENDAR_EVENTS_PER_SOURCE_LIMIT + 5);

    const response = await request(app)
      .get(`${API}/calendar`)
      .query({ from: '2026-07-01', to: '2026-07-31' })
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    // The cap really did bite: the reader got the ceiling, not the 505 that exist.
    expect(response.body.data.events).toHaveLength(CALENDAR_EVENTS_PER_SOURCE_LIMIT);

    const truncation = warn.mock.calls.find(
      (call) => (call[0] as { read?: string } | undefined)?.read === 'calendar.plannedWork',
    );
    expect(truncation, 'a capped calendar read must announce itself').toBeDefined();
    expect(truncation?.[0]).toMatchObject({
      read: 'calendar.plannedWork',
      limit: CALENDAR_EVENTS_PER_SOURCE_LIMIT,
    });
  }, 60_000);

  it('says nothing for a window that fits', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);

    await seedWorks(3);

    const response = await request(app)
      .get(`${API}/calendar`)
      .query({ from: '2026-07-01', to: '2026-07-31' })
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.events).toHaveLength(3);

    const truncation = warn.mock.calls.find((call) =>
      String((call[0] as { read?: string } | undefined)?.read ?? '').startsWith('calendar.'),
    );
    expect(truncation, 'an uncapped read must stay quiet').toBeUndefined();
  }, 60_000);
});
