import { PERMISSIONS } from '@monhorus/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createObjectFixture,
  createOrgFixture,
  createUserWithPermissions,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
  type ObjectFixture,
  type OrgFixture,
} from '../../test/helpers';
import { Employee } from '../employee/employee.model';

const API = '/api/v1';

const OPERATOR_PERMISSIONS = [
  PERMISSIONS.PLANNED_WORK_VIEW,
  PERMISSIONS.PLANNED_WORK_CREATE,
  PERMISSIONS.PLANNED_WORK_UPDATE,
  PERMISSIONS.PLANNED_WORK_CHANGE_STATUS,
  PERMISSIONS.SERVICE_REQUEST_VIEW,
  PERMISSIONS.SERVICE_REQUEST_CREATE,
] as const;

let app: Express;
let org: OrgFixture;
let objects: ObjectFixture;
let token: string;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  return response.body.data.tokens.accessToken as string;
}

async function createWork(
  overrides: Record<string, unknown> = {},
  bearer = token,
): Promise<string> {
  const response = await request(app)
    .post(`${API}/planned-work`)
    .set('Authorization', `Bearer ${bearer}`)
    .send({
      projectId: objects.projectId,
      buildingId: objects.buildingId,
      title: 'Улирлын үзлэг',
      plannedStartDate: '2026-07-05T00:00:00.000Z',
      plannedEndDate: '2026-07-20T00:00:00.000Z',
      assignedEmployeeIds: [],
      ...overrides,
    });
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

async function createRequest(): Promise<string> {
  const response = await request(app)
    .post(`${API}/service-requests`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      customerId: objects.customerId,
      buildingId: objects.buildingId,
      requestType: 'URGENT_CALL',
      isUrgent: true,
      description: 'Гэрэлтүүлэг ажиллахгүй байна',
      contactName: 'Бат',
      contactPhone: '99001122',
      attachmentIds: [],
    });
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

async function activeEmployee(code = 'EMP-CAL'): Promise<string> {
  const employee = await Employee.create({
    employeeCode: code,
    firstName: 'Дорж',
    lastName: 'Бат',
    company: org.companyId,
    department: org.departmentId,
    position: org.positionId,
    employeeType: 'FULL_TIME',
    employmentStartDate: new Date('2024-01-01'),
    status: 'ACTIVE',
  });
  return String(employee._id);
}

/** Window covering the fixture dates. */
const WINDOW = 'from=2026-07-01T00:00:00.000Z&to=2026-07-31T00:00:00.000Z';

beforeAll(async () => {
  app = await startTestApp();
}, 60_000);

afterAll(async () => {
  await stopTestApp();
});

beforeEach(async () => {
  await resetDomainCollections();
  org = await createOrgFixture();
  objects = await createObjectFixture();
  const user = await createUserWithPermissions('cal@test.mn', OPERATOR_PERMISSIONS);
  token = await login(user.email, user.password);
});

describe('GET /calendar', () => {
  it('requires an explicit window', async () => {
    const response = await request(app)
      .get(`${API}/calendar`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
  });

  it('refuses a window wider than the configured maximum', async () => {
    const response = await request(app)
      .get(`${API}/calendar?from=2026-01-01T00:00:00.000Z&to=2027-01-01T00:00:00.000Z`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body.issues)).toContain('хоногоос их байж болохгүй');
  });

  it('refuses an inverted window', async () => {
    const response = await request(app)
      .get(`${API}/calendar?from=2026-07-31T00:00:00.000Z&to=2026-07-01T00:00:00.000Z`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
  });

  it('projects a planned work with its backend derived status and progress', async () => {
    const workId = await createWork();

    const response = await request(app)
      .get(`${API}/calendar?${WINDOW}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    const event = (response.body.data.events as { sourceId: string }[]).find(
      (entry) => entry.sourceId === workId,
    ) as Record<string, unknown> | undefined;

    expect(event).toBeDefined();
    expect(event?.source).toBe('PLANNED_WORK');
    expect(event?.status).toBe('DRAFT');
    expect(event?.statusLabel).toBe('Төсөл');
    expect(event?.progressPercent).toBe(0);
    expect(event?.detailPath).toBe(`/planned-work/${workId}`);
    expect(event?.id).toBe(`PLANNED_WORK:${workId}`);
  });

  it('reports the server timezone so the client renders in one place', async () => {
    const response = await request(app)
      .get(`${API}/calendar?${WINDOW}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.data.timezone).toBe('Asia/Ulaanbaatar');
  });

  it('projects a service request against its SLA deadline', async () => {
    const requestId = await createRequest();

    const now = new Date();
    const from = new Date(now.getTime() - 86_400_000).toISOString();
    const to = new Date(now.getTime() + 7 * 86_400_000).toISOString();

    const response = await request(app)
      .get(`${API}/calendar?from=${from}&to=${to}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    const event = (response.body.data.events as { sourceId: string }[]).find(
      (entry) => entry.sourceId === requestId,
    ) as Record<string, unknown> | undefined;

    expect(event).toBeDefined();
    expect(event?.source).toBe('SERVICE_REQUEST');
    expect(event?.isUrgent).toBe(true);
    // A request carries no quantity based progress.
    expect(event?.progressPercent).toBeNull();
    expect(event?.detailPath).toBe(`/service-requests/${requestId}`);
  });

  it('shows an overdue planned work as OVERDUE, derived by the backend', async () => {
    await createWork({
      plannedStartDate: '2020-01-05T00:00:00.000Z',
      plannedEndDate: '2020-01-20T00:00:00.000Z',
    });
    // The work must be past DRAFT before it can read as overdue.
    const list = await request(app)
      .get(`${API}/planned-work`)
      .set('Authorization', `Bearer ${token}`);
    const workId = list.body.data.items[0].id as string;
    await request(app)
      .post(`${API}/planned-work/${workId}/transition`)
      .set('Authorization', `Bearer ${token}`)
      .send({ action: 'PLAN' });

    const response = await request(app)
      .get(`${API}/calendar?from=2020-01-01T00:00:00.000Z&to=2020-01-31T00:00:00.000Z`)
      .set('Authorization', `Bearer ${token}`);

    const event = (response.body.data.events as { sourceId: string }[]).find(
      (entry) => entry.sourceId === workId,
    ) as Record<string, unknown> | undefined;

    expect(event?.status).toBe('OVERDUE');
    expect(event?.isOverdue).toBe(true);
    expect(event?.statusLabel).toBe('Хугацаа хэтэрсэн');
  });

  it('excludes a work outside the requested window', async () => {
    await createWork({
      plannedStartDate: '2026-09-01T00:00:00.000Z',
      plannedEndDate: '2026-09-10T00:00:00.000Z',
    });

    const response = await request(app)
      .get(`${API}/calendar?${WINDOW}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.data.events).toHaveLength(0);
  });

  it('includes a work that merely overlaps the window', async () => {
    await createWork({
      plannedStartDate: '2026-06-20T00:00:00.000Z',
      plannedEndDate: '2026-08-10T00:00:00.000Z',
    });

    const response = await request(app)
      .get(`${API}/calendar?${WINDOW}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.data.events).toHaveLength(1);
  });

  it('excludes a cancelled work, which is not a schedule commitment', async () => {
    const canceller = await createUserWithPermissions('calcancel@test.mn', [
      ...OPERATOR_PERMISSIONS,
      PERMISSIONS.PLANNED_WORK_CANCEL,
    ]);
    const cancellerToken = await login(canceller.email, canceller.password);
    const workId = await createWork({}, cancellerToken);

    await request(app)
      .post(`${API}/planned-work/${workId}/transition`)
      .set('Authorization', `Bearer ${cancellerToken}`)
      .send({ action: 'CANCEL', reason: 'Захиалагч татгалзав' });

    const response = await request(app)
      .get(`${API}/calendar?${WINDOW}`)
      .set('Authorization', `Bearer ${cancellerToken}`);

    expect(response.body.data.events).toHaveLength(0);
  });

  it('filters by source', async () => {
    await createWork();
    await createRequest();

    const response = await request(app)
      .get(`${API}/calendar?${WINDOW}&sources=PLANNED_WORK`)
      .set('Authorization', `Bearer ${token}`);

    const sources = new Set(
      (response.body.data.events as { source: string }[]).map((entry) => entry.source),
    );
    expect(sources).toEqual(new Set(['PLANNED_WORK']));
  });

  it('filters by assigned employee', async () => {
    const employeeId = await activeEmployee('EMP-CAL-1');
    await createWork({ title: 'Хуваарилагдсан', assignedEmployeeIds: [employeeId] });
    await createWork({ title: 'Хуваарилагдаагүй' });

    const response = await request(app)
      .get(`${API}/calendar?${WINDOW}&employeeId=${employeeId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.data.events).toHaveLength(1);
    expect(response.body.data.events[0].title).toBe('Хуваарилагдсан');
    expect(response.body.data.events[0].assignedNames).toEqual(['Бат Дорж']);
  });

  it('filters by building and by project', async () => {
    await createWork();

    const matching = await request(app)
      .get(`${API}/calendar?${WINDOW}&buildingId=${objects.buildingId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(matching.body.data.events).toHaveLength(1);

    const other = await request(app)
      .get(`${API}/calendar?${WINDOW}&buildingId=${objects.foreignBuildingId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(other.body.data.events).toHaveLength(0);
  });

  it('filters by status', async () => {
    await createWork();

    const draft = await request(app)
      .get(`${API}/calendar?${WINDOW}&status=DRAFT`)
      .set('Authorization', `Bearer ${token}`);
    expect(draft.body.data.events).toHaveLength(1);

    const started = await request(app)
      .get(`${API}/calendar?${WINDOW}&status=STARTED`)
      .set('Authorization', `Bearer ${token}`);
    expect(started.body.data.events).toHaveLength(0);
  });

  it('returns events sorted by start instant', async () => {
    await createWork({
      title: 'Хожим',
      plannedStartDate: '2026-07-20T00:00:00.000Z',
      plannedEndDate: '2026-07-25T00:00:00.000Z',
    });
    await createWork({
      title: 'Эрт',
      plannedStartDate: '2026-07-02T00:00:00.000Z',
      plannedEndDate: '2026-07-06T00:00:00.000Z',
    });

    const response = await request(app)
      .get(`${API}/calendar?${WINDOW}`)
      .set('Authorization', `Bearer ${token}`);

    const titles = (response.body.data.events as { title: string }[]).map((entry) => entry.title);
    expect(titles).toEqual(['Эрт', 'Хожим']);
  });
});

describe('calendar source permissions', () => {
  it('omits planned work for a caller who may only read requests', async () => {
    await createWork();
    await createRequest();

    const requestsOnly = await createUserWithPermissions('calreq@test.mn', [
      PERMISSIONS.SERVICE_REQUEST_VIEW,
    ]);
    const requestsToken = await login(requestsOnly.email, requestsOnly.password);

    const now = new Date();
    const from = new Date(now.getTime() - 86_400_000).toISOString();
    const to = new Date(now.getTime() + 7 * 86_400_000).toISOString();

    const response = await request(app)
      .get(`${API}/calendar?from=${from}&to=${to}`)
      .set('Authorization', `Bearer ${requestsToken}`);

    expect(response.status).toBe(200);
    const sources = new Set(
      (response.body.data.events as { source: string }[]).map((entry) => entry.source),
    );
    expect(sources.has('PLANNED_WORK')).toBe(false);
    expect(sources.has('SERVICE_REQUEST')).toBe(true);
  });

  it('omits requests for a caller who may only read planned work', async () => {
    await createWork();
    await createRequest();

    const worksOnly = await createUserWithPermissions('calwork@test.mn', [
      PERMISSIONS.PLANNED_WORK_VIEW,
    ]);
    const worksToken = await login(worksOnly.email, worksOnly.password);

    const response = await request(app)
      .get(`${API}/calendar?${WINDOW}`)
      .set('Authorization', `Bearer ${worksToken}`);

    expect(response.status).toBe(200);
    const sources = new Set(
      (response.body.data.events as { source: string }[]).map((entry) => entry.source),
    );
    expect(sources.has('SERVICE_REQUEST')).toBe(false);
    expect(sources.has('PLANNED_WORK')).toBe(true);
  });

  it('refuses a caller who may read neither source', async () => {
    const outsider = await createUserWithPermissions('calnone@test.mn', [
      PERMISSIONS.DASHBOARD_VIEW,
    ]);
    const outsiderToken = await login(outsider.email, outsider.password);

    const response = await request(app)
      .get(`${API}/calendar?${WINDOW}`)
      .set('Authorization', `Bearer ${outsiderToken}`);

    expect(response.status).toBe(403);
  });
});
