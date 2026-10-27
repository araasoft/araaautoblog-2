// Admin accounts: created by the super admin (EmpID, name, position, official email, password, photo, ...), profile editing
// with locked fields, and the "forgot password" check (email + date of birth). Passwords are NEVER stored by this app:
// Firebase Authentication keeps them (hashed). Photos are small data URLs (the browser shrinks them) - no Firebase Storage needed.
import crypto from "crypto";
import * as db from "./db.js";
import * as notify from "./notify.js";
import { httpError } from "./facebook.js";
import { ROLES, POSITIONS, normRole, can } from "./roles.js";

const KEY = () => process.env.FIREBASE_WEB_API_KEY;
const sha = (s) => crypto.createHash("sha1").update(String(s).toLowerCase().trim()).digest("hex").slice(0, 20);
const str = (v, n) => String(v ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, n);
const validEmail = (e) => /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$/.test(e);
export const DEFAULT_PHOTO = "logo.png"; // Araa Softwares logo is shown whenever there is no profile photo (never letters)

export function validDob(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v || "")) return false;
  const t = Date.parse(v + "T00:00:00Z");
  return Number.isFinite(t) && t < Date.now() - 14 * 365 * 864e5 && t > Date.parse("1900-01-01");
}
export function validPhoto(v) {
  return typeof v === "string" && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length <= 120_000;
}
export const strongPassword = (p) => typeof p === "string" && p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);

let seqLock = Promise.resolve();
export const nextEmpId = () => (seqLock = seqLock.then(async () => {
  const n = ((await db.get("meta/empSeq")) || 0) + 1;
  await db.set("meta/empSeq", n);
  return "ARAA-" + String(n).padStart(4, "0");
}));

// Views: the public list shows no private details; the owner and super admin see everything.
export const pub = (u) => ({ uid: u.uid, empId: u.empId || "", name: u.name, position: u.position || POSITIONS[normRole(u.role)] || "", role: normRole(u.role), email: u.email, department: u.department || "", photo: u.photo || "", createdAt: u.createdAt });
export const full = (u) => ({ ...pub(u), dob: u.dob || "", phone: u.phone || "", address: u.address || "", bio: u.bio || "", joinDate: u.joinDate || "", createdBy: u.createdBy || "" });

async function identity(endpoint, body) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/${endpoint}?key=${encodeURIComponent(KEY())}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw httpError(400, d.error?.message || "Firebase request failed");
  return d;
}

// First account ever (super admin): created from the sign-up screen, profile filled from the same form.
export async function firstProfile(claims, input = {}) {
  return { uid: claims.uid, empId: await nextEmpId(), email: claims.email, name: str(input.name, 60) || str(claims.name, 60) || claims.email.split("@")[0], role: "super", position: "Super admin",
    dob: validDob(input.dob) ? input.dob : "", phone: str(input.phone, 25), department: "Management", joinDate: new Date().toISOString().slice(0, 10), createdAt: Date.now(), createdBy: "setup" };
}

export async function create(actor, input = {}) {
  if (!can(actor.role, "users.manage")) throw httpError(403, "Only the super admin can create admin accounts");
  const email = str(input.email, 200).toLowerCase(), name = str(input.name, 60), role = String(input.role || "");
  if (name.length < 2) throw httpError(400, "Enter the full name");
  if (!validEmail(email)) throw httpError(400, "Enter a valid email");
  const dom = String(process.env.OFFICIAL_EMAIL_DOMAIN || "").toLowerCase().replace(/^@/, "");
  if (dom && !email.endsWith("@" + dom)) throw httpError(400, `Use the official Araa Softwares email (@${dom})`);
  if (!ROLES[role] || role === "super") throw httpError(400, "Choose a valid position");
  if (!validDob(input.dob)) throw httpError(400, "Enter a valid date of birth (needed for password recovery)");
  if (!strongPassword(input.password)) throw httpError(400, "Password needs 8+ characters with letters and numbers");
  if (input.photo && !validPhoto(input.photo)) throw httpError(400, "Photo must be a small JPG, PNG or WEBP");
  if (await db.get(`emailIndex/${sha(email)}`)) throw httpError(400, "That email already has an account");

  let acct;
  try { acct = await identity("accounts:signUp", { email, password: input.password, returnSecureToken: false }); }
  catch (e) { throw httpError(400, /EMAIL_EXISTS/.test(e.message) ? "That email already has a sign-in account" : /WEAK/.test(e.message) ? "Password is too weak" : e.message); }
  const user = { uid: acct.localId, empId: await nextEmpId(), name, email, role, position: str(input.position, 60) || POSITIONS[role], dob: input.dob, phone: str(input.phone, 25), address: str(input.address, 160),
    department: str(input.department, 60), joinDate: /^\d{4}-\d{2}-\d{2}$/.test(input.joinDate || "") ? input.joinDate : new Date().toISOString().slice(0, 10), ...(input.photo ? { photo: input.photo } : {}), createdAt: Date.now(), createdBy: actor.uid };
  await db.set(`users/${user.uid}`, user);
  await db.set(`emailIndex/${sha(email)}`, user.uid);
  notify.event("admin", { title: "New admin account", detail: `${user.name} (${user.empId}) - ${user.position}`, by: actor.name, mail: true }).catch(() => {});
  notify.sendMail({ to_email: email, subject: "Your Araa Softwares dashboard account", title: `Welcome, ${name}`, message: `Your account is ready.\nEmployee ID: ${user.empId}\nPosition: ${user.position}\nSign in with this email and the password the super admin gave you. You can change your photo and phone in My profile.`, post_url: process.env.PUBLIC_URL || "" }).catch(() => {});
  return user;
}

// Self edit: ONLY phone, address, bio, photo. Name, email, employee ID, position and role are locked.
export async function updateSelf(uid, patch = {}) {
  const u = await db.get(`users/${uid}`);
  if (!u) throw httpError(404, "Profile not found");
  const set = {};
  if (patch.phone !== undefined) set.phone = str(patch.phone, 25);
  if (patch.address !== undefined) set.address = str(patch.address, 160);
  if (patch.bio !== undefined) set.bio = str(patch.bio, 200);
  if (patch.photo !== undefined) {
    if (patch.photo === "" || patch.photo === null) set.photo = null; // back to the Araa logo
    else if (validPhoto(patch.photo)) set.photo = patch.photo;
    else throw httpError(400, "Photo must be a small JPG, PNG or WEBP");
  }
  for (const k of ["name", "email", "empId", "role", "position", "dob"]) if (patch[k] !== undefined && String(patch[k]) !== String(u[k] ?? "")) throw httpError(403, `${k === "empId" ? "Employee ID" : k === "dob" ? "Date of birth" : k[0].toUpperCase() + k.slice(1)} cannot be changed by you - ask the super admin`);
  await db.update(`users/${uid}`, { ...set, updatedAt: Date.now() });
  return { ...u, ...set };
}

// Super admin edit: name, position, role, department, phone, dob, address, photo. Email and EmpID never change.
export async function updateByAdmin(actor, uid, patch = {}) {
  if (!can(actor.role, "users.manage")) throw httpError(403, "Only the super admin can edit other accounts");
  const u = await db.get(`users/${uid}`);
  if (!u) throw httpError(404, "User not found");
  const set = {};
  if (patch.name !== undefined) { set.name = str(patch.name, 60); if (set.name.length < 2) throw httpError(400, "Enter the full name"); }
  if (patch.position !== undefined) set.position = str(patch.position, 60);
  if (patch.department !== undefined) set.department = str(patch.department, 60);
  if (patch.phone !== undefined) set.phone = str(patch.phone, 25);
  if (patch.address !== undefined) set.address = str(patch.address, 160);
  if (patch.dob !== undefined) { if (!validDob(patch.dob)) throw httpError(400, "Invalid date of birth"); set.dob = patch.dob; }
  if (patch.role !== undefined) {
    if (u.role === "super") throw httpError(400, "The super admin role cannot be changed");
    if (!(ROLES[patch.role] && patch.role !== "super") && patch.role !== "pending") throw httpError(400, "Invalid position");
    set.role = patch.role;
  }
  await db.update(`users/${uid}`, { ...set, updatedAt: Date.now(), updatedBy: actor.uid });
  return { ...u, ...set };
}

/* ---------------- forgot password: email + date of birth, then the reset email ---------------- */
const tries = new Map();
const limited = (k, max) => { const t = Date.now(), a = (tries.get(k) || []).filter((x) => t - x < 3600_000); a.push(t); tries.set(k, a); if (tries.size > 2000) tries.clear(); return a.length > max; };
const GENERIC = { ok: true, message: "If the email and date of birth match an account, a password reset email has been sent." };

export async function forgot({ email, dob, ip }) {
  email = str(email, 200).toLowerCase();
  if (limited("ip|" + ip, 10) || limited("em|" + email, 5)) throw httpError(429, "Too many attempts. Try again in an hour.");
  if (!validEmail(email) || !/^\d{4}-\d{2}-\d{2}$/.test(dob || "")) throw httpError(400, "Enter your email and date of birth");
  let uid = await db.get(`emailIndex/${sha(email)}`);
  if (!uid) uid = Object.values((await db.get("users")) || {}).find((u) => u.email?.toLowerCase() === email)?.uid; // accounts made before the index existed
  const u = uid ? await db.get(`users/${uid}`) : null;
  await new Promise((r) => setTimeout(r, 400 + Math.random() * 400)); // same timing whether or not the account exists
  if (!u || !u.dob || u.dob !== dob || normRole(u.role) === "pending") {
    if (u) notify.event("security", { title: "Password reset refused", detail: `Wrong date of birth for ${email}`, level: "warning" }).catch(() => {});
    return GENERIC;
  }
  await identity("accounts:sendOobCode", { requestType: "PASSWORD_RESET", email });
  notify.event("security", { title: "Password reset email sent", detail: `${u.name} (${u.empId || "no id"})`, mail: false }).catch(() => {});
  return GENERIC;
}
