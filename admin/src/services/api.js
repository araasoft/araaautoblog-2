import { getAuthInstance } from "../lib/firebase";

const BASE = import.meta.env.VITE_API_BASE || "";

const handlers = { unauthorized: () => {}, pending: () => {}, readOnly: false };
export const setApiHandlers = (h) => Object.assign(handlers, h);

export async function getToken(force = false) {
  const a = getAuthInstance();
  const u = a && a.currentUser;
  if (!u) {
    handlers.unauthorized();
    throw new Error("Please sign in again");
  }
  return u.getIdToken(force);
}

export async function api(method, path, body, retried = false) {
  if (handlers.readOnly && method !== "GET" && !path.startsWith("/api/session")) throw new Error("Guest accounts are view-only");
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + (await getToken(retried)),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await res.json().catch(() => ({}));
  if (res.status === 401) {
    if (!retried) return api(method, path, body, true);
    handlers.unauthorized();
    throw new Error("Please sign in again");
  }
  if (res.status === 403 && d.code === "pending") {
    handlers.pending();
    throw new Error(d.error);
  }
  if (!res.ok || d.error) throw new Error(d.error || "Request failed (" + res.status + ")");
  return d;
}

/** Downloads a CSV export through the authenticated API. */
export async function downloadCsv(kind, params) {
  const r = await fetch(`${BASE}/api/export/${kind}.csv?${params}`, {
    headers: { Authorization: "Bearer " + (await getToken()) },
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || "Export failed");
  }
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = `araaposts-${kind}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function fetchAuthConfig() {
  try {
    return await (await fetch(BASE + "/auth-config")).json();
  } catch {
    return {};
  }
}
