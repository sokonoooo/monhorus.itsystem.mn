import type { PermissionKey } from '@monhorus/shared';
import type { ReactElement, ReactNode } from 'react';

import { useAuth } from '../contexts/auth-context';
import { ForbiddenState } from './ui/States';

interface PermissionGuardProps {
  /** Any-of. An empty list allows every authenticated user. */
  anyOf: readonly PermissionKey[];
  children: ReactNode;
  /** Render nothing instead of the forbidden panel. Use for inline actions. */
  silent?: boolean;
}

/**
 * Presentation-layer permission gate.
 *
 * This is not authorization. The backend rejects an unpermitted request regardless of
 * what the UI renders; this component only avoids showing controls that would fail.
 */
export function PermissionGuard({
  anyOf,
  children,
  silent = false,
}: PermissionGuardProps): ReactElement | null {
  const { canAny } = useAuth();

  if (anyOf.length > 0 && !canAny(...anyOf)) {
    return silent ? null : <ForbiddenState />;
  }

  return <>{children}</>;
}
