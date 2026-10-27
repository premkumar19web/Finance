import { createContext, useContext } from 'react';
import type { Profile } from '../api/types';

export interface AuthState {
  status: 'loading' | 'authenticated' | 'anonymous';
  user: Profile | null;
  /** Set when the user was signed out because the session expired. */
  notice: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (...permissions: string[]) => boolean;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** The signed-in user (only call inside protected routes). */
export function useUser(): Profile {
  const { user } = useAuth();
  if (!user) throw new Error('useUser called without a signed-in user');
  return user;
}
