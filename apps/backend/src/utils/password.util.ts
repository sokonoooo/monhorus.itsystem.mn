import bcrypt from 'bcrypt';

/**
 * bcrypt cost factor. 12 is the current practical floor: roughly 250 ms per hash on
 * commodity hardware, slow enough to frustrate offline cracking and fast enough for
 * an interactive login.
 *
 * The test suite drops to 4. Every API test creates users and logs them in, so at cost 12
 * hashing dominated the run and pushed slower files past their timeout. Cost is a property
 * of each stored hash, so this changes only how test fixtures are hashed and never how a
 * real password is verified: bcrypt reads the factor back out of the hash when comparing.
 *
 * The comparison is deliberately equality against 'test' rather than a check for "not
 * production", so anything unexpected in NODE_ENV yields 12. The weak factor has to be
 * asked for explicitly; it can never be arrived at by accident.
 */
const BCRYPT_ROUNDS = process.env.NODE_ENV === 'test' ? 4 : 12;

/**
 * Hash of a throwaway value, used purely to equalise response timing when the
 * submitted email does not exist. Computed once at module load.
 */
const DUMMY_HASH = bcrypt.hashSync('monhorus-timing-equaliser', BCRYPT_ROUNDS);

export async function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, BCRYPT_ROUNDS);
}

/** Never throws. A malformed or absent hash is treated as a failed comparison. */
export async function comparePassword(plainPassword: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plainPassword, hash);
  } catch {
    return false;
  }
}

/**
 * Consumes an equivalent bcrypt cycle when the email does not exist, so that
 * response timing cannot be used to enumerate registered addresses.
 */
export async function burnPasswordCycle(plainPassword: string): Promise<void> {
  try {
    await bcrypt.compare(plainPassword, DUMMY_HASH);
  } catch {
    // Intentionally ignored: this call exists only to consume time.
  }
}
