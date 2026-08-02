import type { UserRole } from '@monhorus/shared';
import type { ReactElement, ReactNode } from 'react';

import { Alert } from '../components/ui/Alert';
import { useAuth } from '../contexts/auth-context';

interface RoleGuardProps {
  allow: UserRole[];
  children: ReactNode;
  /** When true, renders nothing instead of an error. Use for conditional buttons. */
  silent?: boolean;
}

/**
 * Client-side role gate. Presentation only: the backend RBAC middleware is the real
 * boundary. This exists so the UI does not offer actions that would return 403.
 */
export function RoleGuard({ allow, children, silent = false }: RoleGuardProps): ReactElement | null {
  const { user } = useAuth();

  if (!user || !allow.includes(user.role)) {
    if (silent) return null;
    return (
      <Alert variant="error" title="Хандах эрхгүй">
        Энэ хэсэгт хандах эрх байхгүй байна.
      </Alert>
    );
  }

  return <>{children}</>;
}
