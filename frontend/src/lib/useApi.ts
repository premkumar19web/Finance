import { useCallback, useEffect, useState } from 'react';
import { ApiError, buildUrl, request, type Query } from '../api/client';

interface State<T> {
  key: string | null;
  data: T | undefined;
  error: ApiError | undefined;
}

/**
 * Loads `path` (GET) and re-loads when the path or query changes. Pass `null`
 * to skip loading. The previous data stays visible while the next page loads.
 */
export function useApi<T>(path: string | null, query?: Query) {
  const url = path ? buildUrl(path, query) : null;
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<State<T>>({ key: null, data: undefined, error: undefined });
  const requestKey = url ? `${url}#${version}` : null;

  useEffect(() => {
    if (!url) return;
    const controller = new AbortController();
    const key = `${url}#${version}`;
    request<T>('GET', url, { signal: controller.signal }).then(
      (data) => setState({ key, data, error: undefined }),
      (error: unknown) => {
        if (controller.signal.aborted) return;
        const apiError = error instanceof ApiError ? error : new ApiError(0, 'UNKNOWN', 'Something went wrong.');
        setState((prev) => ({ key, data: prev.data, error: apiError }));
      },
    );
    return () => controller.abort();
  }, [url, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const settled = state.key === requestKey;

  return {
    data: state.data,
    error: settled ? state.error : undefined,
    loading: requestKey !== null && !settled,
    reload,
  };
}

/** Returns `value` after it has stopped changing for `delay` ms (for search boxes). */
export function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
