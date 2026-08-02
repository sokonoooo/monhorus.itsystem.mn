/**
 * Backend test bootstrap.
 *
 * Environment variables must be set before any module reads `env`, which is why this
 * runs as a Vitest setup file rather than inside a beforeAll hook.
 */
// Pools supertest's HTTP servers instead of creating one per request. Imported for its
// side effect, and before anything can call `request()`. See the file for why.
import './supertest-shared-server';

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI ??= 'mongodb://127.0.0.1:27017/monhorus_test_placeholder';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-value-that-is-over-32-characters';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-DIFFERENT-over-32-characters-long';
process.env.CORS_ORIGINS ??= 'http://localhost:5173';
process.env.UPLOAD_DIR ??= './var/test-uploads';

/**
 * The login throttle is per-IP process-global state, and the whole suite is one IP.
 *
 * At the runtime ceiling of 100 per fifteen minutes, a suite's login budget was shared by
 * every case in the file: `planned-work.assignment-scope.api.test.ts` had to be rewritten
 * to build its cast once precisely because rebuilding it per test exhausted the budget and
 * produced 429s that had nothing to do with what was being tested. That is a trap that
 * catches whoever adds the test that crosses the line, in whichever file they add it to.
 *
 * Raised here rather than removed, so the middleware is still mounted and still exercised.
 * A test that wants to assert the policy runs with `RATE_LIMIT_CREDENTIAL_MAX` set to a
 * small number; `??=` means an explicit value always wins.
 */
process.env.RATE_LIMIT_CREDENTIAL_MAX ??= '1000000';
process.env.RATE_LIMIT_REFRESH_MAX ??= '1000000';
