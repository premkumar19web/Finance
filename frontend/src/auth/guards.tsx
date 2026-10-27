import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { EmptyState, Spinner } from '../components/ui';
import { useAuth } from './context';

/** Sends signed-out visitors to the login page, remembering where they wanted to go. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === 'loading') {
    return (
      <div className="fullscreen-center">
        <Spinner label="Checking your session…" />
      </div>
    );
  }
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}

/**
 * Hides a screen from users without the permission. This only keeps the UI tidy —
 * the backend enforces every permission on every request regardless.
 */
export function RequirePermission({ any, children }: { any: string[]; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(...any)) {
    return (
      <EmptyState
        icon="lock"
        title="You don’t have access to this page"
        message="Ask an administrator if you need this permission."
      />
    );
  }
  return <>{children}</>;
}
