import pino from 'pino';

import { env } from './env';

/**
 * Default level per environment.
 *
 * Under test the logger is silent. Two concrete reasons, both measured:
 *
 *   - `pino-pretty` is a *transport*, and a transport is a worker thread. Vitest runs each
 *     test file in its own forked process, so the previous configuration spawned a
 *     thread-stream worker per file and never closed it. That is a leaked handle in every
 *     one of the thirty-odd workers.
 *   - `pino-http` logs the whole request and response, headers included, at debug. One API
 *     suite emitted 508 KB of pretty-printed output; the full run emitted roughly 10 MB.
 *     All of it crosses the fork's stdout pipe into the Vitest host process, and when that
 *     pipe fills the worker blocks inside `write` — which presents as an unrelated test
 *     hanging until its hook timeout.
 *
 * `LOG_LEVEL` overrides this, so a failing suite can be re-run with logging turned back on.
 */
const defaultLevel = env.isTest ? 'silent' : env.isProduction ? 'info' : 'debug';

/**
 * Structured logger. Credentials and tokens are redacted at the transport level, so
 * an accidental `logger.info({ req })` can never leak a Bearer token or a plaintext
 * passcode into the log stream.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? defaultLevel,
  base: { service: 'monhorus-backend' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'newPassword',
      'currentPassword',
      'temporaryPassword',
      'refreshToken',
      'accessToken',
      '*.password',
      '*.newPassword',
      '*.currentPassword',
      '*.temporaryPassword',
      '*.refreshToken',
      '*.accessToken',
    ],
    censor: '[REDACTED]',
  },
  // Production ships NDJSON to the collector. Test gets no transport at all, so no
  // worker thread is created: see the note on `defaultLevel`. Only development pays for
  // pretty printing.
  transport:
    env.isProduction || env.isTest
      ? undefined
      : {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
        },
});
