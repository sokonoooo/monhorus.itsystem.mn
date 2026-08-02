/**
 * Audit trail vocabulary per requirement 14.4.
 * The document lists Created, Updated, Assigned, StatusChanged, Submitted, Approved,
 * Returned, Closed and Cancelled. Section 18.1 additionally requires a log entry for
 * every significant action, so the authentication lifecycle is included here.
 */
export const AUDIT_ENTITY_TYPES = [
  'User',
  'Customer',
  'Project',
  'Building',
  'Floor',
  'Board',
  'Circuit',
  'Equipment',
  'Work',
  'Plan',
  'Conclusion',
  'Evaluation',
  'Material',
  'Invoice',
  'Payment',
  'Tariff',
  'Permission',
  'Settings',
] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

export const AUDIT_ACTIONS = [
  // Requirement 14.4 vocabulary
  'Created',
  'Updated',
  'Assigned',
  'StatusChanged',
  'Submitted',
  'Approved',
  'Returned',
  'Closed',
  'Cancelled',
  // Authentication lifecycle (req 16.2 / 18.1)
  'LoginSucceeded',
  'LoginFailed',
  'LoggedOut',
  'TokenRefreshed',
  'TokenReuseDetected',
  'AccountLocked',
  'Invited',
  'InvitationAccepted',
  'PasswordChanged',
  'SessionsRevoked',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Client surface the action originated from (req 14.4 Channel/Device). */
export const AUDIT_CHANNELS = ['WEB', 'MOBILE', 'SYSTEM'] as const;
export type AuditChannel = (typeof AUDIT_CHANNELS)[number];
