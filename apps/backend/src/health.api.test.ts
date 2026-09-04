import type { Express } from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { checkDatabaseHealth } from './config/database';
import { startTestApp, stopTestApp } from './test/helpers';

/**
 * `/health` had zero test coverage, and the reason that mattered is that it could not
 * fail. It touched no dependency and returned 200 with «Систем хэвийн ажиллаж байна.»
 * whenever the process was alive, which is the one thing a process asking itself whether
 * it is alive already knows.
 *
 * The production runbook's first post-deploy step is `curl /health`. Under the old
 * endpoint a deploy could be signed off green with Mongo unreachable while every real
 * request 500'd. These tests exist to keep the endpoint answerable for the dependency it
 * claims to be reporting on: the ordering below deliberately puts the *unhealthy* case in
 * the suite, because that is the case that never used to exist.
 */
let app: Express;

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await stopTestApp();
});

describe('GET /health', () => {
  it('reports 200 and names the dependency it checked when the database answers', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    // The pre-existing shape, unchanged: anything already parsing this keeps working.
    expect(response.body.success).toBe(true);
    expect(response.body.message).toBe('Систем хэвийн ажиллаж байна.');
    expect(response.body.data.status).toBe('ok');
    expect(response.body.data.timezone).toBe('Asia/Ulaanbaatar');
    expect(typeof response.body.data.uptime).toBe('number');

    // The new part: green now means a round trip actually happened.
    expect(response.body.data.database).toMatchObject({
      healthy: true,
      state: 'connected',
      ping: true,
    });
    expect(typeof response.body.data.database.pingMs).toBe('number');
    // The in-memory server is a standalone, so it reports itself writable and unnamed.
    expect(response.body.data.database.isPrimary).toBe(true);
    expect(response.body.data.database.replicaSet).toBeNull();
  });

  it('is never cached, because a cached green is the defect it just stopped having', async () => {
    const response = await request(app).get('/health');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('probes without asserting a replica set, so a standalone is not a false alarm', async () => {
    const health = await checkDatabaseHealth();
    expect(health.healthy).toBe(true);
    expect(health.replicaSet).toBeNull();
  });

  it('gives up rather than hanging when the server does not answer in time', async () => {
    // The connection is opened with serverSelectionTimeoutMS: 10_000. An un-raced probe
    // would hold a polled endpoint open for ten seconds per call during an outage.
    const startedAt = Date.now();
    const health = await checkDatabaseHealth(1);
    const elapsed = Date.now() - startedAt;

    expect(elapsed).toBeLessThan(2_000);
    if (!health.healthy) {
      // The usual outcome: the 1 ms budget expires first.
      expect(health.ping).toBe(false);
      expect(health.error).toContain('1ms');
    }
    // A local in-memory mongod can occasionally answer inside a millisecond; either way
    // the point being pinned is that the call returned promptly rather than blocking.
  });

  /**
   * Last, because it takes the shared connection down. Files run one at a time
   * (`fileParallelism: false`) and `stopTestApp` only closes handles, so leaving the
   * connection closed here is safe; reconnecting would cost a second wipe-and-reseed for
   * no assertion.
   */
  it('answers 503 with a truthful body when the database is not connected', async () => {
    await mongoose.disconnect();
    expect(mongoose.connection.readyState).not.toBe(1);

    const response = await request(app).get('/health');

    expect(response.status).toBe(503);
    expect(response.body.success).toBe(false);
    // Not the healthy message, and specific enough to act on.
    expect(response.body.message).not.toBe('Систем хэвийн ажиллаж байна.');
    expect(response.body.message).toBe('Өгөгдлийн сантай холбогдоогүй байна.');
    expect(response.body.data.status).toBe('error');
    expect(response.body.data.database).toMatchObject({
      healthy: false,
      state: 'disconnected',
      ping: null,
    });
    expect(response.body.data.database.error).toBe('connection is not established');
    // Still reports the process-level facts, so the response stays parseable.
    expect(response.body.data.timezone).toBe('Asia/Ulaanbaatar');
    expect(typeof response.body.data.uptime).toBe('number');
  });
});
