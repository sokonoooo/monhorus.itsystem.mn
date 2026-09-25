import type { Express } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetDomainCollections, startTestApp, stopTestApp } from '../../test/helpers';
import { hashToken } from '../../utils/jwt.util';
import { comparePassword, hashPassword } from '../../utils/password.util';
import { AuditLog } from '../audit/audit-log.model';
import { setMailTransport, type MailMessage, type MailTransport } from '../mail/mail.service';
import { PasswordResetToken } from '../user/password-reset-token.model';
import { Session } from '../user/session.model';
import { User } from '../user/user.model';

const API = '/api/v1';
const EMAIL = 'reset-me@test.mn';
const PASSWORD = 'OriginalPassword2026x';
const NEW_PASSWORD = 'BrandNewPassword2026x';

let app: Express;

/** Captures what would have been mailed, so the link can be read back out of it. */
const sent: MailMessage[] = [];
const captureTransport: MailTransport = {
  kind: 'log',
  async send(message) {
    sent.push(message);
  },
};

/** The raw token as the reader would receive it: pulled out of the link in the mail. */
function tokenFromLastMail(): string {
  const message = sent.at(-1);
  if (!message) throw new Error('no mail was sent');
  const match = /\/reset-password\/([A-Za-z0-9_-]+)/.exec(message.text);
  if (!match?.[1]) throw new Error(`no reset link in mail body: ${message.text}`);
  return match[1];
}

async function createUser(overrides: Record<string, unknown> = {}): Promise<string> {
  const user = await User.create({
    fullName: 'Сэргээх Хэрэглэгч',
    email: EMAIL,
    password: await hashPassword(PASSWORD),
    role: 'head_admin',
    roles: [],
    status: 'active',
    passwordChangedAt: new Date(),
    ...overrides,
  });
  return String(user._id);
}

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await stopTestApp();
});

beforeEach(async () => {
  await resetDomainCollections();
  await User.deleteMany({});
  await Session.deleteMany({});
  await PasswordResetToken.deleteMany({});
  // AuditLog is deliberately immutable — its schema blocks every update and delete hook —
  // so it is never cleared here. The two assertions against it scope by the user's id,
  // which is fresh in every test.
  sent.length = 0;
  setMailTransport(captureTransport);
});

afterEach(() => {
  setMailTransport(null);
  vi.restoreAllMocks();
});

describe('POST /auth/forgot-password', () => {
  /**
   * The security property this endpoint exists to have. A caller who can tell a registered
   * address from an unregistered one has been handed the user list.
   */
  it('answers identically for a registered and an unregistered address', async () => {
    await createUser();

    const known = await request(app).post(`${API}/auth/forgot-password`).send({ email: EMAIL });
    const unknown = await request(app)
      .post(`${API}/auth/forgot-password`)
      .send({ email: 'nobody@test.mn' });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);
    // And the body must not carry the answer in some incidental field.
    expect(JSON.stringify(known.body)).not.toContain(EMAIL);
  });

  it('mails a reset link to a registered address', async () => {
    await createUser();

    await request(app).post(`${API}/auth/forgot-password`).send({ email: EMAIL });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(EMAIL);
    expect(tokenFromLastMail().length).toBeGreaterThan(16);
  });

  it('sends nothing at all for an unregistered address', async () => {
    await request(app).post(`${API}/auth/forgot-password`).send({ email: 'nobody@test.mn' });

    expect(sent).toHaveLength(0);
    expect(await PasswordResetToken.countDocuments()).toBe(0);
  });

  /** Only the digest is kept, so a dump of the collection yields nothing replayable. */
  it('stores only a hash of the token, never the token itself', async () => {
    await createUser();

    await request(app).post(`${API}/auth/forgot-password`).send({ email: EMAIL });

    const raw = tokenFromLastMail();
    const stored = await PasswordResetToken.findOne({});
    expect(stored?.tokenHash).toBe(hashToken(raw));
    expect(JSON.stringify(stored?.toObject())).not.toContain(raw);
  });

  /** One request, one live link: the older one must stop working immediately. */
  it('revokes an earlier outstanding link when a new one is requested', async () => {
    await createUser();

    await request(app).post(`${API}/auth/forgot-password`).send({ email: EMAIL });
    const first = tokenFromLastMail();
    await request(app).post(`${API}/auth/forgot-password`).send({ email: EMAIL });
    const second = tokenFromLastMail();
    expect(second).not.toBe(first);

    const reused = await request(app)
      .post(`${API}/auth/reset-password`)
      .send({ token: first, newPassword: NEW_PASSWORD });

    expect(reused.status).toBe(400);
    expect(reused.body.code).toBe('RESET_TOKEN_INVALID');
  });

  /**
   * A suspended account is treated as absent: resetting would produce a working credential
   * that still cannot sign in, and would confirm the address exists.
   */
  it('issues nothing for a suspended account, and says so no differently', async () => {
    await createUser({ status: 'suspended' });

    const response = await request(app)
      .post(`${API}/auth/forgot-password`)
      .send({ email: EMAIL });

    expect(response.status).toBe(200);
    expect(sent).toHaveLength(0);
    expect(await PasswordResetToken.countDocuments()).toBe(0);
  });

  it('records the request in the audit trail', async () => {
    const userId = await createUser();

    await request(app).post(`${API}/auth/forgot-password`).send({ email: EMAIL });

    const entry = await AuditLog.findOne({
      action: 'PasswordResetRequested',
      entityId: userId,
    });
    expect(entry).not.toBeNull();
  });
});

describe('POST /auth/reset-password', () => {
  async function requestLink(): Promise<string> {
    await request(app).post(`${API}/auth/forgot-password`).send({ email: EMAIL });
    return tokenFromLastMail();
  }

  it('sets the new password and lets the user sign in with it', async () => {
    await createUser();
    const token = await requestLink();

    const response = await request(app)
      .post(`${API}/auth/reset-password`)
      .send({ token, newPassword: NEW_PASSWORD });
    expect(response.status).toBe(200);

    const login = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: EMAIL, password: NEW_PASSWORD });
    expect(login.status).toBe(200);

    const stale = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: EMAIL, password: PASSWORD });
    expect(stale.status).toBe(401);
  });

  /** Single-use is the requirement; this is the test that holds it. */
  it('refuses a token that has already been used', async () => {
    await createUser();
    const token = await requestLink();

    const first = await request(app)
      .post(`${API}/auth/reset-password`)
      .send({ token, newPassword: NEW_PASSWORD });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`${API}/auth/reset-password`)
      .send({ token, newPassword: 'ThirdPassword2026x' });

    expect(second.status).toBe(400);
    expect(second.body.code).toBe('RESET_TOKEN_INVALID');
    // And the second attempt changed nothing.
    const user = await User.findOne({ email: EMAIL }).select('+password');
    expect(await comparePassword(NEW_PASSWORD, user!.password)).toBe(true);
  });

  it('refuses a token whose time has run out', async () => {
    await createUser();
    const token = await requestLink();

    // Reach past the row rather than waiting an hour; expiry is compared on read.
    await PasswordResetToken.updateOne(
      { tokenHash: hashToken(token) },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );

    const response = await request(app)
      .post(`${API}/auth/reset-password`)
      .send({ token, newPassword: NEW_PASSWORD });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('RESET_TOKEN_INVALID');
  });

  it('refuses a token that was never issued', async () => {
    await createUser();

    const response = await request(app)
      .post(`${API}/auth/reset-password`)
      .send({ token: 'a'.repeat(43), newPassword: NEW_PASSWORD });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('RESET_TOKEN_INVALID');
  });

  /**
   * Unknown, expired and already-spent must be indistinguishable, or a leaked link tells
   * its holder whether they are too late.
   */
  it('gives the same answer for unknown, expired and spent tokens', async () => {
    await createUser();
    const spent = await requestLink();
    await request(app).post(`${API}/auth/reset-password`).send({ token: spent, newPassword: NEW_PASSWORD });

    const expired = await requestLink();
    await PasswordResetToken.updateOne(
      { tokenHash: hashToken(expired) },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );

    const answers = await Promise.all(
      [spent, expired, 'b'.repeat(43)].map(async (token) => {
        const response = await request(app)
          .post(`${API}/auth/reset-password`)
          .send({ token, newPassword: 'AnotherPassword2026x' });
        return { status: response.status, body: response.body };
      }),
    );

    expect(answers[1]).toEqual(answers[0]);
    expect(answers[2]).toEqual(answers[0]);
  });

  /** A forgotten password is indistinguishable from a stolen one; sessions must end. */
  it('revokes every existing session', async () => {
    await createUser();
    const login = await request(app)
      .post(`${API}/auth/login`)
      .send({ email: EMAIL, password: PASSWORD });
    expect(login.status).toBe(200);
    expect(await Session.countDocuments({ revokedAt: null })).toBe(1);

    const token = await requestLink();
    await request(app).post(`${API}/auth/reset-password`).send({ token, newPassword: NEW_PASSWORD });

    expect(await Session.countDocuments({ revokedAt: null })).toBe(0);
    const session = await Session.findOne({});
    expect(session?.revokedReason).toBe('Password reset');
  });

  /** Somebody who proved control of the mailbox should not stay locked out by old guesses. */
  it('clears a lockout and the forced-change status', async () => {
    await createUser({
      status: 'must_change_password',
      failedLoginAttempts: 5,
      lockedUntil: new Date(Date.now() + 60_000),
    });
    const token = await requestLink();

    await request(app).post(`${API}/auth/reset-password`).send({ token, newPassword: NEW_PASSWORD });

    const user = await User.findOne({ email: EMAIL });
    expect(user?.status).toBe('active');
    expect(user?.failedLoginAttempts).toBe(0);
    expect(user?.lockedUntil).toBeNull();
  });

  it('rejects a weak new password without consuming the link', async () => {
    await createUser();
    const token = await requestLink();

    const weak = await request(app)
      .post(`${API}/auth/reset-password`)
      .send({ token, newPassword: 'short' });
    expect(weak.status).toBe(400);

    // The link survives, so a typo does not cost the user another round of email.
    const retry = await request(app)
      .post(`${API}/auth/reset-password`)
      .send({ token, newPassword: NEW_PASSWORD });
    expect(retry.status).toBe(200);
  });

  it('records the completion in the audit trail', async () => {
    const userId = await createUser();
    const token = await requestLink();

    await request(app).post(`${API}/auth/reset-password`).send({ token, newPassword: NEW_PASSWORD });

    const entry = await AuditLog.findOne({
      action: 'PasswordResetCompleted',
      entityId: userId,
    });
    expect(entry).not.toBeNull();
  });
});
