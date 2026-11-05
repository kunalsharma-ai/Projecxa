import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from './session';

/** Loads one API path; refetches on `reload()` (pull to refresh) and when the path changes. */
export function useLoad<T>(path: string | null) {
  const api = useApi();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [refreshing, setRefreshing] = useState(false);
  const seq = useRef(0);

  const run = useCallback(
    async (pull = false) => {
      if (!path) return;
      const n = ++seq.current;
      pull ? setRefreshing(true) : setLoading(true);
      try {
        const d = await api.get<T>(path);
        if (n === seq.current) {
          setData(d);
          setError(null);
        }
      } catch (e) {
        if (n === seq.current) setError((e as Error).message);
      } finally {
        if (n === seq.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [api, path],
  );

  useEffect(() => {
    void run();
  }, [run]);

  return { data, error, loading, refreshing, reload: () => run(true), setData };
}
