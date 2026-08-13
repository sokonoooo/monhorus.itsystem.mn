import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Which adapter an unconfigured deployment gets.
 *
 * `env` is parsed once at module load and `getMailTransport` memoises its choice, so each
 * case re-mocks the config and re-imports the module rather than trying to mutate either.
 */
async function loadMailService(overrides: { mailEnabled: boolean; isProduction: boolean }) {
  vi.resetModules();

  const logged: Array<Record<string, unknown>> = [];
  const errored: Array<Record<string, unknown>> = [];

  vi.doMock('../../config/env', () => ({
    env: {
      mailEnabled: overrides.mailEnabled,
      isProduction: overrides.isProduction,
      SMTP_HOST: overrides.mailEnabled ? 'smtp.example.mn' : undefined,
      SMTP_PORT: 587,
      SMTP_SECURE: false,
      SMTP_USER: undefined,
      SMTP_PASS: undefined,
      MAIL_FROM: 'Monhorus <no-reply@example.mn>',
    },
  }));

  vi.doMock('../../config/logger', () => ({
    logger: {
      info: (payload: Record<string, unknown>) => logged.push(payload),
      error: (payload: Record<string, unknown>) => errored.push(payload),
      warn: () => undefined,
      debug: () => undefined,
    },
  }));

  // `.js` because the package is CJS under `moduleResolution: nodenext`, where a dynamic
  // import is an ESM specifier and needs the extension. TS maps it back to the .ts source.
  const module = await import('./mail.service.js');
  return { module, logged, errored };
}

const message = {
  to: 'someone@example.mn',
  subject: 'Нууц үг сэргээх',
  text: 'https://monhorus.itsystem.mn/reset-password/LIVE-TOKEN-VALUE',
  html: '<a href="https://monhorus.itsystem.mn/reset-password/LIVE-TOKEN-VALUE">reset</a>',
};

afterEach(() => {
  vi.doUnmock('../../config/env');
  vi.doUnmock('../../config/logger');
  vi.resetModules();
});

describe('mail transport selection', () => {
  /**
   * The disclosure this closes.
   *
   * With SMTP unconfigured the transport degraded to writing the whole message body to the
   * log, and a password-reset body carries a live single-use token. That is right on a
   * developer machine, where the logged link IS the delivery mechanism — and wrong on a
   * production host shared with other tenants, where it puts an account-takeover credential
   * into the journal while telling the user an email was sent.
   */
  it('refuses to log the body in production, and fails loudly instead', async () => {
    const { module, logged, errored } = await loadMailService({
      mailEnabled: false,
      isProduction: true,
    });

    await expect(module.getMailTransport().send(message)).rejects.toThrow(
      /Mail transport is not configured/,
    );

    expect(logged).toHaveLength(0);
    expect(errored).toHaveLength(1);

    // The token must not appear anywhere in what was recorded.
    expect(JSON.stringify(errored)).not.toContain('LIVE-TOKEN-VALUE');
    expect(errored[0]).toMatchObject({ to: message.to, subject: message.subject });
    expect(errored[0]).not.toHaveProperty('body');
  });

  /**
   * The other half: local development must keep working exactly as before, because there
   * the logged link is the only way to complete the flow being built.
   */
  it('still writes the body to the log outside production', async () => {
    const { module, logged, errored } = await loadMailService({
      mailEnabled: false,
      isProduction: false,
    });

    await expect(module.getMailTransport().send(message)).resolves.toBeUndefined();

    expect(errored).toHaveLength(0);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ body: message.text });
  });

  it('uses SMTP whenever a host is configured, in production or not', async () => {
    for (const isProduction of [true, false]) {
      const { module } = await loadMailService({ mailEnabled: true, isProduction });
      expect(module.getMailTransport().kind).toBe('smtp');
    }
  });
});
