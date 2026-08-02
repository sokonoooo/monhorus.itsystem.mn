import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.tsx', 'src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    css: false,
    // Each jsdom environment is expensive to boot. Left unbounded, one fork per test
    // file exhausts the machine and workers time out before they respond.
    pool: 'forks',
    minWorkers: 1,
    maxWorkers: 4,
    testTimeout: 15_000,
  },
});
