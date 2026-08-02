import { PERMISSIONS } from '@monhorus/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createUserWithPermissions,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
} from '../../test/helpers';
import { AuditLog } from '../audit/audit-log.model';
import { StoredFile } from '../storage/stored-file.model';
import { Customer, FloorPlan } from './object.models';

const API = '/api/v1';

let app: Express;
let token: string;
let floorId: string;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  return response.body.data.tokens.accessToken as string;
}

async function uploadPlan(
  bearer = token,
  filename = 'plan.png',
  contentType = 'image/png',
  title = '2 давхарын төлөвлөгөө',
): Promise<request.Response> {
  return request(app)
    .put(`${API}/floors/${floorId}/plan`)
    .set('Authorization', `Bearer ${bearer}`)
    .field('title', title)
    .attach('file', Buffer.from('plan-image-bytes'), { filename, contentType });
}

beforeAll(async () => {
  app = await startTestApp();
}, 60_000);

afterAll(async () => {
  await stopTestApp();
});

beforeEach(async () => {
  await resetDomainCollections();
  const customer = await Customer.create({ code: 'CT', name: 'Central Tower ХХК' });

  const user = await createUserWithPermissions('plan@test.mn', [
    PERMISSIONS.OBJECT_VIEW,
    PERMISSIONS.OBJECT_MANAGE,
  ]);
  token = await login(user.email, user.password);

  const project = await request(app)
    .post(`${API}/projects`)
    .set('Authorization', `Bearer ${token}`)
    .send({ customerId: String(customer._id), code: 'PRJ-1', name: 'Төсөл' });

  const building = await request(app)
    .post(`${API}/buildings`)
    .set('Authorization', `Bearer ${token}`)
    .send({ projectId: project.body.data.id, code: 'BLD-1', name: 'Барилга' });

  const floor = await request(app)
    .post(`${API}/floors`)
    .set('Authorization', `Bearer ${token}`)
    .send({ buildingId: building.body.data.id, code: 'FL-2', name: '2 давхар', floorNumber: 2 });
  floorId = floor.body.data.id;
});

describe('floor plan image', () => {
  it('returns null rather than 404 when no plan exists yet', async () => {
    const response = await request(app)
      .get(`${API}/floors/${floorId}/plan`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
  });

  it('reports hasPlanImage false on the floor before an upload', async () => {
    const floor = await request(app)
      .get(`${API}/floors/${floorId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(floor.body.data.hasPlanImage).toBe(false);
  });

  it('uploads a plan and exposes it immediately with a download url', async () => {
    const response = await uploadPlan();

    expect(response.status).toBe(200);
    expect(response.body.data.fileName).toBe('plan.png');
    expect(response.body.data.title).toBe('2 давхарын төлөвлөгөө');
    expect(response.body.data.downloadUrl).toMatch(/^\/api\/v1\/files\//);
    expect(response.body.data.uploadedByName).not.toBeNull();

    const floor = await request(app)
      .get(`${API}/floors/${floorId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(floor.body.data.hasPlanImage).toBe(true);
  });

  it('accepts a PDF plan', async () => {
    const response = await uploadPlan(token, 'plan.pdf', 'application/pdf');
    expect(response.status).toBe(200);
  });

  it('refuses a file type that is not an image or a PDF', async () => {
    const response = await request(app)
      .put(`${API}/floors/${floorId}/plan`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('not-a-plan'), {
        filename: 'sheet.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('PNG, JPG, WEBP');
  });

  /**
   * Replacement keeps exactly one plan and one stored file. There is no version chain:
   * section 19.2 leaves the plan editor and its migration unapproved, so a superseded
   * image would be an unreachable orphan.
   */
  it('replaces the current image without leaving a second record behind', async () => {
    await uploadPlan(token, 'first.png');
    const replaced = await uploadPlan(token, 'second.png');

    expect(replaced.status).toBe(200);
    expect(replaced.body.data.fileName).toBe('second.png');

    expect(await FloorPlan.countDocuments({ floor: floorId })).toBe(1);
    expect(await StoredFile.countDocuments({ ownerType: 'FLOOR_PLAN' })).toBe(1);
  });

  it('exposes no version fields at all', async () => {
    const response = await uploadPlan();

    expect(response.body.data).not.toHaveProperty('version');
    expect(response.body.data).not.toHaveProperty('supersededBy');
    expect(response.body.data).not.toHaveProperty('isCurrent');
  });

  it('edits metadata without touching the file', async () => {
    const uploaded = await uploadPlan();
    const originalFileId = uploaded.body.data.fileId;

    const response = await request(app)
      .patch(`${API}/floors/${floorId}/plan`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Шинэчилсэн гарчиг', description: 'Тайлбар нэмсэн' });

    expect(response.status).toBe(200);
    expect(response.body.data.title).toBe('Шинэчилсэн гарчиг');
    expect(response.body.data.description).toBe('Тайлбар нэмсэн');
    expect(response.body.data.fileId).toBe(originalFileId);
  });

  it('removes the plan and its stored file', async () => {
    await uploadPlan();

    const response = await request(app)
      .delete(`${API}/floors/${floorId}/plan`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(await FloorPlan.countDocuments({ floor: floorId })).toBe(0);
    expect(await StoredFile.countDocuments({ ownerType: 'FLOOR_PLAN' })).toBe(0);
  });

  it('refuses to remove a plan that does not exist', async () => {
    const response = await request(app)
      .delete(`${API}/floors/${floorId}/plan`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
  });

  it('refuses plan management on an archived floor', async () => {
    await request(app)
      .patch(`${API}/floors/${floorId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ isActive: false });

    const response = await uploadPlan();
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Архивласан');
  });

  it('refuses upload without object.manage', async () => {
    const reader = await createUserWithPermissions('planread@test.mn', [PERMISSIONS.OBJECT_VIEW]);
    const readerToken = await login(reader.email, reader.password);

    const response = await uploadPlan(readerToken);
    expect(response.status).toBe(403);
  });

  it('serves the plan file only to a caller holding object.view', async () => {
    const uploaded = await uploadPlan();
    const fileId = uploaded.body.data.fileId;

    const outsider = await createUserWithPermissions('planout@test.mn', [
      PERMISSIONS.DASHBOARD_VIEW,
    ]);
    const outsiderToken = await login(outsider.email, outsider.password);

    const forbidden = await request(app)
      .get(`${API}/files/${fileId}`)
      .set('Authorization', `Bearer ${outsiderToken}`);
    expect(forbidden.status).toBe(403);

    const allowed = await request(app)
      .get(`${API}/files/${fileId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(allowed.status).toBe(200);
  });

  /** Section 11.1: "Plan дээрх бүх өөрчлөлт audit history-д хадгалагдана." */
  it('audits upload, replacement, metadata edit and removal', async () => {
    await uploadPlan(token, 'first.png');
    await uploadPlan(token, 'second.png');
    await request(app)
      .patch(`${API}/floors/${floorId}/plan`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Шинэ гарчиг' });
    await request(app)
      .delete(`${API}/floors/${floorId}/plan`)
      .set('Authorization', `Bearer ${token}`);

    const entries = await AuditLog.find({ entityType: 'FloorPlan', entityId: floorId });
    const reasons = entries.map((entry) => entry.reason);

    expect(reasons).toContain('floor plan uploaded');
    expect(reasons).toContain('floor plan replaced');
    expect(reasons).toContain('floor plan metadata updated');
    expect(reasons).toContain('floor plan removed');
  });

  it('names both files in the replacement audit record', async () => {
    await uploadPlan(token, 'first.png');
    await uploadPlan(token, 'second.png');

    const entry = await AuditLog.findOne({
      entityType: 'FloorPlan',
      reason: 'floor plan replaced',
    });

    expect((entry?.oldValue as { fileName: string }).fileName).toBe('first.png');
    expect((entry?.newValue as { fileName: string }).fileName).toBe('second.png');
  });

  it('blocks floor deletion while a plan is attached', async () => {
    await uploadPlan();

    const response = await request(app)
      .delete(`${API}/floors/${floorId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(409);
    expect(response.body.message).toContain('План зураг');
  });
});
