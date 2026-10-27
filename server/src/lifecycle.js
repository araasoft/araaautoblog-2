// Graceful shutdown: stop claiming new work, wait for in-flight work, then exit.
let stopping = false;
const inflight = new Set(), hooks = [];
export const isShuttingDown = () => stopping;
export const onShutdown = (fn) => hooks.push(fn);
export function track(p) { inflight.add(p); const d = () => inflight.delete(p); p.then(d, d); return p; }
export async function shutdown(reason = "signal", { timeoutMs = 10_000, exit = true } = {}) {
  if (stopping) return; stopping = true;
  console.log(`[shutdown] ${reason}: no new jobs; waiting for ${inflight.size} in-flight`);
  for (const h of hooks) try { h(); } catch (e) { console.error("[shutdown] hook failed:", e.message); }
  await Promise.race([Promise.allSettled([...inflight]), new Promise((r) => setTimeout(r, timeoutMs))]);
  if (exit) process.exit(0);
}
export const _reset = () => { stopping = false; inflight.clear(); hooks.length = 0; };
