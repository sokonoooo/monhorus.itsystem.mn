import type { UserRole } from '@monhorus/shared';
import { Types } from 'mongoose';

import type { RequestMeta } from '../../common/utils/request-meta.util';
import { logger } from '../../config/logger';
import { AuditLog, type AuditAction } from './audit-log.model';

export type { RequestMeta };

export interface AuditEntryInput {
  entityType: string;
  entityId?: Types.ObjectId | string | null;
  action: AuditAction;
  actor?: {
    id?: Types.ObjectId | string | null;
    role?: UserRole | null;
    label?: string | null;
  };
  meta?: RequestMeta | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
}

function toObjectId(value: Types.ObjectId | string | null | undefined): Types.ObjectId | null {
  if (!value) return null;
  return value instanceof Types.ObjectId ? value : new Types.ObjectId(value);
}

/**
 * Writes one audit row. Deliberately swallows its own failures: an audit write must
 * never turn a successful business operation into a 500. Failures are logged at
 * error level so they surface in monitoring instead of disappearing.
 */
export async function recordAudit(entry: AuditEntryInput): Promise<void> {
  try {
    await AuditLog.create({
      entityType: entry.entityType,
      entityId: toObjectId(entry.entityId),
      action: entry.action,
      user: toObjectId(entry.actor?.id),
      userRole: entry.actor?.role ?? null,
      userLabel: entry.actor?.label ?? null,
      userAgent: entry.meta?.userAgent ?? null,
      ip: entry.meta?.ip ?? null,
      oldValue: entry.oldValue ?? null,
      newValue: entry.newValue ?? null,
      reason: entry.reason ?? null,
    });
  } catch (error) {
    logger.error(
      { err: error, entityType: entry.entityType, action: entry.action },
      'Failed to write audit log entry',
    );
  }
}
