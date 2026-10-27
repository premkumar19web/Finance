import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';

type FilterValues = Record<string, string>;

/**
 * List filters kept in the URL (?search=…&page=2), so they survive refreshes and
 * the browser back button. Changing any filter other than `page` returns to page 1.
 */
export function useFilters<T extends FilterValues>(defaults: T) {
  const [params, setParams] = useSearchParams();
  // Callers pass a new object literal every render; compare defaults by content.
  const defaultsKey = JSON.stringify(defaults);

  const filters = useMemo(() => {
    const out: FilterValues = JSON.parse(defaultsKey);
    for (const key of Object.keys(out)) {
      const v = params.get(key);
      if (v !== null) out[key] = v;
    }
    return out as T;
  }, [params, defaultsKey]);

  const setFilters = useCallback(
    (patch: Partial<T>) => {
      const base: FilterValues = JSON.parse(defaultsKey);
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(patch)) {
            if (value === undefined || value === '' || value === base[key]) next.delete(key);
            else next.set(key, String(value));
          }
          if (!('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams, defaultsKey],
  );

  return [filters, setFilters] as const;
}
