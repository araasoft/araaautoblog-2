// Notifications: (1) in-app list (bell) saved in the database, (2) email through EmailJS to the admin addresses,
// (3) email to subscribers when a new post goes live. EmailJS free plan allows 200 mails/month, so a monthly cap is enforced.
// Needs on the server: EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PUBLIC_KEY, EMAILJS_PRIVATE_KEY
// and in EmailJS > Account > Security: "Allow EmailJS API for non-browser applications".
import crypto from "crypto";
import * as db from "./db.js";
import { getSettings } from "./store.js";
import { redact } from "./security.js";
import { httpError } from "./facebook.js";
import { onShutdown } from "./lifecycle.js";

const id = () =>
  String(Date.now()).padStart(13, "0") +
  "-" +
  crypto.randomBytes(2).toString("hex");
const month = () => new Date().toISOString().slice(0, 7);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s ?? "").replace(/[<>]/g, "");
const BASE = () =>
  (
    process.env.PUBLIC_URL ||
    process.env.LI_REDIRECT_URI?.replace(/\/linkedin\/callback$/, "") ||
    ""
  ).replace(/\/+$/, "");

export const mailConfigured = () =>
  Boolean(
    process.env.EMAILJS_SERVICE_ID &&
    process.env.EMAILJS_TEMPLATE_ID &&
    process.env.EMAILJS_PUBLIC_KEY,
  );

/* ---------------- EmailJS ---------------- */
async function monthCount() {
  return (await db.get(`stats/email/${month()}`))?.n || 0;
}
async function bumpMonth(n = 1) {
  await db.set(`stats/email/${month()}`, { n: (await monthCount()) + n });
}

// params: to_email, subject, title, message, post_url ... (template variables). Returns {ok} or {ok:false, error}.
export async function sendMail(params, { template } = {}) {
  if (!mailConfigured())
    return { ok: false, error: "EmailJS is not configured" };
  const cap = getSettings().emailMonthlyCap;
  if (cap > 0 && (await monthCount()) >= cap)
    return {
      ok: false,
      error: `Monthly email cap reached (${cap})`,
      capped: true,
    };
  try {
    const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        service_id: process.env.EMAILJS_SERVICE_ID,
        template_id: template || process.env.EMAILJS_TEMPLATE_ID,
        user_id: process.env.EMAILJS_PUBLIC_KEY,
        ...(process.env.EMAILJS_PRIVATE_KEY
          ? { accessToken: process.env.EMAILJS_PRIVATE_KEY }
          : {}),
        template_params: {
          from_name: "Araa Softwares",
          reply_to: "araasoftwares@gmail.com",
          ...params,
        },
      }),
    });
    const text = await res.text();
    if (!res.ok)
      return {
        ok: false,
        error: redact(`EmailJS ${res.status}: ${text}`).slice(0, 200),
      };
    await bumpMonth().catch(() => {});
    return { ok: true };
  } catch (e) {
    return { ok: false, error: redact(e.message) };
  }
}
async function sendToAdmins(subject, title, message, url) {
  const list = getSettings().notifyEmails;
  if (!list.length) return { ok: false, error: "No notification emails set" };
  const base = { subject, title, message, post_url: url || BASE() || "" };
  if (process.env.EMAILJS_SPLIT_RECIPIENTS === "1") {
    const rs = [];
    for (const to of list) {
      rs.push(await sendMail({ ...base, to_email: to }));
      await sleep(1100);
    }
    return rs.find((r) => !r.ok) || { ok: true };
  }
  return sendMail({ ...base, to_email: list.join(",") });
}

/* ---------------- in-app notifications ---------------- */
const LABEL = {
  create: "New post",
  edit: "Post edited",
  delete: "Post deleted",
  like: "New likes",
  comment: "New comments",
  share: "New shares",
  breaking: "Breaking news",
  security: "Security",
  ai: "AI",
  admin: "Admin",
  system: "System",
};
const MAIL_NOW = new Set([
  "create",
  "edit",
  "delete",
  "breaking",
  "security",
  "admin",
]);
let digest = []; // likes / comments / shares are grouped into one email every few minutes

export async function event(
  type,
  { title, detail = "", by = "System", url = "", level = "info", mail } = {},
) {
  const rec = {
    at: Date.now(),
    type,
    title: esc(title || LABEL[type] || type).slice(0, 120),
    detail: redact(esc(detail)).slice(0, 300),
    by: esc(by).slice(0, 60),
    url: url || "",
    level,
  };
  try {
    await db.set(`notifications/${id()}`, rec);
    if (Math.random() < 0.05) await prune();
  } catch (e) {
    console.error("[notify] save failed:", e.message);
  }
  const wantMail =
    mail ?? (MAIL_NOW.has(type) ? true : getSettings().notifyOnEngagement);
  if (wantMail) {
    if (MAIL_NOW.has(type))
      sendToAdmins(
        `[Araa] ${rec.title}`,
        rec.title,
        `${rec.detail}${by ? `\nBy: ${rec.by}` : ""}`,
        url,
      ).catch(() => {});
    else digest.push(rec);
  }
  return rec;
}
async function prune(keep = 300) {
  const all = (await db.get("notifications")) || {};
  const ids = Object.keys(all).sort();
  for (const k of ids.slice(0, Math.max(0, ids.length - keep)))
    await db.remove(`notifications/${k}`);
}
export async function flushDigest() {
  if (!digest.length) return { sent: 0 };
  const items = digest.splice(0);
  const body = items
    .map((r) => `- ${r.title}: ${r.detail}`)
    .join("\n")
    .slice(0, 1500);
  await sendToAdmins(
    `[Araa] ${items.length} new reaction${items.length > 1 ? "s" : ""} on your posts`,
    "Post engagement",
    body,
  );
  return { sent: items.length };
}
export async function list(limit = 40, since = 0) {
  const raw =
    (await db.get("notifications", { limitToLast: Math.min(limit, 100) })) ||
    {};
  return Object.entries(raw)
    .map(([k, r]) => ({ id: k, ...r }))
    .filter((r) => r.at > since)
    .sort((a, b) => b.at - a.at);
}
export async function unread(uid) {
  const last = (await db.get(`notifRead/${uid}`)) || 0;
  return { last, items: (await list(100)).filter((r) => r.at > last) };
}
export const markRead = (uid) => db.set(`notifRead/${uid}`, Date.now());

/* ---------------- subscribers ---------------- */
const h = (email) =>
  crypto
    .createHash("sha1")
    .update(String(email).toLowerCase())
    .digest("hex")
    .slice(0, 20);
const validEmail = (e) => /^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$/.test(e);
export async function subscribe(email, name = "", source = "web") {
  email = String(email || "")
    .trim()
    .toLowerCase();
  if (!validEmail(email)) throw httpError(400, "That email is not valid");
  const key = h(email),
    cur = await db.get(`subscribers/${key}`);
  if (cur?.active) return { ok: true, already: true };
  await db.set(`subscribers/${key}`, {
    email,
    name: esc(name).slice(0, 60),
    at: cur?.at || Date.now(),
    active: true,
    source,
    token: cur?.token || crypto.randomBytes(8).toString("hex"),
  });
  return { ok: true };
}
export async function unsubscribe(key, token) {
  const s = await db.get(`subscribers/${String(key).replace(/\W/g, "")}`);
  if (!s || s.token !== token)
    throw httpError(400, "This unsubscribe link is not valid");
  await db.update(`subscribers/${h(s.email)}`, {
    active: false,
    unsubscribedAt: Date.now(),
  });
  return { ok: true };
}
export async function listSubscribers() {
  return Object.entries((await db.get("subscribers")) || {})
    .map(([k, s]) => ({
      key: k,
      email: s.email,
      name: s.name,
      active: s.active !== false,
      at: s.at,
      source: s.source,
    }))
    .sort((a, b) => b.at - a.at);
}
export const removeSubscriber = (key) =>
  db.remove(`subscribers/${String(key).replace(/\W/g, "")}`);

let chain = Promise.resolve();
// Sends the new post to every active subscriber, one by one (EmailJS allows about 1 request per second). Runs in the background.
export function mailSubscribers(post) {
  if (!getSettings().mailSubscribers || !mailConfigured()) return;
  chain = chain
    .then(async () => {
      const subs = (await listSubscribers()).filter((s) => s.active);
      let sent = 0,
        failed = 0;
      for (const s of subs) {
        const full = await db.get(`subscribers/${s.key}`);
        const r = await sendMail({
          to_email: s.email,
          to_name: s.name || "there",
          subject: `New from Araa Softwares: ${String(post.text).split("\n")[0].slice(0, 70)}`,
          title: "New post from Araa Softwares",
          message: String(post.text || "").slice(0, 700),
          post_url: post.url || BASE(),
          unsubscribe_url: BASE()
            ? `${BASE()}/unsubscribe?k=${s.key}&t=${full?.token}`
            : "",
        });
        r.ok ? sent++ : failed++;
        if (r.capped) break;
        await sleep(1100);
      }
      if (subs.length)
        await event("system", {
          title: "Subscriber emails",
          detail: `${sent} sent, ${failed} failed (${subs.length} subscribers)`,
          mail: false,
        });
    })
    .catch((e) => console.error("[notify] subscriber mail failed:", e.message));
}

export async function status() {
  return {
    configured: mailConfigured(),
    privateKey: Boolean(process.env.EMAILJS_PRIVATE_KEY),
    month: await monthCount().catch(() => 0),
    cap: getSettings().emailMonthlyCap,
    recipients: getSettings().notifyEmails,
    subscribers: (await listSubscribers().catch(() => [])).filter(
      (s) => s.active,
    ).length,
  };
}
export const test = () =>
  sendToAdmins(
    "[Araa] Test email",
    "Test email",
    "EmailJS is working. You will receive post and engagement alerts here.",
  );

let timer;
export function start() {
  timer = setInterval(() => flushDigest().catch(() => {}), 15 * 60_000);
  onShutdown(() => {
    clearInterval(timer);
    return flushDigest().catch(() => {});
  });
}
