import type { Server } from 'node:http';

import { createApp } from './app';
import { connectDatabase, disconnectDatabase } from './config/database';
import { env } from './config/env';
import { assertSchemaIndexes } from './config/index-drift';
import { logger } from './config/logger';
import {
  startOverdueReconciliationJob,
  stopOverdueReconciliationJob,
} from './jobs/overdue-reconciliation.job';
import { startReminderJob, stopReminderJob } from './jobs/reminder.job';
import { startUnclaimedWorkJob, stopUnclaimedWorkJob } from './jobs/unclaimed-work.job';
import { seedRbac } from './modules/rbac/rbac.service';
import { ensureUploadDirectory } from './modules/storage/storage.service';

let server: Server | undefined;

async function shutdown(signal: string, exitCode = 0): Promise<void> {
  logger.info({ signal }, 'Shutting down');

  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  stopOverdueReconciliationJob();
  stopUnclaimedWorkJob();
  stopReminderJob();

  try {
    // `listening` guards the case where startup itself failed, for example on
    // EADDRINUSE. Calling close() on a server that never bound throws
    // ERR_SERVER_NOT_RUNNING, which would mask the error that triggered shutdown.
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await disconnectDatabase();
    clearTimeout(forceExit);
    process.exit(exitCode);
  } catch (error) {
    logger.error({ err: error }, 'Error during shutdown');
    process.exit(1);
  }
}

async function start(): Promise<void> {
  await connectDatabase();

  // Idempotent: materialises the permission catalogue and any missing system roles.
  // Existing role permission sets are left untouched so administrator edits survive.
  await seedRbac();
  ensureUploadDirectory();

  // Planned-work deadlines are reconciled by the backend, not by any client.
  startOverdueReconciliationJob();
  startUnclaimedWorkJob();
  startReminderJob();

  // Built BEFORE the index check, and that ordering is load bearing. A model registers
  // itself on the shared mongoose instance when its module is first imported, and the
  // route tree is what imports them all; checking any earlier would silently inspect only
  // the handful of models `seedRbac` and the jobs happen to pull in. `index-drift.test.ts`
  // pins the equivalence between "everything the router loads" and "every model file on
  // disk", so this stays true as modules are added.
  const app = createApp();

  // Production connects with `autoIndex: false`, so unlike every other environment its
  // indexes exist only because somebody ran `npm run sync:indexes`. Refuses to start when
  // a declared UNIQUE index is absent; see index-drift.ts for why that, and not a log.
  await assertSchemaIndexes();

  server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV, timezone: env.APP_TIMEZONE },
      'Monhorus backend listening',
    );
  });
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.fatal({ err: reason }, 'Unhandled promise rejection');
  void shutdown('unhandledRejection', 1);
});

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught exception');
  void shutdown('uncaughtException', 1);
});

start().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Failed to start server');
  process.exit(1);
});
