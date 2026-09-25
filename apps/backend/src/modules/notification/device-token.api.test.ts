import { PERMISSIONS } from '@monhorus/shared';
import type { Express } from 'express';
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createUserWithPermissions,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
} from '../../test/helpers';
import { DeviceToken } from './device-token.model';
import { notify } from './notification.service';
import { setPushTransport, type PushMessage, type PushOutcome } from './push.service';

const API = '/api/v1';
let app: Express;

/**
 * Stands in for FCM. Records what was dispatched, and answers with whatever verdict the
 * case under test needs — which is the only way to exercise the dead-token cleanup without
 * a live Firebase project.
 */
function captureTransport(verdict: (token: string) => PushOutcome['status'] = () => 'sent') {
  const sent: PushMessage[] = [];
  return {
    sent,
    transport: {
      kind: 'fcm' as const,
      async send(messages: readonly PushMessage[]): Promise<PushOutcome[]> {
        sent.push(...messages);
        return messages.map((message) => {
          const status = verdict(message.token);
          return status === 'failed'
            ? { token: message.token, status, reason: 'UNAVAILABLE' }
            : { token: message.token, status };
        });
      },
    },
  };
}

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  return response.body.data.tokens.accessToken as string;
}

describe('Device token API', () => {
  beforeAll(async () => {
    app = await startTestApp();
  });
  afterAll(async () => {
    await stopTestApp();
  });
  beforeEach(async () => {
    await resetDomainCollections();
  });
  afterEach(() => {
    setPushTransport(null);
  });

  it('registers a device against the calling user', async () => {
    const user = await createUserWithPermissions('dev1@test.mn', [PERMISSIONS.NOTIFICATION_VIEW]);
    const token = await login(user.email, user.password);

    const response = await request(app)
      .post(`${API}/notifications/devices`)
      .set('Authorization', `Bearer ${token}`)
      .send({ token: 'fcm-token-aaaaaaaaaa', platform: 'android', appId: 'mn.monhorus.employee' });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ platform: 'android', active: true });

    const stored = await DeviceToken.findOne({ token: 'fcm-token-aaaaaaaaaa' }).lean();
    expect(String(stored?.user)).toBe(user.userId);
  });

  /**
   * The requirement that rules out the obvious one-token-per-user column: a technician with
   * a phone and a tablet must be reachable on both.
   */
  it('keeps every device a user registers, not just the newest', async () => {
    const user = await createUserWithPermissions('dev2@test.mn', [PERMISSIONS.NOTIFICATION_VIEW]);
    const token = await login(user.email, user.password);

    for (const value of ['token-phone-aaaaaa', 'token-tablet-bbbbb']) {
      await request(app)
        .post(`${API}/notifications/devices`)
        .set('Authorization', `Bearer ${token}`)
        .send({ token: value, platform: 'android' });
    }

    const rows = await DeviceToken.find({ user: new Types.ObjectId(user.userId) }).lean();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.active)).toBe(true);
  });

  /** Registering the same install twice is the app's launch behaviour, not a duplicate. */
  it('updates rather than duplicates when the same token registers again', async () => {
    const user = await createUserWithPermissions('dev3@test.mn', [PERMISSIONS.NOTIFICATION_VIEW]);
    const token = await login(user.email, user.password);

    for (let i = 0; i < 3; i += 1) {
      await request(app)
        .post(`${API}/notifications/devices`)
        .set('Authorization', `Bearer ${token}`)
        .send({ token: 'token-repeat-cccccc', platform: 'android' });
    }

    expect(await DeviceToken.countDocuments({ token: 'token-repeat-cccccc' })).toBe(1);
  });

  /**
   * A handset handed to a colleague. The new owner's registration must take the token over,
   * or the previous owner keeps receiving notifications on a phone they no longer hold.
   */
  it('reassigns a token when a different user registers it', async () => {
    const first = await createUserWithPermissions('dev4a@test.mn', [PERMISSIONS.NOTIFICATION_VIEW]);
    const second = await createUserWithPermissions('dev4b@test.mn', [
      PERMISSIONS.NOTIFICATION_VIEW,
    ]);

    const firstToken = await login(first.email, first.password);
    await request(app)
      .post(`${API}/notifications/devices`)
      .set('Authorization', `Bearer ${firstToken}`)
      .send({ token: 'token-shared-dddddd', platform: 'android' });

    const secondToken = await login(second.email, second.password);
    await request(app)
      .post(`${API}/notifications/devices`)
      .set('Authorization', `Bearer ${secondToken}`)
      .send({ token: 'token-shared-dddddd', platform: 'android' });

    const rows = await DeviceToken.find({ token: 'token-shared-dddddd' }).lean();
    expect(rows).toHaveLength(1);
    expect(String(rows[0]?.user)).toBe(second.userId);
  });

  it('deactivates a device on unregister', async () => {
    const user = await createUserWithPermissions('dev5@test.mn', [PERMISSIONS.NOTIFICATION_VIEW]);
    const token = await login(user.email, user.password);

    await request(app)
      .post(`${API}/notifications/devices`)
      .set('Authorization', `Bearer ${token}`)
      .send({ token: 'token-bye-eeeeeee', platform: 'android' });

    const response = await request(app)
      .post(`${API}/notifications/devices/unregister`)
      .set('Authorization', `Bearer ${token}`)
      .send({ token: 'token-bye-eeeeeee' });

    expect(response.status).toBe(200);
    expect(response.body.data.deactivated).toBe(1);
    expect((await DeviceToken.findOne({ token: 'token-bye-eeeeeee' }).lean())?.active).toBe(false);
  });

  /** A token string must not be a remote control for somebody else's phone. */
  it('will not let one user unregister another user\'s device', async () => {
    const owner = await createUserWithPermissions('dev6a@test.mn', [PERMISSIONS.NOTIFICATION_VIEW]);
    const stranger = await createUserWithPermissions('dev6b@test.mn', [
      PERMISSIONS.NOTIFICATION_VIEW,
    ]);

    const ownerToken = await login(owner.email, owner.password);
    await request(app)
      .post(`${API}/notifications/devices`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ token: 'token-victim-ffffff', platform: 'android' });

    const strangerToken = await login(stranger.email, stranger.password);
    const response = await request(app)
      .post(`${API}/notifications/devices/unregister`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .send({ token: 'token-victim-ffffff' });

    // Reported as success so the response does not confirm the token exists...
    expect(response.status).toBe(200);
    expect(response.body.data.deactivated).toBe(0);
    // ...but the device is untouched.
    expect((await DeviceToken.findOne({ token: 'token-victim-ffffff' }).lean())?.active).toBe(true);
  });

  it('refuses an unauthenticated registration', async () => {
    const response = await request(app)
      .post(`${API}/notifications/devices`)
      .send({ token: 'token-anon-gggggg', platform: 'android' });

    expect(response.status).toBe(401);
    expect(await DeviceToken.countDocuments({})).toBe(0);
  });

  describe('dispatch', () => {
    it('pushes to every active device of the recipients', async () => {
      const user = await createUserWithPermissions('push1@test.mn', [PERMISSIONS.INVOICE_VIEW]);
      const token = await login(user.email, user.password);
      const capture = captureTransport();
      setPushTransport(capture.transport);

      for (const value of ['push-phone-aaaaaa', 'push-tablet-bbbbb']) {
        await request(app)
          .post(`${API}/notifications/devices`)
          .set('Authorization', `Bearer ${token}`)
          .send({ token: value, platform: 'android' });
      }

      await notify({
        event: 'INVOICE_ISSUED',
        title: 'Нэхэмжлэл илгээгдлээ',
        permission: PERMISSIONS.INVOICE_VIEW,
        linkPath: '/invoices/1',
      });

      expect(capture.sent.map((message) => message.token).sort()).toEqual([
        'push-phone-aaaaaa',
        'push-tablet-bbbbb',
      ]);
      // The tap target travels as data so the app can route without a lookup.
      expect(capture.sent[0]?.data).toMatchObject({
        event: 'INVOICE_ISSUED',
        linkPath: '/invoices/1',
      });
    });

    it('does not push to a device that was unregistered', async () => {
      const user = await createUserWithPermissions('push2@test.mn', [PERMISSIONS.INVOICE_VIEW]);
      const token = await login(user.email, user.password);
      const capture = captureTransport();
      setPushTransport(capture.transport);

      await request(app)
        .post(`${API}/notifications/devices`)
        .set('Authorization', `Bearer ${token}`)
        .send({ token: 'push-gone-cccccc', platform: 'android' });
      await request(app)
        .post(`${API}/notifications/devices/unregister`)
        .set('Authorization', `Bearer ${token}`)
        .send({ token: 'push-gone-cccccc' });

      await notify({
        event: 'INVOICE_ISSUED',
        title: 'Нэхэмжлэл илгээгдлээ',
        permission: PERMISSIONS.INVOICE_VIEW,
      });

      expect(capture.sent).toHaveLength(0);
    });

    /**
     * The cleanup that keeps the collection from filling with dead installs. Only FCM saying
     * the token is gone counts.
     */
    it('deactivates a token FCM reports as unregistered', async () => {
      const user = await createUserWithPermissions('push3@test.mn', [PERMISSIONS.INVOICE_VIEW]);
      const token = await login(user.email, user.password);
      const capture = captureTransport((value) =>
        value === 'push-dead-dddddd' ? 'unregistered' : 'sent',
      );
      setPushTransport(capture.transport);

      for (const value of ['push-dead-dddddd', 'push-live-eeeeee']) {
        await request(app)
          .post(`${API}/notifications/devices`)
          .set('Authorization', `Bearer ${token}`)
          .send({ token: value, platform: 'android' });
      }

      await notify({
        event: 'INVOICE_ISSUED',
        title: 'Нэхэмжлэл илгээгдлээ',
        permission: PERMISSIONS.INVOICE_VIEW,
      });

      expect((await DeviceToken.findOne({ token: 'push-dead-dddddd' }).lean())?.active).toBe(false);
      expect((await DeviceToken.findOne({ token: 'push-live-eeeeee' }).lean())?.active).toBe(true);
    });

    /**
     * The failure mode that would be worst in production: an outage must not unsubscribe the
     * estate. Nothing would re-subscribe until every user reopened their app.
     */
    it('keeps registrations when delivery merely fails', async () => {
      const user = await createUserWithPermissions('push4@test.mn', [PERMISSIONS.INVOICE_VIEW]);
      const token = await login(user.email, user.password);
      setPushTransport(captureTransport(() => 'failed').transport);

      await request(app)
        .post(`${API}/notifications/devices`)
        .set('Authorization', `Bearer ${token}`)
        .send({ token: 'push-flaky-ffffff', platform: 'android' });

      await notify({
        event: 'INVOICE_ISSUED',
        title: 'Нэхэмжлэл илгээгдлээ',
        permission: PERMISSIONS.INVOICE_VIEW,
      });

      expect((await DeviceToken.findOne({ token: 'push-flaky-ffffff' }).lean())?.active).toBe(true);
    });

    /** iOS push was not approved, so an iPhone registration is stored and never dispatched. */
    it('does not push to platforms that were not approved', async () => {
      const user = await createUserWithPermissions('push5@test.mn', [PERMISSIONS.INVOICE_VIEW]);
      const token = await login(user.email, user.password);
      const capture = captureTransport();
      setPushTransport(capture.transport);

      await request(app)
        .post(`${API}/notifications/devices`)
        .set('Authorization', `Bearer ${token}`)
        .send({ token: 'push-iphone-gggggg', platform: 'ios' });

      await notify({
        event: 'INVOICE_ISSUED',
        title: 'Нэхэмжлэл илгээгдлээ',
        permission: PERMISSIONS.INVOICE_VIEW,
      });

      expect(capture.sent).toHaveLength(0);
      // Stored, so enabling iOS later is a dispatch change rather than a re-registration.
      expect(await DeviceToken.countDocuments({ token: 'push-iphone-gggggg' })).toBe(1);
    });

    /**
     * The ordering guarantee. A phone must never buzz about a notification the database did
     * not get, so a push failure cannot roll back or prevent the in-app record.
     */
    it('still records the notification when push throws', async () => {
      // Needs both: one to be a recipient of the event, one to read its own inbox back.
      const user = await createUserWithPermissions('push6@test.mn', [
        PERMISSIONS.INVOICE_VIEW,
        PERMISSIONS.NOTIFICATION_VIEW,
      ]);
      const token = await login(user.email, user.password);
      setPushTransport({
        kind: 'fcm',
        async send(): Promise<PushOutcome[]> {
          throw new Error('firebase exploded');
        },
      });

      await request(app)
        .post(`${API}/notifications/devices`)
        .set('Authorization', `Bearer ${token}`)
        .send({ token: 'push-boom-hhhhhh', platform: 'android' });

      await notify({
        event: 'INVOICE_ISSUED',
        title: 'Нэхэмжлэл илгээгдлээ',
        permission: PERMISSIONS.INVOICE_VIEW,
      });

      const listed = await request(app)
        .get(`${API}/notifications`)
        .set('Authorization', `Bearer ${token}`);
      expect(listed.body.data.items).toHaveLength(1);
    });
  });
});
