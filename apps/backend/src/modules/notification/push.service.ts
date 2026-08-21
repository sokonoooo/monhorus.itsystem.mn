import { createSign } from 'node:crypto';

import { env } from '../../config/env';
import { logger } from '../../config/logger';

/**
 * Firebase Cloud Messaging transport.
 *
 * This talks to the FCM HTTP v1 REST API directly rather than depending on `firebase-admin`.
 * That package would bring a large dependency tree onto a host the deployment notes record
 * as 83% full with 3.9 GB free, to do three things this file already does: mint a Google
 * access token, POST a message, and read the error code back. The wire format is a
 * published, versioned HTTP contract, so the trade is a page of signing code against tens of
 * megabytes and a transitive-update surface.
 *
 * The shape follows `mail.service.ts` on purpose — adapters chosen by configuration, a test
 * seam, and a no-op default — because the operational question is the same one: what happens
 * on a deployment where the credentials were never set. Here the answer is that notifications
 * are still written to the database and nothing is pushed, which is exactly the behaviour
 * before push existed.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

/** Refresh a minute early so a token cannot expire mid-flight. */
const EXPIRY_SKEW_MS = 60_000;

export interface PushMessage {
  token: string;
  title: string;
  body: string | null;
  /** Delivered as FCM data, so a tapped notification can route without a lookup. */
  data: Record<string, string>;
}

/**
 * What one delivery attempt did.
 *
 * `unregistered` is separated from `failed` because only it justifies deactivating the row:
 * it means FCM knows the token and knows it is dead. A network blip is `failed` and must
 * leave the registration alone, or a transient outage would quietly unsubscribe everybody.
 */
export type PushOutcome =
  | { token: string; status: 'sent' }
  | { token: string; status: 'unregistered' }
  | { token: string; status: 'failed'; reason: string };

export interface PushTransport {
  send(messages: readonly PushMessage[]): Promise<PushOutcome[]>;
  readonly kind: 'fcm' | 'noop';
}

/**
 * The adapter used wherever FCM is not configured: development, the test suite, and any
 * deployment that has not been given credentials.
 *
 * Unlike mail, an unconfigured push transport is not an error even in production. The
 * in-app notification is the record of the event and is written either way; push is an
 * additional delivery on top of it. A deployment with no Firebase project is therefore
 * degraded, not broken, and must not be prevented from booting.
 */
const noopTransport: PushTransport = {
  kind: 'noop',
  async send(messages) {
    if (messages.length > 0) {
      logger.debug({ count: messages.length }, 'Push not configured; nothing dispatched');
    }
    return messages.map((message) => ({ token: message.token, status: 'failed' as const, reason: 'PUSH_NOT_CONFIGURED' }));
  },
};

interface CachedToken {
  value: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

/** Exposed for the test suite, which must not carry a token between cases. */
export function resetPushAccessToken(): void {
  cachedToken = null;
}

function base64Url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Exchanges the service-account key for an OAuth access token.
 *
 * This is the standard JWT-bearer flow: sign a short-lived assertion with the account's
 * private key, hand it to Google, receive an access token. The result is cached because a
 * notification fanning out to twenty recipients must not trigger twenty token exchanges.
 */
async function fetchAccessToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - EXPIRY_SKEW_MS > now) return cachedToken.value;

  const issuedAt = Math.floor(now / 1000);
  const claim = {
    iss: env.FIREBASE_CLIENT_EMAIL,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + 3600,
  };

  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify(claim));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);

  /*
   * The key arrives from the environment with literal backslash-n, because a PEM cannot
   * survive a single-line .env file otherwise. Turning those back into real newlines is
   * required for the key to parse at all.
   */
  const privateKey = (env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
  const assertion = `${header}.${payload}.${base64Url(signer.sign(privateKey))}`;

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!response.ok) {
    throw new Error(`Google token exchange failed with ${response.status}`);
  }

  const body = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error('Google token exchange returned no access_token');

  cachedToken = {
    value: body.access_token,
    expiresAt: now + (body.expires_in ?? 3600) * 1000,
  };
  return cachedToken.value;
}

/**
 * FCM reports a dead registration through one of these.
 *
 * UNREGISTERED is the app being uninstalled or the token rotated. INVALID_ARGUMENT covers a
 * token that is malformed or belongs to another Firebase project — also permanently
 * undeliverable from here, so it is treated the same way.
 */
function isDeadTokenError(status: number, errorStatus: string | undefined): boolean {
  if (status === 404) return true;
  return errorStatus === 'UNREGISTERED' || errorStatus === 'INVALID_ARGUMENT';
}

function createFcmTransport(): PushTransport {
  const endpoint = `https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`;

  return {
    kind: 'fcm',
    async send(messages) {
      if (messages.length === 0) return [];

      let accessToken: string;
      try {
        accessToken = await fetchAccessToken();
      } catch (error) {
        /*
         * A credential problem fails every message identically. Reported as `failed` rather
         * than `unregistered` so a misconfigured key cannot deactivate the entire estate of
         * registrations on its first run.
         */
        logger.error({ err: error }, 'Push access token could not be obtained');
        return messages.map((message) => ({
          token: message.token,
          status: 'failed' as const,
          reason: 'ACCESS_TOKEN_FAILED',
        }));
      }

      /*
       * HTTP v1 has no multicast endpoint; the batch API it replaced is deprecated. One
       * request per token is therefore the supported shape. They are issued together rather
       * than in sequence, because a fan-out to a dispatch team is otherwise as slow as the
       * sum of its round trips.
       */
      return Promise.all(
        messages.map(async (message): Promise<PushOutcome> => {
          try {
            const response = await fetch(endpoint, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                message: {
                  token: message.token,
                  notification: {
                    title: message.title,
                    ...(message.body ? { body: message.body } : {}),
                  },
                  data: message.data,
                  android: { priority: 'HIGH' },
                },
              }),
            });

            if (response.ok) return { token: message.token, status: 'sent' };

            const failure = (await response.json().catch(() => ({}))) as {
              error?: { status?: string; message?: string };
            };

            if (isDeadTokenError(response.status, failure.error?.status)) {
              return { token: message.token, status: 'unregistered' };
            }
            return {
              token: message.token,
              status: 'failed',
              reason: failure.error?.status ?? `HTTP_${response.status}`,
            };
          } catch (error) {
            return {
              token: message.token,
              status: 'failed',
              reason: error instanceof Error ? error.message : 'UNKNOWN',
            };
          }
        }),
      );
    },
  };
}

let transport: PushTransport | null = null;

export function getPushTransport(): PushTransport {
  transport ??= env.pushEnabled ? createFcmTransport() : noopTransport;
  return transport;
}

/** Test seam, matching `setMailTransport`. Passing null restores selection by config. */
export function setPushTransport(next: PushTransport | null): void {
  transport = next;
}
