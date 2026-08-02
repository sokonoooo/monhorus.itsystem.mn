import { PERMISSIONS } from '@monhorus/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createSuperUser,
  createUserWithPermissions,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
} from '../../test/helpers';
import { Notification } from './notification.model';
import { notify } from './notification.service';

const API = '/api/v1';

let app: Express;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  return response.body.data.tokens.accessToken as string;
}

describe('Notification API', () => {
  beforeAll(async () => {
    app = await startTestApp();
  });

  afterAll(async () => {
    await stopTestApp();
  });

  beforeEach(async () => {
    await resetDomainCollections();
  });

  /** Section 14.3 names recipients by duty; a duty is the permission that duty holds. */
  it('writes one notification per permission holder', async () => {
    const manager = await createUserWithPermissions('mgr@test.mn', [PERMISSIONS.INVOICE_VIEW]);
    await createUserWithPermissions('other@test.mn', [PERMISSIONS.DASHBOARD_VIEW]);

    await notify({
      event: 'INVOICE_ISSUED',
      title: 'INV-202607-0001 нэхэмжлэл илгээгдлээ',
      permission: PERMISSIONS.INVOICE_VIEW,
    });

    const rows = await Notification.find().lean();
    const recipients = rows.map((row) => String(row.recipient));
    expect(recipients).toContain(String(manager.userId));
    expect(rows).toHaveLength(1);
  });

  it('never notifies the person who caused the event', async () => {
    const actor = await createUserWithPermissions('actor@test.mn', [PERMISSIONS.INVOICE_VIEW]);

    await notify({
      event: 'INVOICE_ISSUED',
      title: 'Илгээлээ',
      permission: PERMISSIONS.INVOICE_VIEW,
      excludeUserId: actor.userId,
    });

    expect(await Notification.countDocuments()).toBe(0);
  });

  it('derives the severity from the event rather than taking it from the caller', async () => {
    await createUserWithPermissions('sev@test.mn', [PERMISSIONS.INVOICE_VIEW]);

    await notify({
      event: 'INVOICE_OVERDUE',
      title: 'Хугацаа хэтэрсэн',
      permission: PERMISSIONS.INVOICE_VIEW,
    });

    const row = await Notification.findOne().lean();
    expect(row?.severity).toBe('CRITICAL');
  });

  it('returns only the caller own notifications', async () => {
    const mine = await createUserWithPermissions('mine@test.mn', [
      PERMISSIONS.NOTIFICATION_VIEW,
      PERMISSIONS.INVOICE_VIEW,
    ]);
    const theirs = await createUserWithPermissions('theirs@test.mn', [
      PERMISSIONS.NOTIFICATION_VIEW,
      PERMISSIONS.INVOICE_VIEW,
    ]);

    await notify({
      event: 'INVOICE_ISSUED',
      title: 'Бүгдэд',
      permission: PERMISSIONS.INVOICE_VIEW,
    });

    const token = await login(mine.email, mine.password);
    const response = await request(app)
      .get(`${API}/notifications`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.total).toBe(1);
    expect(await Notification.countDocuments({ recipient: theirs.userId })).toBe(1);
  });

  it('marks one notification read and drops the unread count', async () => {
    const user = await createUserWithPermissions('read@test.mn', [
      PERMISSIONS.NOTIFICATION_VIEW,
      PERMISSIONS.INVOICE_VIEW,
    ]);
    await notify({
      event: 'INVOICE_ISSUED',
      title: 'Уншаагүй',
      permission: PERMISSIONS.INVOICE_VIEW,
    });
    const token = await login(user.email, user.password);

    const before = await request(app)
      .get(`${API}/notifications/unread-count`)
      .set('Authorization', `Bearer ${token}`);
    expect(before.body.data.unread).toBe(1);

    const list = await request(app)
      .get(`${API}/notifications`)
      .set('Authorization', `Bearer ${token}`);
    const id = list.body.data.items[0].id as string;

    const marked = await request(app)
      .post(`${API}/notifications/${id}/read`)
      .set('Authorization', `Bearer ${token}`);
    expect(marked.body.data.readAt).toBeTruthy();

    const after = await request(app)
      .get(`${API}/notifications/unread-count`)
      .set('Authorization', `Bearer ${token}`);
    expect(after.body.data.unread).toBe(0);
  });

  /** One caller must not be able to touch, or probe for, another caller's inbox. */
  it('refuses to mark somebody else notification read', async () => {
    const owner = await createUserWithPermissions('owner@test.mn', [
      PERMISSIONS.NOTIFICATION_VIEW,
      PERMISSIONS.INVOICE_VIEW,
    ]);
    const intruder = await createUserWithPermissions('intruder@test.mn', [
      PERMISSIONS.NOTIFICATION_VIEW,
    ]);

    await notify({
      event: 'INVOICE_ISSUED',
      title: 'Хувийн',
      permission: PERMISSIONS.INVOICE_VIEW,
    });
    const row = await Notification.findOne({ recipient: owner.userId }).lean();
    const intruderToken = await login(intruder.email, intruder.password);

    const response = await request(app)
      .post(`${API}/notifications/${String(row?._id)}/read`)
      .set('Authorization', `Bearer ${intruderToken}`);

    expect(response.status).toBe(404);
    const untouched = await Notification.findById(row?._id).lean();
    expect(untouched?.readAt).toBeNull();
  });

  it('marks everything read at once', async () => {
    const user = await createUserWithPermissions('all@test.mn', [
      PERMISSIONS.NOTIFICATION_VIEW,
      PERMISSIONS.INVOICE_VIEW,
    ]);
    await notify({ event: 'INVOICE_ISSUED', title: 'A', permission: PERMISSIONS.INVOICE_VIEW });
    await notify({ event: 'INVOICE_DUE_SOON', title: 'B', permission: PERMISSIONS.INVOICE_VIEW });
    const token = await login(user.email, user.password);

    const response = await request(app)
      .post(`${API}/notifications/read-all`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.data.updated).toBe(2);
    expect(await Notification.countDocuments({ recipient: user.userId, readAt: null })).toBe(0);
  });

  it('filters to unread only', async () => {
    const user = await createUserWithPermissions('unread@test.mn', [
      PERMISSIONS.NOTIFICATION_VIEW,
      PERMISSIONS.INVOICE_VIEW,
    ]);
    await notify({ event: 'INVOICE_ISSUED', title: 'A', permission: PERMISSIONS.INVOICE_VIEW });
    await notify({ event: 'INVOICE_DUE_SOON', title: 'B', permission: PERMISSIONS.INVOICE_VIEW });
    const token = await login(user.email, user.password);

    const list = await request(app)
      .get(`${API}/notifications`)
      .set('Authorization', `Bearer ${token}`);
    await request(app)
      .post(`${API}/notifications/${list.body.data.items[0].id}/read`)
      .set('Authorization', `Bearer ${token}`);

    const unread = await request(app)
      .get(`${API}/notifications?unreadOnly=true`)
      .set('Authorization', `Bearer ${token}`);

    expect(unread.body.data.items).toHaveLength(1);
  });

  it('requires notification.view', async () => {
    const outsider = await createUserWithPermissions('no-notify@test.mn', [
      PERMISSIONS.DASHBOARD_VIEW,
    ]);
    const token = await login(outsider.email, outsider.password);

    const response = await request(app)
      .get(`${API}/notifications`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
  });

  /** A notification failure must never break the operation that raised it. */
  it('swallows its own failure instead of throwing', async () => {
    const superUser = await createSuperUser();
    await expect(
      notify({
        event: 'INVOICE_ISSUED',
        title: 'x'.repeat(5000),
        permission: PERMISSIONS.INVOICE_VIEW,
        excludeUserId: superUser.userId,
      }),
    ).resolves.toBeUndefined();
  });
});
