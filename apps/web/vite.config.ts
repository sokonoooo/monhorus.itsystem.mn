import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    watch: {
      // The workspace package is reached through a symlink, which the watcher skips by
      // default. Without this, rebuilding packages/shared does not trigger a reload and
      // the browser keeps running whatever it loaded at startup.
      followSymlinks: true,
    },
    fs: {
      // The dev server must be allowed to read outside apps/web to follow that symlink
      // to packages/shared/dist.
      allow: ['..', '../..'],
    },
  },
  optimizeDeps: {
    /**
     * Never pre-bundle the workspace package.
     *
     * npm workspaces symlinks `@monhorus/shared` into node_modules, so Vite treats it as
     * an ordinary dependency and caches a pre-bundled copy under node_modules/.vite. That
     * copy is only rebuilt when the lockfile or the config changes, so adding an export to
     * the shared package left the browser importing a stale build: every new symbol
     * resolved to undefined and the screens using them reported a load failure while the
     * backend never saw a request. Excluding it makes Vite read the package fresh.
     */
    exclude: ['@monhorus/shared'],
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
