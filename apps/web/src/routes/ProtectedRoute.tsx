import type { ReactElement, ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { Spinner } from '../components/ui/Spinner';
import { useAuth } from '../contexts/auth-context';

export function ProtectedRoute({ children }: { children: ReactNode }): ReactElement {
  const { isAuthenticated, initialising, mustChangePassword } = useAuth();
  const location = useLocation();

  if (initialising) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  // A holder of an admin-issued passcode reaches nothing else until it is replaced.
  if (mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }

  return <>{children}</>;
}
