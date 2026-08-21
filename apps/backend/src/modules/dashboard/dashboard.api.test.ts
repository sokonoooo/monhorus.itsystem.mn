import { DEFAULT_DASHBOARD_LAYOUT, PERMISSIONS } from '@monhorus/shared';
import { Types } from 'mongoose';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { dayBounds } from '../../common/utils/day-bounds.util';
import {
  createObjectFixture,
  createSuperUser,
  createUserWithPermissions,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
  type ObjectFixture,
} from '../../test/helpers';
import { ObjectAssessment, ObjectRecord, ObjectType } from '../object-master/object-master.models';
import { PlannedWork, nextWorkNumber } from '../planned-work/planned-work.models';
import { ServiceAgreement } from '../service-agreement/service-agreement.model';
import { ServiceRequest, nextRequestNumber } from '../service-request/service-request.model';

const API = '/api/v1';

let app: Express;
let token: string;
let fixture: ObjectFixture;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  return response.body.data.tokens.accessToken as string;
}

async function summary(bearer = token): Promise<Record<string, unknown>> {
  const response = await request(app)
    .get(`${API}/dashboard/summary`)
    .set('Authorization', `Bearer ${bearer}`);
  expect(response.status).toBe(200);
  return response.body.data as Record<string, unknown>;
}

async function seedRequest(overrides: Record<string, unknown> = {}): Promise<string> {
  const created = await ServiceRequest.create({
    requestNumber: await nextRequestNumber(),
    customer: fixture.customerId,
    building: fixture.buildingId,
    floor: fixture.floorId,
    requestType: 'STANDARD_CALL',
    isUrgent: false,
    description: 'Гэрэл асахгүй байна.',
    contactName: 'Бат',
    contactPhone: '99112233',
    status: 'NEW',
    slaStartedAt: new Date(),
    slaDueAt: new Date(Date.now() + 3_600_000),
    ...overrides,
  });
  return String(created._id);
}

/** A planned work carrying a quantity rollup, which is what the average is weighted by. */
async function seedPlannedWork(totalQuantity: number, completedQuantity: number): Promise<void> {
  await PlannedWork.create({
    workNumber: await nextWorkNumber(),
    customer: fixture.customerId,
    building: fixture.buildingId,
    title: 'Урьдчилан сэргийлэх үзлэг',
    plannedStartDate: new Date(Date.now() - 86_400_000),
    plannedEndDate: new Date(Date.now() + 86_400_000),
    originalPlannedEndDate: new Date(Date.now() + 86_400_000),
    status: 'STARTED',
    totalQuantity,
    completedQuantity,
    taskCount: 1,
  });
}

/** An assessed object, written head-last because the head reference is required. */
async function seedAssessedObject(code: string, score: number, riskLevel: string): Promise<void> {
  const type =
    (await ObjectType.findOne({ code: 'DB' })) ??
    (await ObjectType.create({
      code: 'DB',
      name: 'Түгээх самбар',
      category: 'PANEL',
      showOnPlan: false,
      insidePanel: false,
      generatesConclusion: true,
      icon: 'PANEL',
      isActive: true,
    }));

  const object = await ObjectRecord.create({
    code,
    name: `Самбар ${code}`,
    category: 'PANEL',
    objectType: type._id,
    customer: fixture.customerId,
    floor: fixture.floorId,
    status: 'ACTIVE',
    panel: { capacityKw: 25, location: null, protection: null },
    latestAssessment: null,
  });

  const assessment = await ObjectAssessment.create({
    object: object._id,
    previousScore: null,
    newScore: score,
    riskLevel,
    assessedByName: 'Б. Энхтөр',
    assessedAt: new Date(),
    repairRequired: false,
    revisitRequired: false,
  });

  await ObjectRecord.updateOne(
    { _id: object._id },
    {
      $set: {
        latestAssessment: {
          assessment: assessment._id,
          score,
          riskLevel,
          assessedAt: new Date(),
          assessedByName: 'Б. Энхтөр',
          conclusion: null,
          recommendation: null,
          repairRequired: false,
          revisitRequired: false,
          revisitDate: null,
        },
      },
    },
  );
}

// Hoisted so every describe in this file shares one app and one reset.
beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await stopTestApp();
});

beforeEach(async () => {
  await resetDomainCollections();
  const superUser = await createSuperUser();
  token = await login(superUser.email, superUser.password);
  fixture = await createObjectFixture();
});

describe('Dashboard API', () => {

  /**
   * The previous implementation read `ObjectNode` with `kind: 'DEVICE'` and a `riskScore`
   * field, which the object master module superseded. It reported nothing no matter how
   * many assessments existed.
   */
  it('counts risk from the object master records, not the superseded device nodes', async () => {
    await seedAssessedObject('DB-01', 92, 'NORMAL');
    await seedAssessedObject('DB-02', 38, 'CRITICAL');

    const data = await summary();
    const risk = data.risk as { byLevel: { level: string; count: number }[]; totalAssessedObjects: number };

    expect(risk.totalAssessedObjects).toBe(2);
    expect(risk.byLevel).toEqual(
      expect.arrayContaining([
        { level: 'NORMAL', count: 1 },
        { level: 'CRITICAL', count: 1 },
      ]),
    );
  });

  it('reports unassessed objects separately rather than folding them into a band', async () => {
    await seedAssessedObject('DB-01', 92, 'NORMAL');
    const type = await ObjectType.findOne({ code: 'DB' });
    await ObjectRecord.create({
      code: 'DB-99',
      name: 'Үнэлгээгүй',
      category: 'PANEL',
      objectType: type?._id,
      customer: fixture.customerId,
      floor: fixture.floorId,
      status: 'ACTIVE',
      panel: { capacityKw: 10, location: null, protection: null },
      latestAssessment: null,
    });

    const risk = (await summary()).risk as {
      totalAssessedObjects: number;
      unassessedObjects: number;
    };
    expect(risk.totalAssessedObjects).toBe(1);
    expect(risk.unassessedObjects).toBe(1);
  });

  /** The agreement module exists, so this is a real count rather than a hardcoded zero. */
  it('counts active service agreements', async () => {
    await ServiceAgreement.create({
      agreementNumber: 'AGR-DASH-1',
      customer: fixture.customerId,
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
      serviceType: 'Урьдчилан сэргийлэх',
      slaUrgentHours: 6,
      slaStandardHours: 24,
      monthlyFee: 1_000_000,
      currency: 'MNT',
      status: 'ACTIVE',
    });

    const customers = (await summary()).customers as { activeServiceAgreements: number };
    expect(customers.activeServiceAgreements).toBe(1);
  });

  it('returns a fourteen point trend ending today', async () => {
    await seedRequest();

    const trend = (await summary()).trend as { date: string; created: number; completed: number }[];
    expect(trend).toHaveLength(14);
    expect(trend[13]?.created).toBe(1);
    // Ascending by date, so the chart can plot it without sorting.
    expect(trend[0]!.date < trend[13]!.date).toBe(true);
  });

  /**
   * The long view, beside the fourteen-day one.
   *
   * `createdAt` is stamped on insert and immutable under `timestamps: true`, so a fixture
   * that needs a request in the past has to move it through the raw collection — a
   * Mongoose `$set` on it is silently discarded, and a test written that way would pass by
   * putting every fixture in the current month.
   */
  it('returns six months of raised requests, oldest first', async () => {
    const backdate = async (id: string, monthsBack: number): Promise<void> => {
      const now = new Date();
      await ServiceRequest.collection.updateOne(
        { _id: new Types.ObjectId(id) },
        {
          $set: {
            createdAt: new Date(
              Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 15, 6),
            ),
          },
        },
      );
    };

    await backdate(await seedRequest(), 2);
    await backdate(await seedRequest(), 2);
    await seedRequest();

    const monthly = (await summary()).monthlyTrend as { month: string; count: number }[];

    expect(monthly).toHaveLength(6);
    expect([...monthly].map((point) => point.month).sort()).toEqual(
      monthly.map((point) => point.month),
    );
    expect(monthly[5]?.count).toBe(1);
    expect(monthly[3]?.count).toBe(2);
    // A month with nothing in it is a zero, not a missing point: the chart has to be able
    // to tell "nothing happened" from "no data".
    expect(monthly[4]?.count).toBe(0);
  });

  it('lists outstanding work for today rather than a log of what already happened', async () => {
    const overdueId = await seedRequest({
      slaDueAt: new Date(Date.now() - 86_400_000),
      status: 'ASSIGNED',
    });
    await seedRequest({ status: 'COMPLETED', completedAt: new Date() });

    const today = (await summary()).today as {
      items: { id: string; isOverdue: boolean }[];
      overdueCount: number;
      completedCount: number;
    };

    // The completed one is counted but not listed: it needs no action.
    expect(today.items.map((item) => item.id)).toEqual([overdueId]);
    expect(today.overdueCount).toBe(1);
    expect(today.completedCount).toBe(1);
  });

  it('puts overdue work before urgent work, and urgent before the rest', async () => {
    await seedRequest({ status: 'ASSIGNED', slaDueAt: new Date(Date.now() + 3_600_000) });
    const urgentId = await seedRequest({
      status: 'ASSIGNED',
      isUrgent: true,
      slaDueAt: new Date(Date.now() + 7_200_000),
    });
    const overdueId = await seedRequest({
      status: 'ASSIGNED',
      slaDueAt: new Date(Date.now() - 3_600_000),
    });

    const today = (await summary()).today as { items: { id: string }[] };
    expect(today.items[0]?.id).toBe(overdueId);
    expect(today.items[1]?.id).toBe(urgentId);
  });

  it('reports an unassigned item as such', async () => {
    // Due now rather than the helper's default of an hour out: an hour from 23:30 is
    // tomorrow, which drops the row from today's window and fails this an hour a day.
    await seedRequest({ status: 'UNASSIGNED', assignedEmployees: [], slaDueAt: new Date() });

    const today = (await summary()).today as {
      unassignedCount: number;
      items: { assigneeNames: string[] }[];
    };
    expect(today.unassignedCount).toBe(1);
    expect(today.items[0]?.assigneeNames).toEqual([]);
  });

  it('stamps the day with the configured timezone', async () => {
    const today = (await summary()).today as { date: string; timezone: string };
    expect(today.timezone).toBe('Asia/Ulaanbaatar');
    expect(today.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  /**
   * "Near breach" is the configured share of the SLA window consumed, not "falls due
   * before midnight". The two sets differ, and the dashboard used to serve the second
   * under the first one's name.
   */
  it('counts near breach by the consumed ratio, not by the request falling due today', async () => {
    // Falls due before midnight in the configured timezone, with essentially the whole
    // window still to run. Anchored to the day boundary rather than to a fixed offset,
    // because an offset from 23:30 lands tomorrow and would fail this half an hour a day.
    await seedRequest({
      status: 'ASSIGNED',
      slaStartedAt: new Date(Date.now() - 1_000),
      slaDueAt: dayBounds(new Date(), 'Asia/Ulaanbaatar').end,
    });

    const requests = (await summary()).requests as { slaNearBreach: number; dueToday: number };
    expect(requests.slaNearBreach).toBe(0);
    // Still due today: that figure is unchanged and keeps its own field.
    expect(requests.dueToday).toBe(1);
  });

  it('counts a request past the near-breach ratio but not yet due', async () => {
    // Twenty of a twenty-four hour window gone: past the 0.75 ratio, still open.
    await seedRequest({
      status: 'ASSIGNED',
      slaStartedAt: new Date(Date.now() - 20 * 3_600_000),
      slaDueAt: new Date(Date.now() + 4 * 3_600_000),
    });
    // Already breached, which is the other count and must not be double reported.
    await seedRequest({
      status: 'ASSIGNED',
      slaStartedAt: new Date(Date.now() - 30 * 3_600_000),
      slaDueAt: new Date(Date.now() - 6 * 3_600_000),
    });
    // Settled work leaves the SLA counts entirely.
    await seedRequest({
      status: 'COMPLETED',
      completedAt: new Date(),
      slaStartedAt: new Date(Date.now() - 20 * 3_600_000),
      slaDueAt: new Date(Date.now() + 4 * 3_600_000),
    });

    const requests = (await summary()).requests as {
      slaNearBreach: number;
      slaBreached: number;
    };
    expect(requests.slaNearBreach).toBe(1);
    expect(requests.slaBreached).toBe(1);
  });

  it('drops zero-count slices so the legend shows only what exists', async () => {
    await seedRequest({ status: 'NEW' });

    const byStatus = (await summary()).requestsByStatus as { key: string; count: number }[];
    expect(byStatus).toHaveLength(1);
    expect(byStatus[0]).toEqual({ key: 'NEW', label: 'Шинэ', count: 1 });
  });

  /**
   * The DTO has always documented this as a quantity-weighted mean. It was the plain mean
   * of the per-work percentages, which lets a one-task job outweigh a hundred-task one.
   */
  it('weights average planned-work progress by quantity, not by work count', async () => {
    await seedPlannedWork(1, 1); // finished, but one unit of work
    await seedPlannedWork(100, 0); // untouched, and a hundred times the size

    const plannedWork = (await summary()).plannedWork as {
      total: number;
      averageProgress: number | null;
    };
    expect(plannedWork.total).toBe(2);
    expect(plannedWork.averageProgress).not.toBe(50);
    // 1 of 101 units done.
    expect(plannedWork.averageProgress).toBe(1);
  });

  /** Null is "nothing to report"; zero would assert that everything is at 0%. */
  it('reports null average progress when there is no work to weigh', async () => {
    const plannedWork = (await summary()).plannedWork as {
      total: number;
      averageProgress: number | null;
    };
    expect(plannedWork.total).toBe(0);
    expect(plannedWork.averageProgress).toBeNull();
  });

  it('reports null rather than zero when work exists but carries no quantity', async () => {
    await seedPlannedWork(0, 0);

    const plannedWork = (await summary()).plannedWork as {
      total: number;
      averageProgress: number | null;
    };
    expect(plannedWork.total).toBe(1);
    expect(plannedWork.averageProgress).toBeNull();
  });

  /** Omitted, not zeroed, so the UI can tell "no permission" from "genuinely zero". */
  it('omits every block the caller may not see', async () => {
    const limited = await createUserWithPermissions('dash@test.mn', [PERMISSIONS.DASHBOARD_VIEW]);
    const limitedToken = await login(limited.email, limited.password);

    const data = await summary(limitedToken);

    expect(data.generatedAt).toBeTruthy();
    expect(data).not.toHaveProperty('requests');
    expect(data).not.toHaveProperty('risk');
    expect(data).not.toHaveProperty('finance');
    expect(data).not.toHaveProperty('today');
  });

  it('includes the request blocks for a caller who may read requests', async () => {
    const reader = await createUserWithPermissions('dashreq@test.mn', [
      PERMISSIONS.DASHBOARD_VIEW,
      PERMISSIONS.SERVICE_REQUEST_VIEW,
    ]);
    const readerToken = await login(reader.email, reader.password);

    const data = await summary(readerToken);
    expect(data).toHaveProperty('requests');
    expect(data).toHaveProperty('trend');
    expect(data).toHaveProperty('today');
    expect(data).not.toHaveProperty('finance');
  });

  it('refuses a caller without dashboard.view', async () => {
    const outsider = await createUserWithPermissions('dashout@test.mn', [
      PERMISSIONS.CUSTOMER_VIEW,
    ]);
    const outsiderToken = await login(outsider.email, outsider.password);

    const response = await request(app)
      .get(`${API}/dashboard/summary`)
      .set('Authorization', `Bearer ${outsiderToken}`);

    expect(response.status).toBe(403);
  });
});

describe('Dashboard layout', () => {
  const DEFAULT_KEYS = DEFAULT_DASHBOARD_LAYOUT.map((entry) => entry.key);

  it('serves the shipped default before anybody customises', async () => {
    const response = await request(app)
      .get(`${API}/dashboard/layout`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.isCustomised).toBe(false);
    expect(response.body.data.widgets.map((w: { key: string }) => w.key)).toEqual(DEFAULT_KEYS);
  });

  it('stores an arrangement and returns it on the next read', async () => {
    const reordered = [...DEFAULT_DASHBOARD_LAYOUT].reverse().map((entry) => ({ ...entry }));
    reordered[0] = { ...reordered[0]!, visible: false, size: 'FULL' as const };

    const saved = await request(app)
      .put(`${API}/dashboard/layout`)
      .set('Authorization', `Bearer ${token}`)
      .send({ widgets: reordered });
    expect(saved.status).toBe(200);
    expect(saved.body.data.isCustomised).toBe(true);

    const read = await request(app)
      .get(`${API}/dashboard/layout`)
      .set('Authorization', `Bearer ${token}`);
    expect(read.body.data.widgets[0]).toMatchObject({ key: reordered[0]!.key, visible: false });
  });

  it('resets back to the shipped arrangement', async () => {
    await request(app)
      .put(`${API}/dashboard/layout`)
      .set('Authorization', `Bearer ${token}`)
      .send({ widgets: [{ key: 'TODAY', visible: false, size: 'FULL' }] });

    const reset = await request(app)
      .delete(`${API}/dashboard/layout`)
      .set('Authorization', `Bearer ${token}`);

    expect(reset.body.data.isCustomised).toBe(false);
    expect(reset.body.data.widgets.map((w: { key: string }) => w.key)).toEqual(DEFAULT_KEYS);
  });

  /**
   * A layout saved before a widget existed must not hide it forever, and one naming a
   * widget the product has removed must not resurrect it.
   */
  it('appends widgets added since the layout was saved', async () => {
    await request(app)
      .put(`${API}/dashboard/layout`)
      .set('Authorization', `Bearer ${token}`)
      .send({ widgets: [{ key: 'TODAY', visible: true, size: 'FULL' }] });

    const read = await request(app)
      .get(`${API}/dashboard/layout`)
      .set('Authorization', `Bearer ${token}`);

    const keys = read.body.data.widgets.map((w: { key: string }) => w.key);
    expect(keys[0]).toBe('TODAY');
    expect(keys).toHaveLength(DEFAULT_KEYS.length);
    expect(new Set(keys)).toEqual(new Set(DEFAULT_KEYS));
  });

  /** The page lays out on six columns, so a saved width may be a third or two thirds. */
  it('stores the wider size vocabulary', async () => {
    const widths = DEFAULT_DASHBOARD_LAYOUT.map((entry, index) => ({
      ...entry,
      size: index === 0 ? ('TWO_THIRDS' as const) : ('THIRD' as const),
    }));

    const saved = await request(app)
      .put(`${API}/dashboard/layout`)
      .set('Authorization', `Bearer ${token}`)
      .send({ widgets: widths });

    expect(saved.status).toBe(200);

    const read = await request(app)
      .get(`${API}/dashboard/layout`)
      .set('Authorization', `Bearer ${token}`);
    expect(read.body.data.widgets[0].size).toBe('TWO_THIRDS');
    expect(read.body.data.widgets[1].size).toBe('THIRD');
  });

  it('rejects a duplicated widget', async () => {
    const response = await request(app)
      .put(`${API}/dashboard/layout`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        widgets: [
          { key: 'TODAY', visible: true, size: 'FULL' },
          { key: 'TODAY', visible: false, size: 'HALF' },
        ],
      });

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body.issues)).toContain('давхардсан');
  });

  it('rejects a widget that is not in the catalogue', async () => {
    const response = await request(app)
      .put(`${API}/dashboard/layout`)
      .set('Authorization', `Bearer ${token}`)
      .send({ widgets: [{ key: 'MADE_UP', visible: true, size: 'FULL' }] });

    expect(response.status).toBe(400);
  });

  /** A layout is one person's preference and must never leak between users. */
  it('keeps one caller arrangement out of another', async () => {
    await request(app)
      .put(`${API}/dashboard/layout`)
      .set('Authorization', `Bearer ${token}`)
      .send({ widgets: [{ key: 'TODAY', visible: false, size: 'FULL' }] });

    const other = await createUserWithPermissions('layout-other@test.mn', [
      PERMISSIONS.DASHBOARD_VIEW,
    ]);
    const otherToken = await login(other.email, other.password);

    const read = await request(app)
      .get(`${API}/dashboard/layout`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(read.body.data.isCustomised).toBe(false);
  });
});

/**
 * User-built widgets.
 *
 * A definition is personal and is only ever a saved question: the cases below pin both
 * halves of that, the ownership boundary and the fact that the caller's own right to read
 * the records is re-checked when the figures are produced rather than when they were saved.
 */
describe('Dashboard custom widgets', () => {
  async function createWidget(
    bearer = token,
    body: Record<string, unknown> = {},
  ): Promise<request.Response> {
    return request(app)
      .post(`${API}/dashboard/custom-widgets`)
      .set('Authorization', `Bearer ${bearer}`)
      .send({
        title: 'Барилгаар ирсэн хүсэлт',
        metric: 'COUNT',
        dimension: 'BUILDING',
        range: 'LAST_2_MONTHS',
        chart: 'BAR',
        ...body,
      });
  }

  async function layout(bearer = token): Promise<Record<string, unknown>> {
    const response = await request(app)
      .get(`${API}/dashboard/layout`)
      .set('Authorization', `Bearer ${bearer}`);
    expect(response.status).toBe(200);
    return response.body.data as Record<string, unknown>;
  }

  it('places a newly defined widget on the board without a second step', async () => {
    const created = await createWidget();
    expect(created.status).toBe(201);
    const widgetId = created.body.data.id as string;

    const board = await layout();
    const widgets = board.widgets as { key: string; customWidgetId: string | null }[];
    const custom = widgets.filter((entry) => entry.key === 'CUSTOM');

    expect(custom).toHaveLength(1);
    expect(custom[0]?.customWidgetId).toBe(widgetId);
    // The definition rides along, so the board can title it without a call per entry.
    expect(board.customWidgets).toHaveLength(1);
  });

  it('refuses a caller without dashboard.customise', async () => {
    const reader = await createUserWithPermissions('widgetreader@test.mn', [
      PERMISSIONS.DASHBOARD_VIEW,
      PERMISSIONS.SERVICE_REQUEST_VIEW,
    ]);
    const readerToken = await login(reader.email, reader.password);

    const response = await createWidget(readerToken);
    expect(response.status).toBe(403);
  });

  it('rejects a dimension and a range outside the allowlist before querying', async () => {
    expect((await createWidget(token, { dimension: 'SALARY' })).status).toBe(400);
    expect((await createWidget(token, { range: 'ALL_TIME' })).status).toBe(400);
    // A field path is not a dimension: the enum is what stops one reaching the pipeline.
    expect((await createWidget(token, { dimension: '$where' })).status).toBe(400);
  });

  it('counts the requests of the window by the chosen dimension', async () => {
    await seedRequest({ status: 'NEW' });
    await seedRequest({ status: 'NEW' });
    await seedRequest({ status: 'ASSIGNED' });

    const widgetId = (await createWidget(token, { dimension: 'STATUS' })).body.data.id as string;

    const response = await request(app)
      .get(`${API}/dashboard/custom-widgets/${widgetId}/insight`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    const body = response.body.data as {
      total: number;
      slices: { key: string; label: string; count: number }[];
    };
    expect(body.total).toBe(3);
    // An enum dimension is printed with the vocabulary the rest of the app uses.
    expect(body.slices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'NEW', count: 2 }),
        expect.objectContaining({ key: 'ASSIGNED', count: 1 }),
      ]),
    );
  });

  it('refuses the figures to a caller who may not read the records', async () => {
    const widgetId = (await createWidget()).body.data.id as string;

    // Holds the authoring key but not the source permission: a saved question is not a
    // licence to answer it, so the definition survives and the figures do not.
    const author = await createUserWithPermissions('widgetauthor@test.mn', [
      PERMISSIONS.DASHBOARD_VIEW,
      PERMISSIONS.DASHBOARD_CUSTOMISE,
    ]);
    const authorToken = await login(author.email, author.password);
    const own = (await createWidget(authorToken)).body.data.id as string;

    const response = await request(app)
      .get(`${API}/dashboard/custom-widgets/${own}/insight`)
      .set('Authorization', `Bearer ${authorToken}`);
    expect(response.status).toBe(403);

    // And the first user's widget is still theirs alone.
    const foreign = await request(app)
      .get(`${API}/dashboard/custom-widgets/${widgetId}/insight`)
      .set('Authorization', `Bearer ${authorToken}`);
    expect(foreign.status).toBe(404);
  });

  it("reports another user's definition as missing rather than forbidden", async () => {
    const widgetId = (await createWidget()).body.data.id as string;

    const other = await createSuperUser('otheradmin@test.mn');
    const otherToken = await login(other.email, other.password);

    // 404 rather than 403: a "forbidden" answer would confirm the id exists.
    expect(
      (
        await request(app)
          .delete(`${API}/dashboard/custom-widgets/${widgetId}`)
          .set('Authorization', `Bearer ${otherToken}`)
      ).status,
    ).toBe(404);
  });

  it('drops a deleted definition from the layout instead of breaking the board', async () => {
    const widgetId = (await createWidget()).body.data.id as string;
    const board = await layout();

    // Save the board while the widget is on it, so the stored layout really does name it.
    const saved = await request(app)
      .put(`${API}/dashboard/layout`)
      .set('Authorization', `Bearer ${token}`)
      .send({ widgets: board.widgets });
    expect(saved.status).toBe(200);

    expect(
      (
        await request(app)
          .delete(`${API}/dashboard/custom-widgets/${widgetId}`)
          .set('Authorization', `Bearer ${token}`)
      ).status,
    ).toBe(200);

    const after = await layout();
    const widgets = after.widgets as { key: string }[];
    expect(widgets.some((entry) => entry.key === 'CUSTOM')).toBe(false);
    expect(after.customWidgets).toHaveLength(0);
    // Every built-in is still present: a stale custom row must not take the board with it.
    expect(widgets).toHaveLength(DEFAULT_DASHBOARD_LAYOUT.length);
  });

  it('refuses a layout naming a definition the caller does not own', async () => {
    const board = await layout();
    const widgets = board.widgets as unknown[];

    const response = await request(app)
      .put(`${API}/dashboard/layout`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        widgets: [
          ...widgets,
          {
            key: 'CUSTOM',
            customWidgetId: '507f1f77bcf86cd799439099',
            visible: true,
            size: 'THIRD',
          },
        ],
      });

    expect(response.status).toBe(400);
  });
});
