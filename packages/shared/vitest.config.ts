import { defineConfig } from 'vitest/config';

/**
 * Tests for the shared package.
 *
 * This package had no `test` script at all, which meant `turbo run test` skipped it in
 * silence — 2,700 lines of schemas and domain functions with nowhere to assert anything, so
 * a rule shared by the API, the web app and both Flutter apps was only ever exercised
 * through one of its callers.
 *
 * Node environment and no setup file: everything here is a pure function over plain data. A
 * test in this package that needs a DOM or a database is a test that belongs in an app.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
  },
});
