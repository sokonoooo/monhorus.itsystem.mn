import type { ReactElement, ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Spinner';
import { ErrorState } from '../components/ui/States';
import { useAuth } from '../contexts/auth-context';

export function ProtectedRoute({ children }: { children: ReactNode }): ReactElement {
  const { isAuthenticated, initialising, mustChangePassword, sessionUnavailable, retrySessionRestore } =
    useAuth();
  const location = useLocation();

  if (initialising) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Spinner size="lg" />
      </div>
    );
  }

  // Checked before `isAuthenticated`, because during an outage the cached user still reads
  // as authenticated while the permission set is empty. Rendering the shell then would show
  // an admin an app with no navigation and no stated reason, so nothing renders until
  // /auth/me confirms the session.
  if (sessionUnavailable) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <ErrorState
          title="Сервертэй холбогдож чадсангүй"
          description="Таны нэвтрэлт хүчинтэй хэвээр байна. Сүлжээгээ шалгаад дахин оролдоно уу."
          action={<Button onClick={retrySessionRestore}>Дахин оролдох</Button>}
        />
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
