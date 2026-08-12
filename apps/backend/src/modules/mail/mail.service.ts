import { env } from '../../config/env';
import { logger } from '../../config/logger';

/**
 * Outbound mail.
 *
 * The system had no way to send anything before this — every "notification" is a Mongo row
 * the web app renders — so this module is the whole transport, deliberately kept to the one
 * shape the password-reset flow needs rather than generalised on speculation.
 *
 * Two adapters, chosen by configuration rather than by environment: SMTP when a host is
 * set, and otherwise a logging adapter that writes the message (including the reset link)
 * to the server log. The fallback is not a stub to be replaced later, it is what makes the
 * feature developable and testable: `npm run dev` on a laptop and the test suite both run
 * with no mail server and no network, and the developer still gets a working link out of
 * the log. A deployment sets SMTP_HOST and the same code sends for real.
 */
export interface MailMessage {
  to: string;
  subject: string;
  /** Plain-text body. Always sent — some clients, and every log, only have this. */
  text: string;
  html: string;
}

export interface MailTransport {
  /** Resolves once the message is handed off. Never throws; see `sendMail`. */
  send(message: MailMessage): Promise<void>;
  /** Which adapter is live, for logging and for tests to assert against. */
  readonly kind: 'smtp' | 'log';
}

/**
 * The minimum of nodemailer this module uses.
 *
 * Declared here rather than pulled from `@types/nodemailer` so the backend still compiles
 * before the dependency is installed. The surface is two calls wide; a wrong guess would
 * fail loudly on the first send rather than silently.
 */
interface NodemailerLike {
  createTransport(options: Record<string, unknown>): {
    sendMail(message: {
      from: string;
      to: string;
      subject: string;
      text: string;
      html: string;
    }): Promise<unknown>;
  };
}

/**
 * Writes the message to the log instead of sending it.
 *
 * The body is logged in full and on purpose. This adapter only ever runs where mail is not
 * configured — a developer machine or the test suite — and there the link IS the delivery
 * mechanism: without it a developer cannot complete the flow they are building. It never
 * runs in a deployment that has SMTP_HOST set, which is the only place a logged reset link
 * would be a disclosure.
 */
const logTransport: MailTransport = {
  kind: 'log',
  async send(message) {
    logger.info(
      { to: message.to, subject: message.subject, body: message.text },
      'Mail not configured; message written to the log instead of sent',
    );
  },
};

function createSmtpTransport(): MailTransport {
  return {
    kind: 'smtp',
    async send(message) {
      // Imported here, not at module load, for two reasons: the backend must compile and
      // boot without the dependency present, and a deployment that never sends mail should
      // not pay for loading it.
      //
      // The specifier goes through a variable on purpose. A literal would be resolved by
      // the compiler, and this file has to typecheck in a checkout where `npm install` has
      // not yet pulled nodemailer down — which is every checkout until someone configures
      // SMTP. `NodemailerLike` above is the contract instead.
      const specifier = 'nodemailer';
      const nodemailer = (await import(specifier)) as unknown as NodemailerLike;

      const transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        // Omitted entirely when absent: nodemailer treats an `auth` object with undefined
        // members as a request to authenticate, which an open internal relay refuses.
        ...(env.SMTP_USER && env.SMTP_PASS
          ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } }
          : {}),
      });

      await transporter.sendMail({
        from: env.MAIL_FROM,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    },
  };
}

let transport: MailTransport | null = null;

export function getMailTransport(): MailTransport {
  transport ??= env.mailEnabled ? createSmtpTransport() : logTransport;
  return transport;
}

/** Test seam. Passing null restores the configured adapter. */
export function setMailTransport(next: MailTransport | null): void {
  transport = next;
}

/**
 * Sends a message, swallowing any failure.
 *
 * Mail is delivered on a best-effort basis exactly as `notify()` is: a mail server that is
 * down or a missing `nodemailer` must not turn a password-reset request into a 500. It must
 * especially not do so on the request endpoint, where a thrown error would answer
 * differently for a registered address than for an unknown one and hand out precisely the
 * account enumeration that endpoint exists to prevent. The failure is logged at error level
 * so an operator sees it.
 */
export async function sendMail(message: MailMessage): Promise<void> {
  try {
    await getMailTransport().send(message);
  } catch (error) {
    logger.error({ err: error, to: message.to, subject: message.subject }, 'Mail send failed');
  }
}
