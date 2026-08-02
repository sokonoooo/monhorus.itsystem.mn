import type { Request } from 'express';

import type { AuditChannel } from '../constants/audit.constant';

/**
 * Metadata that requirement 14.4 requires on every audit entry
 * (Channel/Device, IP/GPS) and that the session store attaches to each device.
 */
export interface RequestContext {
  channel: AuditChannel;
  userAgent: string | null;
  appVersion: string | null;
  deviceId: string | null;
  ip: string | null;
}

const MOBILE_HINT = /(okhttp|dart|flutter|monhorus-mobile)/i;

/**
 * Clients should send `X-Client-Channel: WEB|MOBILE`. When absent we fall back to
 * user-agent sniffing so an audit row is never written with an unknown channel.
 */
export function buildRequestContext(req: Request): RequestContext {
  const headerChannel = String(req.header('x-client-channel') ?? '').toUpperCase();
  const userAgent = req.header('user-agent') ?? null;

  let channel: AuditChannel;
  if (headerChannel === 'WEB' || headerChannel === 'MOBILE') {
    channel = headerChannel;
  } else if (userAgent && MOBILE_HINT.test(userAgent)) {
    channel = 'MOBILE';
  } else {
    channel = 'WEB';
  }

  return {
    channel,
    userAgent,
    appVersion: req.header('x-client-version') ?? null,
    deviceId: req.header('x-device-id') ?? null,
    ip: req.ip ?? null,
  };
}
