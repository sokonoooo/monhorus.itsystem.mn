/**
 * Creates the first SYSTEM_ADMIN account.
 *
 * Requirement 5.1 and the permission matrix in 14.2 mean every account is created by
 * an admin, which leaves a chicken-and-egg problem for a fresh installation. This
 * script is the only way an account is ever created without an inviter, and it refuses
 * to run once any admin exists.
 *
 * Usage: pnpm --filter @monhorus/backend bootstrap:admin
 */
import { connectDatabase, disconnectDatabase } from '../config/database';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { recordAudit } from '../modules/audit/audit.service';
import { assertPasswordStrength, hashPassword } from '../modules/auth/password.service';
import { User } from '../modules/user/user.model';

async function main(): Promise<void> {
  const email = env.BOOTSTRAP_ADMIN_EMAIL;
  const password = env.BOOTSTRAP_ADMIN_PASSWORD;
  const fullName = env.BOOTSTRAP_ADMIN_NAME ?? 'Системийн админ';

  if (!email || !password) {
    logger.error(
      'BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD must be set in .env',
    );
    process.exit(1);
  }

  assertPasswordStrength(password);

  await connectDatabase();

  const existingAdmin = await User.findOne({ role: 'ADMIN' }).select('_id email');
  if (existingAdmin) {
    logger.warn(
      { email: existingAdmin.email },
      'An admin account already exists. Use POST /api/v1/auth/invitations instead.',
    );
    await disconnectDatabase();
    process.exit(0);
  }

  const user = await User.create({
    email: email.toLowerCase(),
    fullName,
    role: 'ADMIN',
    permissions: ['SYSTEM_ADMIN'],
    organization: null,
    office: null,
    status: 'ACTIVE',
    passwordHash: await hashPassword(password),
    passwordChangedAt: new Date(),
  });

  await recordAudit({
    entityType: 'User',
    entityId: user._id,
    action: 'Created',
    channelOverride: 'SYSTEM',
    reason: 'Bootstrap system administrator',
    newValue: { email: user.email, role: user.role, permissions: user.permissions },
  });

  logger.info({ email: user.email }, 'System administrator created');
  logger.warn('Remove BOOTSTRAP_ADMIN_PASSWORD from .env now.');

  await disconnectDatabase();
  process.exit(0);
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Bootstrap failed');
  process.exit(1);
});
