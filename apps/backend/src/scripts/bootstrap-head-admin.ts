/**
 * Creates the first head_admin.
 *
 * Because there is no public registration, a fresh installation has no way to create
 * its first account through the API. This script is the only exception, and it
 * refuses to run once any head_admin exists.
 *
 * Usage: npm run bootstrap:admin --workspace @monhorus/backend
 */
import { connectDatabase, disconnectDatabase } from '../config/database';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { recordAudit } from '../modules/audit/audit.service';
import { User } from '../modules/user/user.model';
import { hashPassword } from '../utils/password.util';

async function main(): Promise<void> {
  const email = env.BOOTSTRAP_ADMIN_EMAIL;
  const password = env.BOOTSTRAP_ADMIN_PASSWORD;
  const fullName = env.BOOTSTRAP_ADMIN_NAME ?? 'Ерөнхий админ';

  if (!email || !password) {
    logger.error('BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD must be set in .env');
    process.exit(1);
  }

  await connectDatabase();

  const existing = await User.findOne({ role: 'head_admin' }).select('email');
  if (existing) {
    logger.warn(
      { email: existing.email },
      'A head_admin already exists. Use POST /api/v1/users instead.',
    );
    await disconnectDatabase();
    process.exit(0);
  }

  const user = await User.create({
    fullName,
    email: email.toLowerCase(),
    password: await hashPassword(password),
    phone: null,
    role: 'head_admin',
    status: 'active',
    passwordChangedAt: new Date(),
    createdBy: null,
  });

  await recordAudit({
    entityType: 'User',
    entityId: user._id,
    action: 'Created',
    reason: 'Bootstrap head administrator',
    newValue: { email: user.email, role: user.role },
  });

  logger.info({ email: user.email }, 'Head administrator created');
  logger.warn('Remove BOOTSTRAP_ADMIN_PASSWORD from .env now.');

  await disconnectDatabase();
  process.exit(0);
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Bootstrap failed');
  process.exit(1);
});
