import { DEFAULT_SERVICE_REQUEST_STAGES, PERMISSIONS, SETTING_KEYS } from '@monhorus/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createUserWithPermissions,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
} from '../../test/helpers';

import { invalidateSettingsCache } from './settings.service';

const API = '/api/v1';

let app: Express;
let adminToken: string;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  return response.body.data.tokens.accessToken as string;
}

/** Holds nothing at all: the point is that the vocabulary is still readable. */
let plainToken: string;

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await stopTestApp();
});

beforeEach(async () => {
  await resetDomainCollections();
  invalidateSettingsCache();

  const admin = await createUserWithPermissions('vocadmin@test.mn', [
    PERMISSIONS.SETTINGS_VIEW,
    PERMISSIONS.SETTINGS_MANAGE,
  ]);
  adminToken = await login(admin.email, admin.password);

  const plain = await createUserWithPermissions('vocplain@test.mn', []);
  plainToken = await login(plain.email, plain.password);
});

describe('GET /vocabulary', () => {
  it('publishes the configured stages and risk bands', async () => {
    const response = await request(app)
      .get(`${API}/vocabulary`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    const stages = response.body.data.requestStages as { key: string; label: string }[];
    expect(stages.map((stage) => stage.key)).toEqual(
      DEFAULT_SERVICE_REQUEST_STAGES.map((stage) => stage.key),
    );
    expect(stages[0]?.label).toBe('Нээлттэй');
    expect(response.body.data.riskBands).toHaveLength(5);
  });

  /**
   * The whole reason this endpoint exists. A technician holds no `settings.view` — reading
   * the finance keys is none of their business — but their phone still has to print the
   * name the administrator chose.
   */
  it('is readable without permission to read settings', async () => {
    const response = await request(app)
      .get(`${API}/vocabulary`)
      .set('Authorization', `Bearer ${plainToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.requestStages.length).toBeGreaterThan(0);
  });

  it('refuses an unauthenticated caller', async () => {
    const response = await request(app).get(`${API}/vocabulary`);
    expect(response.status).toBe(401);
  });

  it('follows a rename made in settings', async () => {
    const renamed = DEFAULT_SERVICE_REQUEST_STAGES.map((stage) =>
      stage.key === 'ON_THE_WAY' ? { ...stage, label: 'Замд гарсан' } : stage,
    );

    const saved = await request(app)
      .patch(`${API}/settings`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ settings: { [SETTING_KEYS.REQUEST_STAGES]: renamed } });
    expect(saved.status).toBe(200);

    const response = await request(app)
      .get(`${API}/vocabulary`)
      .set('Authorization', `Bearer ${adminToken}`);

    const stages = response.body.data.requestStages as { key: string; label: string }[];
    expect(stages.find((stage) => stage.key === 'ON_THE_WAY')?.label).toBe('Замд гарсан');
  });

  /**
   * A stored list that no longer covers every status would leave requests with no stage to
   * appear under, so the derivation discards it rather than serving a board with holes.
   */
  it('falls back to the default when the stored configuration is incomplete', async () => {
    const broken = DEFAULT_SERVICE_REQUEST_STAGES.filter((stage) => stage.key !== 'WAITING');

    const saved = await request(app)
      .patch(`${API}/settings`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ settings: { [SETTING_KEYS.REQUEST_STAGES]: broken } });

    // The API refuses it outright, which is the better of the two protections.
    expect(saved.status).toBe(400);

    const response = await request(app)
      .get(`${API}/vocabulary`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(response.body.data.requestStages).toHaveLength(
      DEFAULT_SERVICE_REQUEST_STAGES.length,
    );
  });
});
