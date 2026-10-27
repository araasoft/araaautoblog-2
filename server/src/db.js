// Database layer: Firebase Realtime Database over REST (service account, no dependencies).
// If Firebase is not configured it falls back to a local JSON file, so the app still runs.
// Path style: "app/settings", "posts/0001-abc", "users/<uid>".
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { httpError } from "./facebook.js";

const b64u = (x) => Buffer.from(x).toString("base64url");
const segs = (p) => String(p).split("/").filter(Boolean);

/* ---------------- config ---------------- */
let memo;
function cfg() {
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || "").trim();
  const url = (process.env.FIREBASE_DATABASE_URL || "").trim().replace(/\/+$/, "");
  const key = raw + "|" + url + "|" + (process.env.FIREBASE_PROJECT_ID || "");
  if (memo?.key === key) return memo.v;
  let sa = null;
  if (raw) {
    try {
      const txt = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
      const j = JSON.parse(txt);
      if (j.client_email && j.private_key) sa = { ...j, private_key: String(j.private_key).replace(/\\n/g, "\n") };
    } catch {
      /* invalid JSON: treated as not configured, reported by status() */
    }
  }
  const v = {
    sa,
    url,
    projectId: (process.env.FIREBASE_PROJECT_ID || sa?.project_id || "").trim(),
    rawSet: Boolean(raw),
  };
  v.remote = Boolean(sa && url);
  memo = { key, v };
  return v;
}
export const remote = () => cfg().remote;
export const projectId = () => cfg().projectId;
export const problems = () => {
  const c = cfg();
  const out = [];
  if (c.rawSet && !c.sa) out.push("FIREBASE_SERVICE_ACCOUNT is not valid JSON (paste the whole downloaded key file)");
  if (c.sa && !c.url) out.push("FIREBASE_DATABASE_URL is missing");
  if (!c.rawSet && c.url) out.push("FIREBASE_SERVICE_ACCOUNT is missing");
  return out;
};

/* ---------------- Firebase REST ---------------- */
let tok = { v: null, exp: 0 };
async function accessToken() {
  if (tok.v && Date.now() < tok.exp - 60_000) return tok.v;
  const { sa } = cfg();
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64u(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const sig = crypto.createSign("RSA-SHA256").update(`${head}.${claim}`).sign(sa.private_key).toString("base64url");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(30_000),
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${head}.${claim}.${sig}`,
    }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.access_token)
    throw httpError(502, `Firebase service account sign-in failed: ${d.error_description || d.error || res.status}`);
  tok = { v: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 };
  return tok.v;
}

async function rtdb(method, p, { body, query = {}, headers = {} } = {}) {
  const { url } = cfg();
  const u = new URL(`${url}/${segs(p).map(encodeURIComponent).join("/")}.json`);
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
  const res = await fetch(u, {
    method,
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok && res.status !== 412)
    throw httpError(502, `Firebase database error (${res.status}): ${data?.error || "check FIREBASE_DATABASE_URL and the service account"}`);
  return { status: res.status, data, etag: res.headers.get("etag") };
}

/* ---------------- local fallback ---------------- */
let local;
const localFile = () => path.join(path.resolve(process.env.DATA_DIR || "./data"), "localdb.json");
function tree() {
  if (!local) {
    try {
      local = JSON.parse(fs.readFileSync(localFile(), "utf8"));
    } catch {
      local = {};
    }
  }
  return local;
}
function persistLocal() {
  const f = localFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f + ".tmp", JSON.stringify(local));
  fs.renameSync(f + ".tmp", f); // atomic
}
function localGet(p) {
  let n = tree();
  for (const s of segs(p)) {
    if (n === null || typeof n !== "object" || !(s in n)) return null;
    n = n[s];
  }
  return n === undefined ? null : structuredClone(n);
}
function localSet(p, value) {
  const parts = segs(p);
  if (!parts.length) {
    local = value && typeof value === "object" ? structuredClone(value) : {};
    return persistLocal();
  }
  let n = tree();
  for (const s of parts.slice(0, -1)) {
    if (n[s] === null || typeof n[s] !== "object") {
      if (value === null || value === undefined) return;
      n[s] = {};
    }
    n = n[s];
  }
  const last = parts.at(-1);
  if (value === null || value === undefined) delete n[last];
  else n[last] = structuredClone(value);
  persistLocal();
}

/* ---------------- public API ---------------- */
// Arrays that are empty and objects with no keys are stored as "nothing" (same as Firebase).
export async function get(p, { limitToLast } = {}) {
  if (!remote()) {
    const v = localGet(p);
    if (limitToLast && v && typeof v === "object") {
      const keys = Object.keys(v).sort().slice(-limitToLast);
      return Object.fromEntries(keys.map((k) => [k, v[k]]));
    }
    return v;
  }
  const query = limitToLast ? { orderBy: '"$key"', limitToLast: String(limitToLast) } : {};
  return (await rtdb("GET", p, { query })).data;
}

export async function set(p, value) {
  if (!remote()) return localSet(p, value);
  if (value === null || value === undefined) await rtdb("DELETE", p);
  else await rtdb("PUT", p, { body: value });
}

export async function update(p, obj) {
  if (!remote()) {
    for (const [k, v] of Object.entries(obj)) localSet(`${p}/${k}`, v);
    return;
  }
  await rtdb("PATCH", p, { body: obj });
}

export const remove = (p) => set(p, null);

// Write `value` only if nothing is stored there yet. Returns true if this call wrote it.
export async function claim(p, value) {
  if (!remote()) {
    if (localGet(p) !== null) return false;
    localSet(p, value);
    return true;
  }
  const g = await rtdb("GET", p, { headers: { "X-Firebase-ETag": "true" } });
  if (g.data !== null) return false;
  const r = await rtdb("PUT", p, { body: value, headers: { "if-match": g.etag || "null_etag" } });
  return r.status !== 412;
}

// Test helper: forget cached config / local tree
export function _reset() {
  memo = undefined;
  local = undefined;
  tok = { v: null, exp: 0 };
}
