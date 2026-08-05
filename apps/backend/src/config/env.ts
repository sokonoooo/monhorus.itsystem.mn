import 'dotenv/config';
import { z } from 'zod';

/**
 * An optional variable whose value may also arrive as the empty string.
 *
 * `.optional()` alone is not enough for anything read out of an env file. It
 * tolerates an *absent* key, but a key written with no value is present and
 * empty, so the inner check still runs and fails — `BOOTSTRAP_ADMIN_PASSWORD=`
 * was rejected with "must contain at least 10 character(s)" and the process
 * exited 1 in a restart loop.
 *
 * That is not a hypothetical. `bootstrap-head-admin.ts` ends by instructing the
 * operator to clear BOOTSTRAP_ADMIN_PASSWORD, and blanking the value is the
 * obvious reading of that; `.env.example` itself ships all three BOOTSTRAP_ keys
 * with empty values, so copying the tracked template verbatim produced a backend
 * that could not boot. Treating empty as absent makes both work.
 */
const optionalEnv = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

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
  RATE_LIMIT_CREDENTIAL_MAX: optionalEnv(z.coerce.number().int().positive()),
  RATE_LIMIT_REFRESH_MAX: optionalEnv(z.coerce.number().int().positive()),

  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  APP_TIMEZONE: z.string().default('Asia/Ulaanbaatar'),

  /**
   * Directory for uploaded files. Kept outside the served tree; downloads go through
   * the authenticated /api/v1/files route, never a static handler.
   */
  UPLOAD_DIR: z.string().default('./var/uploads'),

  BOOTSTRAP_ADMIN_EMAIL: optionalEnv(z.string().email()),
  BOOTSTRAP_ADMIN_PASSWORD: optionalEnv(z.string().min(10)),
  BOOTSTRAP_ADMIN_NAME: optionalEnv(z.string().min(1)),

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
} as const;

export type Env = typeof env;
