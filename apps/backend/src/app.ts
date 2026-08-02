import compression from 'compression';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';

import { AppError } from './common/errors/app-error';
import { ERROR_CODES } from './common/errors/error-codes';
import { env } from './config/env';
import { logger } from './config/logger';
import { errorHandler } from './middlewares/error-handler.middleware';
import { notFoundHandler } from './middlewares/not-found.middleware';
import { apiRouter } from './routes';

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

  app.get('/health', (_req, res) => {
    res.status(200).json({
      success: true,
      data: { status: 'ok', timezone: env.APP_TIMEZONE, uptime: process.uptime() },
      message: 'Систем хэвийн ажиллаж байна.',
    });
  });

  app.use('/api/v1', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
