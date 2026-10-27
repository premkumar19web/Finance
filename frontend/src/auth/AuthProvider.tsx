import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, http, SESSION_EXPIRED_EVENT } from '../api/client';
import type { Envelope, Profile } from '../api/types';
import { AuthContext, type AuthState } from './context';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await http.get<Envelope<Profile>>('/auth/me');
      setUser(res.data);
      setStatus('authenticated');
    } catch (err) {
      setUser(null);
      setStatus('anonymous');
      if (err instanceof ApiError && err.status !== 401) setNotice(err.message);
    }
  }, []);

  // Restore an existing session: the cookie is HttpOnly, so only the server can tell.
  useEffect(() => {
    http.get<Envelope<Profile>>('/auth/me').then(
      (res) => {
        setUser(res.data);
        setStatus('authenticated');
      },
      (err: unknown) => {
        setStatus('anonymous');
        if (err instanceof ApiError && err.status !== 401) setNotice(err.message);
      },
    );
  }, []);

  useEffect(() => {
    const onExpired = () => {
      setUser(null);
      setStatus('anonymous');
      setNotice('Your session has expired. Please sign in again.');
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await http.post<Envelope<Profile>>('/auth/login', { email, password });
    setNotice(null);
    setUser(res.data);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    try {
      await http.post('/auth/logout');
    } finally {
      // Clear local state even if the network call fails.
      setUser(null);
      setStatus('anonymous');
      setNotice(null);
    }
  }, []);

  const can = useCallback(
    (...permissions: string[]) => !!user && permissions.some((p) => user.permissions.includes(p)),
    [user],
  );

  const value = useMemo<AuthState>(
    () => ({ status, user, notice, login, logout, refresh, can }),
    [status, user, notice, login, logout, refresh, can],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
