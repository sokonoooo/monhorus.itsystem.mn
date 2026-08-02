import { PERMISSIONS, SETTING_KEYS } from '@monhorus/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createObjectFixture,
  createUserWithPermissions,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
} from '../../test/helpers';
import { AuditLog } from '../audit/audit-log.model';
import { Setting } from './setting.model';
import { getSlaConfig, invalidateSettingsCache } from './settings.service';

const API = '/api/v1';

let app: Express;
let adminToken: string;
let readerToken: string;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  return response.body.data.tokens.accessToken as string;
}

async function patchSettings(
  settings: Record<string, unknown>,
  bearer = adminToken,
): Promise<request.Response> {
  return request(app)
    .patch(`${API}/settings`)
    .set('Authorization', `Bearer ${bearer}`)
    .send({ settings });
}

beforeAll(async () => {
  app = await startTestApp();
}, 60_000);

afterAll(async () => {
  await stopTestApp();
});

beforeEach(async () => {
  await resetDomainCollections();
  // The service caches the resolved map, and resetDomainCollections wipes the overrides
  // behind its back, so the cache has to be dropped between tests.
  invalidateSettingsCache();

  const admin = await createUserWithPermissions('setadmin@test.mn', [
    PERMISSIONS.SETTINGS_VIEW,
    PERMISSIONS.SETTINGS_MANAGE,
    PERMISSIONS.SERVICE_REQUEST_VIEW,
    PERMISSIONS.SERVICE_REQUEST_CREATE,
  ]);
  adminToken = await login(admin.email, admin.password);

  const reader = await createUserWithPermissions('setreader@test.mn', [
    PERMISSIONS.SETTINGS_VIEW,
  ]);
  readerToken = await login(reader.email, reader.password);
});

afterEach(() => {
  invalidateSettingsCache();
});

describe('GET /settings', () => {
  it('returns every declared key at its catalogue default on a fresh database', async () => {
    const response = await request(app)
      .get(`${API}/settings`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    const entries = (response.body.data.groups as { entries: Record<string, unknown>[] }[]).flatMap(
      (group) => group.entries,
    );

    const urgent = entries.find((entry) => entry.key === SETTING_KEYS.SLA_URGENT_HOURS);
    expect(urgent?.value).toBe(6);
    expect(urgent?.defaultValue).toBe(6);
    expect(urgent?.isOverridden).toBe(false);

    const normalMin = entries.find((entry) => entry.key === SETTING_KEYS.EVAL_NORMAL_MIN);
    expect(normalMin?.value).toBe(81);
  });

  it('groups entries as general, sla, evaluation and finance', async () => {
    const response = await request(app)
      .get(`${API}/settings`)
      .set('Authorization', `Bearer ${adminToken}`);

    const groups = (response.body.data.groups as { group: string }[]).map((entry) => entry.group);
    expect(groups).toEqual(['general', 'sla', 'evaluation', 'finance']);
  });

  /** Requirements 12.2 sources tax from settings and states no rate, so the default is zero. */
  it('defaults the tax rate to zero rather than to an unapproved figure', async () => {
    const response = await request(app)
      .get(`${API}/settings`)
      .set('Authorization', `Bearer ${adminToken}`);

    const finance = (response.body.data.groups as { group: string; entries: { key: string; value: unknown }[] }[]).find(
      (entry) => entry.group === 'finance',
    );
    const tax = finance?.entries.find((entry) => entry.key === 'finance.tax_percent');
    expect(tax?.value).toBe(0);
  });

  it('reports canManage false for a read-only caller', async () => {
    const response = await request(app)
      .get(`${API}/settings`)
      .set('Authorization', `Bearer ${readerToken}`);

    expect(response.body.data.canManage).toBe(false);
  });

  it('refuses a caller without settings.view', async () => {
    const outsider = await createUserWithPermissions('setout@test.mn', [
      PERMISSIONS.DASHBOARD_VIEW,
    ]);
    const outsiderToken = await login(outsider.email, outsider.password);

    const response = await request(app)
      .get(`${API}/settings`)
      .set('Authorization', `Bearer ${outsiderToken}`);

    expect(response.status).toBe(403);
  });
});

describe('PATCH /settings', () => {
  it('stores an override and marks it as overridden', async () => {
    const response = await patchSettings({ [SETTING_KEYS.SLA_URGENT_HOURS]: 4 });

    expect(response.status).toBe(200);
    const entries = (response.body.data.groups as { entries: Record<string, unknown>[] }[]).flatMap(
      (group) => group.entries,
    );
    const urgent = entries.find((entry) => entry.key === SETTING_KEYS.SLA_URGENT_HOURS);

    expect(urgent?.value).toBe(4);
    expect(urgent?.defaultValue).toBe(6);
    expect(urgent?.isOverridden).toBe(true);
    expect(urgent?.updatedByName).not.toBeNull();
  });

  it('stores only the overridden keys, leaving the rest on defaults', async () => {
    await patchSettings({ [SETTING_KEYS.SLA_URGENT_HOURS]: 4 });

    const stored = await Setting.find();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.key).toBe(SETTING_KEYS.SLA_URGENT_HOURS);
  });

  it('refuses a key that is not in the catalogue', async () => {
    const response = await patchSettings({ 'sla.made_up_key': 1 });

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body.issues)).toContain('бүртгэлгүй');
  });

  it('refuses a value outside its declared bounds', async () => {
    const tooLow = await patchSettings({ [SETTING_KEYS.SLA_URGENT_HOURS]: 0 });
    expect(tooLow.status).toBe(400);

    const tooHigh = await patchSettings({ [SETTING_KEYS.SLA_URGENT_HOURS]: 5000 });
    expect(tooHigh.status).toBe(400);
  });

  it('refuses a non-integer where an integer is declared', async () => {
    const response = await patchSettings({ [SETTING_KEYS.SLA_URGENT_HOURS]: 4.5 });
    expect(response.status).toBe(400);
  });

  it('refuses an at-risk threshold below the near-breach threshold', async () => {
    const response = await patchSettings({
      [SETTING_KEYS.SLA_NEAR_BREACH_RATIO]: 0.9,
      [SETTING_KEYS.SLA_AT_RISK_RATIO]: 0.8,
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('зөрчилдөж');
  });

  /**
   * The cross-field rule has to be checked against the whole map after the patch, not
   * against the supplied keys alone: this payload is individually valid but would leave
   * the stored pair inverted.
   */
  it('refuses a single-key change that inverts the stored pair', async () => {
    await patchSettings({ [SETTING_KEYS.SLA_NEAR_BREACH_RATIO]: 0.8 });

    const response = await patchSettings({ [SETTING_KEYS.SLA_AT_RISK_RATIO]: 0.75 });
    expect(response.status).toBe(400);
  });

  it('refuses evaluation thresholds that are not strictly descending', async () => {
    const response = await patchSettings({
      [SETTING_KEYS.EVAL_NORMAL_MIN]: 50,
      [SETTING_KEYS.EVAL_ATTENTION_MIN]: 60,
    });

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body.issues)).toContain('бага байх ёстой');
  });

  it('accepts a valid rebanding', async () => {
    const response = await patchSettings({
      [SETTING_KEYS.EVAL_NORMAL_MIN]: 90,
      [SETTING_KEYS.EVAL_ATTENTION_MIN]: 70,
      [SETTING_KEYS.EVAL_SCHEDULE_REPAIR_MIN]: 50,
      [SETTING_KEYS.EVAL_CRITICAL_MIN]: 30,
    });

    expect(response.status).toBe(200);
  });

  it('rejects an empty patch rather than writing nothing quietly', async () => {
    const response = await patchSettings({});
    expect(response.status).toBe(400);
  });

  it('treats a no-op value as no change', async () => {
    const response = await patchSettings({ [SETTING_KEYS.SLA_URGENT_HOURS]: 6 });
    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Өөрчлөгдсөн утга алга');
  });

  it('refuses a caller holding only settings.view', async () => {
    const response = await patchSettings({ [SETTING_KEYS.SLA_URGENT_HOURS]: 4 }, readerToken);
    expect(response.status).toBe(403);
  });

  it('writes one audit record per changed key, carrying old and new values', async () => {
    await patchSettings({
      [SETTING_KEYS.SLA_URGENT_HOURS]: 4,
      [SETTING_KEYS.SLA_STANDARD_HOURS]: 48,
    });

    const entries = await AuditLog.find({ entityType: 'Setting' });
    expect(entries).toHaveLength(2);

    const urgent = entries.find((entry) =>
      (entry.reason ?? '').includes(SETTING_KEYS.SLA_URGENT_HOURS),
    );
    expect((urgent?.oldValue as { value: number }).value).toBe(6);
    expect((urgent?.newValue as { value: number }).value).toBe(4);
  });
});

describe('DELETE /settings/:key', () => {
  it('restores the catalogue default and audits the reset', async () => {
    await patchSettings({ [SETTING_KEYS.SLA_URGENT_HOURS]: 4 });

    const response = await request(app)
      .delete(`${API}/settings/${SETTING_KEYS.SLA_URGENT_HOURS}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(await Setting.countDocuments({ key: SETTING_KEYS.SLA_URGENT_HOURS })).toBe(0);

    const entries = await AuditLog.find({ entityType: 'Setting' });
    expect(entries.some((entry) => (entry.reason ?? '').includes('reset to default'))).toBe(true);
  });

  it('refuses to reset a key that is not overridden', async () => {
    const response = await request(app)
      .delete(`${API}/settings/${SETTING_KEYS.SLA_URGENT_HOURS}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(404);
  });

  it('refuses an undeclared key in the path', async () => {
    const response = await request(app)
      .delete(`${API}/settings/sla.made_up_key`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(400);
  });
});

describe('settings actually drive behaviour', () => {
  it('changes the SLA deadline a new request receives', async () => {
    const objects = await createObjectFixture();

    await patchSettings({ [SETTING_KEYS.SLA_URGENT_HOURS]: 2 });

    const created = await request(app)
      .post(`${API}/service-requests`)
      .set('Authorization', `Bearer ${adminToken}`)
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

    expect(created.status).toBe(201);

    const createdAt = Date.parse(created.body.data.createdAt);
    const dueAt = Date.parse(created.body.data.slaDueAt);
    const windowHours = (dueAt - createdAt) / 3_600_000;

    // Two hours, not the compiled-in six.
    expect(windowHours).toBeGreaterThan(1.9);
    expect(windowHours).toBeLessThan(2.1);
  });

  it('publishes a change immediately rather than after the cache expires', async () => {
    expect((await getSlaConfig()).urgentHours).toBe(6);

    await patchSettings({ [SETTING_KEYS.SLA_URGENT_HOURS]: 3 });

    expect((await getSlaConfig()).urgentHours).toBe(3);
  });

  it('changes how an object score maps to a risk level', async () => {
    const objects = await createObjectFixture();

    const objectAdmin = await createUserWithPermissions('setobj@test.mn', [
      PERMISSIONS.SETTINGS_MANAGE,
      PERMISSIONS.OBJECT_VIEW,
      PERMISSIONS.OBJECT_MANAGE,
    ]);
    const objectToken = await login(objectAdmin.email, objectAdmin.password);

    // Scored on the floor itself: the hierarchy requires a device to hang off a circuit,
    // and this test is about the banding, not about building a seven-level chain.
    const scored = await request(app)
      .patch(`${API}/objects/nodes/${objects.floorId}`)
      .set('Authorization', `Bearer ${objectToken}`)
      .send({ riskScore: 85 });

    expect(scored.status).toBe(200);
    // 85 sits in the default NORMAL band, which starts at 81.
    expect(scored.body.data.riskLevel).toBe('NORMAL');
    const created = scored;

    await request(app)
      .patch(`${API}/settings`)
      .set('Authorization', `Bearer ${objectToken}`)
      .send({ settings: { [SETTING_KEYS.EVAL_NORMAL_MIN]: 90 } });

    const reread = await request(app)
      .get(`${API}/objects/nodes?parentId=${objects.buildingId}`)
      .set('Authorization', `Bearer ${objectToken}`);

    const floor = (reread.body.data as { id: string; riskScore: number; riskLevel: string }[]).find(
      (node) => node.id === created.body.data.id,
    );

    // The same stored score now reads as ATTENTION, without the score being rewritten.
    expect(floor?.riskScore).toBe(85);
    expect(floor?.riskLevel).toBe('ATTENTION');
  });
});
