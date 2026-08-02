import mongoose, { type ClientSession } from 'mongoose';

import { logger } from '../../config/logger';

/**
 * Runs a unit of work inside a MongoDB transaction.
 *
 * Multi-document transactions require a replica set or a sharded cluster. Every
 * production-grade deployment provides one, but a single-node `mongod` started for local
 * development does not. Rather than making the completion and approval flows unusable on
 * such a server, this helper detects support once and, when transactions are unavailable,
 * runs the same callback without a session and logs a warning. What is lost there is
 * atomicity, not the correctness of the individual writes.
 *
 * Support is determined from the server topology rather than by attempting a transaction
 * and catching the failure. `session.withTransaction` carries its own retry loop with a
 * 120 second deadline, so a probe-by-trial can sit retrying for minutes on a standalone
 * server before giving up, which looks exactly like a hung request.
 */

type Support = 'unknown' | 'supported' | 'unsupported';

let support: Support = 'unknown';

/** Test seam: forget the cached probe result. */
export function resetTransactionSupportProbe(): void {
  support = 'unknown';
}

/**
 * Asks the server what it is.
 *
 * `setName` is present on a replica set member; `msg: 'isdbgrid'` identifies a mongos.
 * Anything else is a standalone, which cannot start a transaction.
 */
async function detectSupport(): Promise<Support> {
  try {
    const admin = mongoose.connection.db?.admin();
    if (!admin) return 'unsupported';

    const info = (await admin.command({ hello: 1 })) as { setName?: string; msg?: string };
    return info.setName || info.msg === 'isdbgrid' ? 'supported' : 'unsupported';
  } catch (error) {
    // If the topology cannot be read, assume the safer of the two: run without a session
    // rather than risk a long retry loop on every call.
    logger.warn({ err: error }, 'Could not determine MongoDB transaction support');
    return 'unsupported';
  }
}

export async function withTransaction<T>(
  operation: (session: ClientSession | null) => Promise<T>,
): Promise<T> {
  if (support === 'unknown') {
    support = await detectSupport();
    if (support === 'unsupported') {
      logger.warn(
        'MongoDB deployment does not support transactions; falling back to sequential writes. ' +
          'Use a replica set in production so multi-document operations stay atomic.',
      );
    }
  }

  if (support === 'unsupported') {
    return operation(null);
  }

  const session = await mongoose.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async () => {
      result = await operation(session);
    });
    // `withTransaction` only resolves after the callback ran to completion.
    return result as T;
  } finally {
    await session.endSession();
  }
}
