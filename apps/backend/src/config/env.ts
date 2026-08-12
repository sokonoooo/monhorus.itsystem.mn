import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment contract. Parsed once at boot; the process refuses to start when a
 * required secret is missing or malformed.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_ISSUER: z.string().default('monhorus'),
  JWT_AUDIENCE: z.string().default('monhorus-clients'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  MAX_FAILED_LOGIN_ATTEMPTS: z.coerce.number().int().positive().default(5),
  ACCOUNT_LOCK_MINUTES: z.coerce.number().int().positive().default(15),

  /**
   * Per-IP ceilings for the credential and refresh endpoints, per fifteen minutes.
   *
   * Overridable because the limiter is process-global shared state, and the test suite is
   * a single IP signing in hundreds of times. Leaving it at the runtime ceiling made the
   * budget a property of how many logins the *file* happened to perform, so adding a test
   * to one suite could fail an unrelated one. `src/test/setup.ts` raises it; a test that
   * wants to assert the policy sets it back down.
   *
   * The defaults are the shipping values and are what production uses.
   */
  RATE_LIMIT_CREDENTIAL_MAX: z.coerce.number().int().positive().optional(),
  RATE_LIMIT_REFRESH_MAX: z.coerce.number().int().positive().optional(),

  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  APP_TIMEZONE: z.string().default('Asia/Ulaanbaatar'),

  /**
   * Directory for uploaded files. Kept outside the served tree; downloads go through
   * the authenticated /api/v1/files route, never a static handler.
   */
  UPLOAD_DIR: z.string().default('./var/uploads'),

  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(10).optional(),
  BOOTSTRAP_ADMIN_NAME: z.string().min(1).optional(),

  /**
   * Password given to every login `seed-dev-data` provisions for a seeded employee.
   *
   * Unlike `BOOTSTRAP_ADMIN_PASSWORD` this one carries a default, because the seed has to
   * produce a WORKING mobile login unattended: an optional value would mean a developer who
   * had not read a doc got the seed's employees with no accounts, which is precisely the
   * "ажилтны карттай холбогдоогүй" state the accounts exist to prevent. It is safe to
   * default because `seed-dev-data` refuses to run with NODE_ENV=production, so this value
   * can never reach a real deployment. The minimum length matches the one the employee
   * system-access screen enforces on an admin-issued passcode.
   */
  SEED_DEV_PASSWORD: z.string().min(10).default('Monhorus.dev2026'),

  /**
   * Where a password-reset link sends the reader.
   *
   * The backend had no notion of the public web address before this: every other response
   * is consumed by a client that already knows its own origin. A mailed link is the first
   * thing the server has to address on its own, and it cannot be derived from the request —
   * the request comes from the browser being reset, or from nothing at all. Defaulted to
   * the dev server so a fresh checkout produces a link that works.
   */
  APP_WEB_BASE_URL: z.string().url().default('http://localhost:5173'),

  /**
   * How long a reset link stays usable. Long enough to find the mail, short enough that
   * one left sitting in an inbox stops working the same day.
   */
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(60),

  /**
   * SMTP, all optional.
   *
   * Optional because the mail transport degrades rather than refuses: with no SMTP_HOST the
   * server logs the reset link instead of sending it, which keeps `npm run dev` working on
   * a laptop with no mail server and keeps the test suite off the network. A deployment
   * that wants real mail sets these; `mailEnabled` below is what the transport switches on.
   */
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASS: z.string().min(1).optional(),
  MAIL_FROM: z.string().min(1).default('Monhorus <no-reply@monhorus.itsystem.mn>'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  // Intentionally not using the logger: it depends on env.
  process.stderr.write(`Invalid environment configuration:\n${issues}\n`);
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  isDevelopment: raw.NODE_ENV === 'development',
  isTest: raw.NODE_ENV === 'test',
  corsOrigins: raw.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  refreshTokenTtlMs: raw.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  accountLockMs: raw.ACCOUNT_LOCK_MINUTES * 60 * 1000,
  passwordResetTtlMs: raw.PASSWORD_RESET_TTL_MINUTES * 60 * 1000,
  // A host is the one setting that cannot be defaulted, so it is what decides whether mail
  // is sent or logged. Credentials are separately optional: an internal relay often wants
  // none, and demanding them would make that setup unreachable.
  mailEnabled: Boolean(raw.SMTP_HOST),
} as const;

export type Env = typeof env;
