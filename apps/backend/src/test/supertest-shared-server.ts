import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { Test } from 'supertest';

/**
 * ONE HTTP SERVER PER APP, instead of one per request.
 *
 * `request(app)` where `app` is an Express handler makes supertest do this, per call:
 *
 *     app = http.createServer(app);   // Test constructor
 *     this._server = app.listen(0);   // serverAddress
 *     ...                             // and server.close() once the response lands
 *
 * A single API suite issues about 300 requests, so a full run bound, listened on and tore
 * down roughly twelve thousand TCP servers, each taking a fresh ephemeral port and leaving
 * it in TIME_WAIT. Node sets SO_REUSEADDR, so a later `listen(0)` is free to be handed a
 * port whose previous server is still closing or still has a socket in TIME_WAIT, and the
 * client that connects a microsecond later can be answered by the wrong socket.
 *
 * That is what the suite's residual flakiness actually looked like. In an instrumented run
 * of planned-work.report.api.test.ts the server logged `200` for every one of the 51
 * logins it received, while the client threw `Cannot read properties of undefined (reading
 * 'tokens')` — the request that failed never appeared in the server log at all. Other runs
 * produced a `405` that no route in this codebase can emit, and a `400` for a request the
 * server never answered with `400`. Responses were being delivered to the wrong request.
 * Nothing about the application was involved, which is why every implicated test passed
 * when run on its own.
 *
 * The fix is to stop churning ports. Supertest already reuses a server that is listening —
 * `serverAddress` only calls `listen(0)` when `app.address()` is null — but the constructor
 * has wrapped the Express app in a brand new server before that check runs. So the app is
 * recovered from the throwaway server's 'request' listener and mapped to one long-lived
 * server per app, created on first use and closed by `stopTestApp`.
 *
 * `this._server` is deliberately left unset: supertest closes `this._server` after each
 * response, and the shared server must outlive the request.
 */
const sharedServers = new Map<http.RequestListener, http.Server>();

type ServerAddress = (app: unknown, path: string) => string;

const originalServerAddress = Test.prototype.serverAddress as unknown as ServerAddress;

const patched: ServerAddress = function patchedServerAddress(this: Test, app, path) {
  // A string base URL, or a server the caller already started: nothing to pool.
  if (typeof app === 'string') return originalServerAddress.call(this, app, path);

  const server = app as http.Server;
  if (typeof server.address !== 'function' || server.address() !== null) {
    return originalServerAddress.call(this, app, path);
  }

  // `http.createServer(handler)` registers the handler as the sole 'request' listener, so
  // this is the Express app the caller passed to `request()`.
  const [handler] = server.listeners('request') as http.RequestListener[];
  if (typeof handler !== 'function') return originalServerAddress.call(this, app, path);

  let shared = sharedServers.get(handler);
  if (!shared) {
    shared = http.createServer(handler);
    // No host argument, exactly as supertest calls it. `listen(0)` binds during the call
    // so `address()` is populated before the 'listening' event fires; passing a host
    // instead routes through an asynchronous lookup and leaves `address()` null here.
    shared.listen(0);
    sharedServers.set(handler, shared);
  }

  (this as unknown as { app: http.Server }).app = shared;
  const { port } = shared.address() as AddressInfo;
  return `http://127.0.0.1:${port}${path}`;
};

Test.prototype.serverAddress = patched as unknown as typeof Test.prototype.serverAddress;

/** Closes every pooled server. Called from `stopTestApp`, so teardown stays deterministic. */
export async function closeSharedServers(): Promise<void> {
  const servers = [...sharedServers.values()];
  sharedServers.clear();

  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve) => {
          // Sockets are `Connection: close`, so there is nothing to keep alive, but
          // `closeAllConnections` makes the close unconditional rather than dependent on
          // a client having tidied up after itself.
          server.closeAllConnections?.();
          server.close(() => resolve());
        }),
    ),
  );
}
