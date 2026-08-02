import argon2 from 'argon2';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';

/**
 * Argon2id with OWASP-recommended parameters (req 16.2 - Нууц үг hash).
 * memoryCost is expressed in KiB: 19456 KiB = 19 MiB.
 */
const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Returns the list of unmet rules, empty when the password is acceptable.
 * Exported so the Zod layer and the service layer share one definition.
 */
export function validatePasswordStrength(password: string): string[] {
  const failures: string[] = [];

  if (password.length < PASSWORD_MIN_LENGTH) {
    failures.push(`Нууц үг дор хаяж ${PASSWORD_MIN_LENGTH} тэмдэгттэй байна.`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    failures.push(`Нууц үг ${PASSWORD_MAX_LENGTH} тэмдэгтээс урт байж болохгүй.`);
  }
  if (!/[A-Za-zА-Яа-яӨөҮү]/.test(password)) {
    failures.push('Нууц үг дор хаяж нэг үсэг агуулна.');
  }
  if (!/\d/.test(password)) {
    failures.push('Нууц үг дор хаяж нэг тоо агуулна.');
  }

  return failures;
}

export function assertPasswordStrength(password: string): void {
  const failures = validatePasswordStrength(password);
  if (failures.length > 0) {
    throw AppError.badRequest(
      ERROR_CODES.WEAK_PASSWORD,
      failures.join(' '),
      failures.map((message) => ({ field: 'password', message })),
    );
  }
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

/**
 * Never throws on a malformed hash. A corrupted or absent hash is treated as a
 * failed verification so the caller cannot distinguish it from a wrong password.
 */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/**
 * Constant-ish work performed when the email does not exist, so that a probe cannot
 * tell a registered address from an unregistered one by response timing.
 */
export async function burnPasswordCycle(password: string): Promise<void> {
  try {
    await argon2.hash(password, ARGON2_OPTIONS);
  } catch {
    // Deliberately ignored: this call exists only to consume time.
  }
}
