import mongoose from 'mongoose';

import { env } from './env';
import { logger } from './logger';

mongoose.set('strictQuery', true);

if (!env.isProduction) {
  mongoose.set('debug', false);
}

export async function connectDatabase(): Promise<typeof mongoose> {
  mongoose.connection.on('connected', () => logger.info('MongoDB connected'));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('error', (error: unknown) =>
    logger.error({ err: error }, 'MongoDB connection error'),
  );

  await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 20,
    minPoolSize: 2,
    // In production, build indexes via a migration (`npm run sync:indexes`). Because that
    // makes production the only environment whose indexes are NOT built automatically,
    // `config/index-drift.ts` verifies at boot that the indexes the schemas declare are
    // actually present, and refuses to start when a UNIQUE one is not.
    autoIndex: !env.isProduction,
  });

  return mongoose;
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.connection.close(false);
  logger.info('MongoDB connection closed');
}

/** `mongoose.connection.readyState` is a number; these are the names it maps to. */
const READY_STATES: Record<number, string> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
  99: 'uninitialized',
};

export interface DatabaseHealth {
  /** True only when the connection is up AND the server answered a command just now. */
  healthy: boolean;
  /** Readable `readyState`: `connected`, `disconnected`, `connecting`, ... */
  state: string;
  /** Whether the round trip succeeded. Null when it was not attempted. */
  ping: boolean | null;
  /** Round-trip time in milliseconds, when the ping succeeded. */
  pingMs: number | null;
  /** Replica-set name, or null for a standalone server or an unreachable one. */
  replicaSet: string | null;
  /**
   * Whether the node this process is talking to accepts writes. Null when unknown.
   *
   * The runbook treats "there is a PRIMARY" as a health invariant, and it is one: with
   * the default read preference a replica set with no primary cannot serve a single
   * request. In that state server selection fails, so the round trip below times out and
   * `healthy` is already false -- this field exists to say *why*, rather than to be the
   * thing that detects it.
   */
  isPrimary: boolean | null;
  /** Why the probe failed, when it did. */
  error?: string;
}

/**
 * Probes the database the way a real request would.
 *
 * One `hello` command does both jobs: it is a genuine round trip, so it proves the server
 * is reachable and answering rather than merely that a socket object exists, and its
 * reply carries the replica-set topology, so reporting the primary state costs no second
 * round trip.
 *
 * The call is raced against `timeoutMs` rather than left to the driver. The connection is
 * opened with `serverSelectionTimeoutMS: 10_000`, so during an outage an un-raced probe
 * would hold the request open for ten seconds -- on an endpoint a monitor may poll every
 * few seconds, that turns one dependency failure into a pile of stuck sockets. A probe
 * that cannot answer promptly is a failing probe.
 */
export async function checkDatabaseHealth(timeoutMs = 2_000): Promise<DatabaseHealth> {
  const readyState = mongoose.connection.readyState;
  const state = READY_STATES[readyState] ?? `unknown(${String(readyState)})`;

  const base: DatabaseHealth = {
    healthy: false,
    state,
    ping: null,
    pingMs: null,
    replicaSet: null,
    isPrimary: null,
  };

  if (readyState !== 1) {
    return { ...base, error: 'connection is not established' };
  }

  const admin = mongoose.connection.db?.admin();
  if (!admin) {
    return { ...base, error: 'no database handle on the connection' };
  }

  const startedAt = Date.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    const probe = admin.command({ hello: 1 });

    // The losing side of a race is still a live promise. Without this catch, a command
    // that rejects *after* the timeout has already won becomes an unhandled rejection --
    // and `server.ts` responds to `unhandledRejection` by shutting the process down. A
    // slow health check must never be able to kill the server it reports on.
    void probe.catch(() => undefined);

    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`no response within ${String(timeoutMs)}ms`));
      }, timeoutMs);
      // Never hold the event loop open on account of a health check.
      timer.unref();
    });

    const reply = (await Promise.race([probe, timeout])) as {
      setName?: string;
      isWritablePrimary?: boolean;
      ismaster?: boolean;
    };

    // A standalone server sends no `setName`, and reports itself writable, so the primary
    // check is a no-op there rather than a false alarm. `ismaster` is the pre-5.0
    // spelling and is still what an older server replies with.
    const isPrimary = reply.isWritablePrimary ?? reply.ismaster ?? null;

    return {
      healthy: isPrimary !== false,
      state,
      ping: true,
      pingMs: Date.now() - startedAt,
      replicaSet: reply.setName ?? null,
      isPrimary,
      ...(isPrimary === false ? { error: 'connected node is not a writable primary' } : {}),
    };
  } catch (error) {
    return {
      ...base,
      ping: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
