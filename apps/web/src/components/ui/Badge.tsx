import {
  ACCOUNT_STATUS_LABELS,
  USER_ROLE_LABELS,
  type AccountStatus,
  type UserRole,
} from '@monhorus/shared';
import type { ReactElement } from 'react';

const STATUS_STYLES: Record<AccountStatus, string> = {
  active: 'bg-green-50 text-green-700 ring-green-200',
  suspended: 'bg-red-50 text-red-700 ring-red-200',
  must_change_password: 'bg-amber-50 text-amber-700 ring-amber-200',
};

const ROLE_STYLES: Record<UserRole, string> = {
  customer: 'bg-slate-50 text-slate-700 ring-slate-200',
  technician: 'bg-blue-50 text-blue-700 ring-blue-200',
  admin: 'bg-violet-50 text-violet-700 ring-violet-200',
  head_admin: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200',
};

const BASE = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset';

export function StatusBadge({ status }: { status: AccountStatus }): ReactElement {
  return <span className={`${BASE} ${STATUS_STYLES[status]}`}>{ACCOUNT_STATUS_LABELS[status]}</span>;
}

export function RoleBadge({ role }: { role: UserRole }): ReactElement {
  return <span className={`${BASE} ${ROLE_STYLES[role]}`}>{USER_ROLE_LABELS[role]}</span>;
}
