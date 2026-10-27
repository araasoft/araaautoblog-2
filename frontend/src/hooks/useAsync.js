import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Runs an async loader on mount and whenever `deps` change.
 * Ignores results from outdated runs. `reload()` re-runs it, `setData` patches the result.
 */
export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const run = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const load = useCallback(async (silent = false) => {
    const id = ++run.current;
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fnRef.current();
      if (id === run.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (id === run.current) setState({ data: null, error, loading: false });
    }
  }, []);

  useEffect(() => {
    load();
    return () => {
      run.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const setData = useCallback((d) => setState((s) => ({ ...s, data: typeof d === "function" ? d(s.data) : d })), []);

  return { ...state, reload: load, setData };
}
