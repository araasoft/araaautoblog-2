// Firebase Authentication (email + password) for the dashboard, and the admin roles.
// The browser signs in with Firebase and sends its ID token; this file checks that token
// (RS256 signature against Google's public certificates) and looks up the user's role.
//
// Roles:  super   - exactly one: the very first account that signs up. Approves/removes admins.
//         admin   - approved by the super admin; can post, edit, delete, change settings.
//         pending - signed up but not approved yet; cannot use the API.
import crypto from "crypto";
import * as db from "./db.js";
import { httpError } from "./facebook.js";
import * as admins from "./admins.js";
import { ROLES } from "./roles.js";

export const enabled = () => Boolean(db.remote() && process.env.FIREBASE_WEB_API_KEY && db.projectId());

/* ---------------- ID token verification ---------------- */
const CERT_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
let certs = { exp: 0, keys: {} };

async function loadCerts() {
  if (Date.now() < certs.exp) return certs.keys;
  const res = await fetch(CERT_URL, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw httpError(503, "Could not load Google sign-in certificates");
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get("cache-control") || "")?.[1]) || 3600;
  certs = { exp: Date.now() + maxAge * 1000, keys: await res.json() };
  return certs.keys;
}

const unauthorized = (m = "Session expired - sign in again") => httpError(401, m);

export async function verifyIdToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) throw unauthorized();
  let header, payload;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  } catch {
    throw unauthorized();
  }
  if (header.alg !== "RS256" || !header.kid) throw unauthorized();

  let pem = (await loadCerts())[header.kid];
  if (!pem) {
    certs.exp = 0; // Google rotated keys: refetch once
    pem = (await loadCerts())[header.kid];
  }
  if (!pem) throw unauthorized();

  let ok = false;
  try {
    ok = crypto.verify(
      "RSA-SHA256",
      Buffer.from(`${parts[0]}.${parts[1]}`),
      new crypto.X509Certificate(pem).publicKey,
      Buffer.from(parts[2], "base64url"),
    );
  } catch {
    ok = false;
  }
  if (!ok) throw unauthorized();

  const now = Math.floor(Date.now() / 1000);
  const pid = db.projectId();
  if (
    payload.aud !== pid ||
    payload.iss !== `https://securetoken.google.com/${pid}` ||
    typeof payload.sub !== "string" ||
    !payload.sub ||
    !(payload.exp > now) ||
    payload.iat > now + 60
  )
    throw unauthorized();

  return { uid: payload.sub, email: payload.email || "", name: payload.name || "" };
}

/* ---------------- users and roles ---------------- */
const cache = new Map(); // uid -> { u, t }
const TTL = 30_000;
const cleanName = (n) => String(n || "").trim().replace(/\s+/g, " ").slice(0, 60);

export async function getUser(uid) {
  const hit = cache.get(uid);
  if (hit && Date.now() - hit.t < TTL) return hit.u;
  const u = await db.get(`users/${uid}`);
  cache.set(uid, { u, t: Date.now() });
  return u;
}

// Called right after sign-in. Only the FIRST account ever (the super admin) can create its own profile here.
// Everyone else is created by the super admin from Users > Add admin; a Firebase account without a profile has no access.
export async function ensureUser(claims, input = {}) {
  const existing = await getUser(claims.uid);
  if (existing) return existing;
  if (await db.claim("meta/superAdminUid", claims.uid)) {
    /* first account: becomes super admin below */
  } else if ((await db.get("meta/superAdminUid")) !== claims.uid) {
    throw httpError(403, "No staff account for this email. Ask the super admin to create it.", { code: "no_profile" });
  }
  const user = await admins.firstProfile(claims, typeof input === "string" ? { name: input } : input);
  await db.set(`users/${claims.uid}`, user);
  await db.set(`emailIndex/${crypto.createHash("sha1").update(String(user.email).toLowerCase().trim()).digest("hex").slice(0, 20)}`, claims.uid);
  cache.set(claims.uid, { u: user, t: Date.now() });
  return user;
}

export async function listUsers() {
  const all = (await db.get("users")) || {};
  return Object.values(all).sort((a, b) => (a.role === "super" ? -1 : b.role === "super" ? 1 : (a.createdAt || 0) - (b.createdAt || 0)));
}

export async function superExists() {
  return Boolean(await db.get("meta/superAdminUid"));
}

// Only the super admin may do this. The super admin itself can never be changed, and no one else can become super.
export async function setRole(actor, uid, role) {
  if (actor.role !== "super") throw httpError(403, "Only the super admin can change admins");
  if (!admins_ok(role)) throw httpError(400, "Invalid position");
  const target = await db.get(`users/${uid}`);
  if (!target) throw httpError(404, "User not found");
  if (target.role === "super") throw httpError(400, "The super admin cannot be changed");
  await db.update(`users/${uid}`, { role, updatedAt: Date.now(), updatedBy: actor.uid });
  cache.delete(uid);
  return { ...target, role };
}

const admins_ok = (r) => r === "pending" || r === "admin" || (r !== "super" && Boolean(ROLES[r]));
export const dropCache = (uid) => cache.delete(uid);
export const _resetCache = () => {
  cache.clear();
  certs = { exp: 0, keys: {} };
};
