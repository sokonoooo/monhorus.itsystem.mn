import type { Server } from 'node:http';

import { createApp } from './app';
import { connectDatabase, disconnectDatabase } from './config/database';
import { env } from './config/env';
import { logger } from './config/logger';
import {
  startOverdueReconciliationJob,
  stopOverdueReconciliationJob,
} from './jobs/overdue-reconciliation.job';
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

  const app = createApp();
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
