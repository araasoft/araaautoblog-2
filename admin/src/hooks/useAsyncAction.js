import { useCallback, useRef, useState } from "react";
import { notify } from "../utils/notify";

/** Wraps an async handler: tracks `busy`, blocks double submits and toasts errors. */
export function useAsyncAction() {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  const run = useCallback(async (fn) => {
    if (lock.current) return undefined;
    lock.current = true;
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      notify.error(e.message || "Something went wrong");
      return undefined;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }, []);

  return [run, busy];
}
