import compression from 'compression';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';

import { AppError } from './common/errors/app-error';
import { ERROR_CODES } from './common/errors/error-codes';
import { type DatabaseHealth, checkDatabaseHealth } from './config/database';
import { env } from './config/env';
import { logger } from './config/logger';
import { errorHandler } from './middlewares/error-handler.middleware';
import { notFoundHandler } from './middlewares/not-found.middleware';
import { apiRouter } from './routes';

/**
 * The reason `/health` is red, in the language the operator reading it speaks.
 *
 * Named causes rather than one generic failure line: the runbook's first post-deploy
 * step is `curl /health`, and "the database is not answering" and "there is no PRIMARY"
 * send whoever is on the deploy to two different places.
 */
function unhealthyMessage(database: DatabaseHealth): string {
  if (database.isPrimary === false) {
    return 'Өгөгдлийн сангийн үндсэн (PRIMARY) зангилаа алга байна.';
  }
  if (database.state !== 'connected') {
    return 'Өгөгдлийн сантай холбогдоогүй байна.';
  }
  return 'Өгөгдлийн сан хариу өгөхгүй байна.';
}

export function createApp(): Express {
  const app = express();

  // Behind a reverse proxy req.ip must resolve to the real client, both for rate
  // limiting and for the IP recorded in the audit trail.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());

  app.use(
    cors({
      origin(origin, callback) {
        // Native mobile clients send no Origin header.
        if (!origin || env.corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(AppError.forbidden(ERROR_CODES.FORBIDDEN, 'CORS: origin зөвшөөрөгдөөгүй.'));
      },
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Client-Channel', 'X-Client-Version'],
      exposedHeaders: ['RateLimit', 'RateLimit-Policy'],
    }),
  );

  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === '/health' },
    }),
  );

  /**
   * Liveness AND readiness.
   *
   * This used to touch nothing at all: it returned 200 and «Систем хэвийн ажиллаж
   * байна.» whenever the process was alive. It is the first post-deploy check in the
   * production runbook, so Mongo being down, a replica set with no primary, or a
   * connection that had dropped and not come back all produced a green tick and a signed
   * off deploy while every real request 500'd.
   *
   * It now answers for the dependency it claims to be reporting on. The response shape is
   * unchanged for anything already parsing it — `success`, `data.status`, `data.timezone`,
   * `data.uptime` and `message` keep their meaning and their spelling — with
   * `data.database` added, and the status code dropping to 503 when the truth is that the
   * system is not fine.
   *
   * Kept cheap, because it may be polled: exactly one round trip, capped at two seconds
   * inside `checkDatabaseHealth`, and already excluded from request logging above.
   */
  app.get('/health', (_req, res) => {
    // Express 4 does not await an async handler, so the promise is driven here and every
    // path inside it answers. `checkDatabaseHealth` does not reject.
    void (async () => {
      const database = await checkDatabaseHealth();

      // A cached 200 sitting in an intermediary would reintroduce exactly the defect this
      // endpoint has just stopped having.
      res.setHeader('Cache-Control', 'no-store');

      const data = {
        status: database.healthy ? 'ok' : 'error',
        timezone: env.APP_TIMEZONE,
        uptime: process.uptime(),
        database,
      };

      if (database.healthy) {
        res.status(200).json({
          success: true,
          data,
          message: 'Систем хэвийн ажиллаж байна.',
        });
        return;
      }

      logger.error({ database }, 'Health check failed');
      res.status(503).json({ success: false, data, message: unhealthyMessage(database) });
    })();
  });

  app.use('/api/v1', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
