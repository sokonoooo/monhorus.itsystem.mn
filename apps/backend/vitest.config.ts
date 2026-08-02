import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],

    // One mongod for the whole run, started in global setup. Every file connects to the
    // SAME database (see src/test/helpers.ts) and wipes it on the way in.
    globalSetup: ['src/test/global-setup.ts'],
    setupFiles: ['src/test/setup.ts'],

    // Forks, isolated, one at a time. Each part of that matters:
    //
    //  - `forks` + isolation gives every file a fresh child process and therefore a fresh
    //    module registry. That is what keeps process-global state — the login rate
    //    limiter's memory store, the notification recipient cache, the settings cache —
    //    from leaking between suites. Do not switch this to `singleFork`.
    //  - `fileParallelism: false` keeps files sequential. They share one mongoose default
    //    connection, which is process-global, and one database, which `startTestApp`
    //    empties before it seeds. Two files running at once would wipe each other's data
    //    mid-test. This is the only concurrency reduction in the config, and it is load
    //    bearing rather than a workaround for flakiness.
    pool: 'forks',
    isolate: true,
    fileParallelism: false,

    // Nothing in this suite is a long-running integration test. Measured over a full run,
    // the slowest single case is 449 ms (inspection-report, "requires a reason to return
    // the report") and the slowest whole FILE is 4.8 s (object-master.api.test.ts). The
    // previous 60 s / 120 s ceilings were not protecting anything; they converted a
    // stalled request into a two-minute wait that then blamed whichever test happened to
    // be holding the stall rather than whatever caused it.
    //
    // 15 s is over thirty times the worst observed case: ample headroom for a cold first
    // file (mongod warm-up plus the one-time index build) on a loaded machine, and still
    // fast enough to name the real culprit. Raise this only with a measurement, and prefer
    // a per-hook override inside the file that needs it over moving the global.
    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
