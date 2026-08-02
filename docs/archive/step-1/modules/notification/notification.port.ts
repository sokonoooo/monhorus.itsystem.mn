import { env } from '../../config/env';
import { logger } from '../../config/logger';

/**
 * Outbound notification boundary.
 *
 * OPEN DECISION: the requirements document specifies notification recipients and
 * events (section 14.3) but names no transport provider. Until the email/SMS provider
 * is chosen, the default adapter logs the payload so the invitation flow is fully
 * testable end to end. Swap in an SMTP or provider adapter behind this same interface
 * without touching auth.service.
 */
export interface InvitationEmailPayload {
  to: string;
  fullName: string;
  acceptUrl: string;
  expiresAt: Date;
  invitedByName: string;
}

export interface NotificationPort {
  sendInvitationEmail(payload: InvitationEmailPayload): Promise<void>;
}

export const consoleNotificationAdapter: NotificationPort = {
  async sendInvitationEmail(payload: InvitationEmailPayload): Promise<void> {
    logger.info(
      {
        to: payload.to,
        acceptUrl: payload.acceptUrl,
        expiresAt: payload.expiresAt.toISOString(),
      },
      'Invitation email (console adapter - no provider configured)',
    );
  },
};

export const notificationService: NotificationPort = consoleNotificationAdapter;

export function buildInvitationAcceptUrl(rawToken: string): string {
  const url = new URL(env.INVITATION_ACCEPT_URL);
  url.searchParams.set('token', rawToken);
  return url.toString();
}
