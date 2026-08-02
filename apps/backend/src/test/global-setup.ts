import { MongoMemoryServer } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';

/**
 * One in-memory MongoDB for the whole run.
 *
 * Previously each test file started and stopped its own server. With seventeen suites
 * that meant seventeen mongod boot and shutdown cycles on one machine, which was slow and
 * eventually thrashed badly enough that unrelated suites timed out.
 *
 * A single instance is started here and shared. Isolation between files comes from
 * `fileParallelism: false` plus the wipe in `startTestApp`, not from a database or a
 * server per file — see the note on TEST_DB_NAME in helpers.ts for why the per-file
 * database was actively harmful.
 */
let server: MongoMemoryServer | null = null;

export async function setup(project: TestProject): Promise<void> {
  server = await MongoMemoryServer.create();
  project.provide('mongoUri', server.getUri());
}

export async function teardown(): Promise<void> {
  const running = server;
  // Cleared first so a failure below cannot leave a stopped-but-referenced handle behind.
  server = null;
  // `force` reaps the mongod even if a worker died mid-run holding a connection open;
  // without it a crashed run leaves an orphaned mongod and its data directory on disk.
  await running?.stop({ doCleanup: true, force: true });
}

declare module 'vitest' {
  interface ProvidedContext {
    mongoUri: string;
  }
}
