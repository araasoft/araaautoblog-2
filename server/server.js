import * as research from "./src/research.js";
import * as usage from "./src/usage.js";
import * as alerts from "./src/alerts.js";
import { redact, securityHeaders, rateLimit, requireRole, validateConfig, toCsv } from "./src/security.js";
import { shutdown } from "./src/lifecycle.js";
import { migrate } from "./src/migrate.js";
import * as researchRun from "./src/research-run.js";
const runOnce = researchRun.runOnce;
import "dotenv/config";
import crypto from "crypto";
import path from "path";
import express from "express";
import { fileURLToPath } from "url";
import * as fb from "./src/facebook.js";
import * as li from "./src/linkedin.js";
import * as ai from "./src/ai.js";
import * as auto from "./src/automation.js";
import * as db from "./src/db.js";
import * as auth from "./src/auth.js";
import * as records from "./src/records.js";
import * as store from "./src/store.js";
import * as news from "./src/news.js";
import * as lg from "./src/log.js";
import * as agent from "./src/agent.js";
import * as admins from "./src/admins.js";
import * as notify from "./src/notify.js";
import * as analytics from "./src/analytics.js";
import * as breaking from "./src/breaking.js";
import * as marketing from "./src/marketing.js";
import * as aiclient from "./src/aiclient.js";
import { need, can, isStaff, normRole, permList, ROLES, isReadOnly, guestGuard } from "./src/roles.js";
import { cors } from "./src/cors.js";
import { getSettings, saveSettings, getState, getDrafts } from "./src/store.js";

const { httpError } = fb;
const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(securityHeaders);
app.use(cors()); // ORIGINS allow-list, answers preflight before any auth
app.use(express.json({ limit: "15mb" }));

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Public: health check (for uptime pingers) and the dashboard page itself
app.get("/health", (req, res) => res.json({ ok: true }));
app.use(express.static(path.join(__dirname, "public")));

// LinkedIn redirects here after you approve access (state token proves the request came from the dashboard)
const page = (msg, ok) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LinkedIn</title>` +
  `<body style="font-family:system-ui;max-width:420px;margin:60px auto;padding:0 16px"><h2>${ok ? "LinkedIn connected" : "LinkedIn not connected"}</h2>` +
  `<p>${String(msg).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])}</p><p><a href="/">Back to dashboard</a></p></body>`;
app.get("/linkedin/callback", async (req, res) => {
  try {
    if (req.query.error) throw httpError(400, req.query.error_description || req.query.error);
    await li.handleCallback({ code: req.query.code, state: req.query.state });
    res.send(page("You can close this tab and return to the dashboard.", true));
  } catch (e) {
    res.status(e.status || 500).send(page(e.message, false));
  }
});

// Public: subscribe / unsubscribe (email list used for new-post emails) and the forgot-password check (email + date of birth).
const pubLimit = rateLimit({ max: 12, windowMs: 3600_000, key: (r) => "pub|" + r.ip });
app.post("/subscribe", pubLimit, wrap(async (req) => notify.subscribe(req.body?.email, req.body?.name, "web")));
const plain = (title, msg) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="font-family:system-ui;max-width:420px;margin:60px auto;padding:0 16px"><img src="/logo.png" width="48" alt=""><h2>${title}</h2><p>${String(msg).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])}</p></body>`;
app.get("/unsubscribe", pubLimit, async (req, res) => {
  try { await notify.unsubscribe(req.query.k, req.query.t); res.send(plain("Unsubscribed", "You will not get more emails from Araa Softwares.")); }
  catch (e) { res.status(400).send(plain("Could not unsubscribe", e.message)); }
});
app.post("/auth/forgot", wrap(async (req) => admins.forgot({ email: req.body?.email, dob: req.body?.dob, ip: req.ip })));

// Tells the dashboard how to sign in. The Firebase web API key is public by design.
app.get("/auth-config", async (req, res) => {
  res.set("Cache-Control", "no-store");
  if (!auth.enabled()) return res.json({ firebase: false });
  let firstUser = false;
  try {
    firstUser = !(await auth.superExists());
  } catch {
    /* ignore: only a hint for the sign-up screen */
  }
  res.json({ firebase: true, apiKey: process.env.FIREBASE_WEB_API_KEY, firstUser });
});

// ---- Sign-in protection ----
// Firebase mode: every /api call needs a valid Firebase ID token AND an approved role (admin or super).
// Old mode (Firebase not configured): the shared API_KEY, with a simple brute-force limit.
const fails = new Map();
const digest = (s) => crypto.createHash("sha256").update(String(s)).digest();
const LEGACY_USER = { uid: "legacy", name: "Admin", email: "", role: "super" };

function legacyAuth(req, res, next) {
  if (!process.env.API_KEY) return res.status(500).json({ error: "API_KEY is not set on the server" });
  const ip = req.ip;
  const f = fails.get(ip);
  if (f && f.n >= 10 && Date.now() - f.t < 15 * 60_000)
    return res.status(429).json({ error: "Too many wrong attempts. Try again in 15 minutes." });
  if (!crypto.timingSafeEqual(digest(req.get("x-api-key") || ""), digest(process.env.API_KEY))) {
    fails.set(ip, { n: (f && Date.now() - f.t < 15 * 60_000 ? f.n : 0) + 1, t: Date.now() });
    return res.status(401).json({ error: "Unauthorized" });
  }
  fails.delete(ip);
  req.user = LEGACY_USER;
  next();
}

app.use("/api", async (req, res, next) => {
  if (!auth.enabled()) return res.status(503).json({ error: "Firebase sign-in is not set up on the server (set FIREBASE_WEB_API_KEY and the other FIREBASE_* values)" });
  try {
    const m = /^Bearer (.+)$/.exec(req.get("authorization") || "");
    if (!m) return res.status(401).json({ error: "Please sign in" });
    req.claims = await auth.verifyIdToken(m[1]);
    if (req.method === "POST" && req.path === "/session") return next(); // creates the profile, allowed before approval
    const user = await auth.getUser(req.claims.uid);
    if (!user) return res.status(403).json({ error: "Account not set up - sign in again", code: "no_profile" });
    if (!isStaff(user.role))
      return res.status(403).json({ error: "Waiting for the super admin to approve your account", code: "pending" });
    req.user = user;
    guestGuard(req, res, next); // guest = read-only, limited endpoints
  } catch (e) {
    res.status(e.status === 401 ? 401 : 503).json({ error: e.status === 401 ? e.message : "Sign-in service unavailable: " + e.message });
  }
});

// Rate limits (per IP+user, in-memory): general API, and a stricter one for sensitive/expensive actions.
const SENSITIVE = /^\/(settings|publish|auto\/|research\/|drafts\/.+\/approve|export|admins|linkedin|ai\/|agent|breaking|mail|analytics\/refresh)/;
const general = rateLimit({ max: 300 }), guestLimit = rateLimit({ max: 60, key: (r) => "g|" + r.ip + "|" + (r.claims?.uid || "") }), strict = rateLimit({ max: 30, key: (r) => "s|" + r.ip + "|" + (r.claims?.uid || "") });
app.use("/api", (req, res, next) => (isReadOnly(req.user?.role) ? guestLimit(req, res, next) : req.method !== "GET" && SENSITIVE.test(req.path) ? strict(req, res, next) : general(req, res, next)));

function wrap(fn) { return async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (e) {
    res.status(e.status && e.status < 600 ? e.status : 500).json({
      error: redact(e.message),
      code: e.code,
      fbtrace_id: e.fbtrace_id,
    });
  }
}; }

// ---- Who am I / admins ----
const publicUser = (u) => admins.pub(u);
const authorOf = (u) => ({ uid: u.uid, name: u.name, email: u.email });
const meView = (u) => ({ ...admins.full(u), perms: permList(u.role), defaultPhoto: admins.DEFAULT_PHOTO });

app.post("/api/session", wrap(async (req) => {
  if (!auth.enabled()) return { mode: "legacy", user: publicUser(req.user) };
  const user = await auth.ensureUser(req.claims, { name: req.body?.name, dob: req.body?.dob, phone: req.body?.phone });
  return { mode: "firebase", user: meView(user) };
}));
app.get("/api/me", wrap((req) => meView(req.user)));
app.put("/api/profile", wrap(async (req) => { const u = await admins.updateSelf(req.user.uid, req.body || {}); auth.dropCache(req.user.uid); lg.record("settings", "Profile updated", req.user); return meView(u); }));
app.get("/api/admins", need("users.view"), wrap(async (req) => {
  const all = await auth.listUsers(), sup = can(req.user.role, "users.manage");
  const visible = sup ? all : all.filter((u) => isStaff(u.role));
  return { me: req.user.uid, users: visible.map((u) => (sup || u.uid === req.user.uid ? { ...admins.full(u), role: u.role === "pending" ? "pending" : normRole(u.role) } : publicUser(u))), roles: Object.fromEntries(Object.entries(ROLES).filter(([k]) => k !== "super").map(([k, v]) => [k, v.label])) };
}));
app.post("/api/admins", need("users.manage"), wrap(async (req) => { const u = await admins.create(req.user, req.body || {}); lg.record("settings", `Admin account created: ${u.name} (${u.empId})`, req.user); return admins.full(u); }));
app.put("/api/admins/:uid", need("users.manage"), wrap(async (req) => {
  const uid = String(req.params.uid).replace(/[^\w-]/g, "");
  const u = await admins.updateByAdmin(req.user, uid, req.body || {}); auth.dropCache(uid);
  lg.record("settings", `Admin updated: ${u.name}${req.body?.role ? " -> " + req.body.role : ""}`, req.user);
  notify.event("admin", { title: "Admin account changed", detail: `${u.name}${req.body?.role ? " is now " + req.body.role : ""}`, by: req.user.name, mail: Boolean(req.body?.role) }).catch(() => {});
  return admins.full(u);
}));

// ---- Status / settings ----
let fbCache = { t: 0, v: null };
app.get("/api/status", wrap(async (req) => {
  if (Date.now() - fbCache.t > 60_000) fbCache = { t: Date.now(), v: await fb.checkConnection() };
  if (isReadOnly(req.user?.role)) {
    const st = getSettings(), pl = getState();
    return { facebook: fbCache.v, linkedin: await li.checkConnection(), ...ai.status(), settings: { enabled: st.enabled, paused: st.paused }, plan: { jobs: [], lastOk: pl.lastOk }, drafts: [], serverTime: Date.now() };
  }
  return {
    facebook: fbCache.v,
    linkedin: await li.checkConnection(),
    ...ai.status(),
    settings: getSettings(),
    plan: getState(),
    drafts: getDrafts(),
    serverTime: Date.now(),
  };
}));
app.get("/api/settings", wrap(() => getSettings()));
app.put("/api/settings", (req, res, next) => (Object.keys(req.body || {}).every((k) => k === "brand") ? need("brand.edit", "settings.edit") : need("settings.edit"))(req, res, next), wrap((req) => {
  const before = getSettings();
  const next = saveSettings({ ...before, ...req.body });
  if (before.paused !== next.paused && next.paused) alerts.raise("stop", "critical", "Emergency stop switched ON by " + (req.user?.name || "admin"), { cooldownMs: 0 });
  if (before.facebookEnabled !== next.facebookEnabled && !next.facebookEnabled) alerts.raise("fbpause", "warning", "Facebook automation paused", { cooldownMs: 0 });
  if (before.paused !== next.paused) lg.record("stop", next.paused ? "EMERGENCY STOP switched ON" : "Automation resumed", req.user);
  else lg.record("settings", "Settings changed", req.user);
  return next;
}));

// ---- LinkedIn connection ----
app.post("/api/linkedin/connect", need("settings.edit"), wrap(() => li.connectUrl()));
app.post("/api/linkedin/disconnect", need("settings.edit"), wrap(() => li.disconnect()));

// ---- Manual publish: text only, image only, or text + image (upload / URL / AI image) ----
// targets: any of "facebook", "linkedin_personal", "linkedin_company" (default: facebook only)
const TARGETS = ["facebook", "linkedin_personal", "linkedin_company"];
app.post("/api/publish", need("post.create"), wrap(async (req) => {
  const { message = "", link, imageUrl, imageData, scheduleAt } = req.body;
  const targets = Array.isArray(req.body.targets) && req.body.targets.length ? req.body.targets : ["facebook"];
  if (!targets.every((t) => TARGETS.includes(t))) throw httpError(400, "Unknown target");
  const liTargets = targets.filter((t) => t.startsWith("linkedin_")).map((t) => t.slice(9));
  if (scheduleAt && liTargets.length)
    throw httpError(400, "LinkedIn posts cannot be scheduled here - untick LinkedIn or clear the schedule time");

  const text = String(message).trim();
  let image = null;
  if (imageData) {
    const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,/.exec(imageData);
    if (!m) throw httpError(400, "Unsupported image type (use JPG, PNG, WEBP or GIF)");
    image = { mime: m[1], buffer: Buffer.from(imageData.slice(m[0].length), "base64") };
    if (image.buffer.length > 10 * 1024 * 1024) throw httpError(400, "Image is larger than 10 MB");
  }
  if (imageUrl && !/^https?:\/\//i.test(imageUrl)) throw httpError(400, "Image URL must start with http:// or https://");
  if (!text && !image && !imageUrl && !link) throw httpError(400, "Add some text or an image");

  const results = {};
  const jobs = [];
  if (targets.includes("facebook")) {
    jobs.push(
      (async () => {
        try {
          const r =
            image || imageUrl
              ? await fb.createPhotoPost({ imageUrl, imageBuffer: image?.buffer, mime: image?.mime, caption: text, scheduleAt })
              : await fb.createPost({ message: text, link, scheduleAt });
          results.facebook = { ok: true, ...r };
        } catch (e) {
          results.facebook = { ok: false, error: e.message };
        }
      })(),
    );
  }
  if (liTargets.length) {
    jobs.push(
      (async () => {
        try {
          const imageBuffer = image?.buffer || (imageUrl ? await ai.downloadImage(imageUrl) : undefined);
          const r = await li.postMany(liTargets, { text, imageBuffer, link: imageBuffer ? undefined : link });
          for (const [k, v] of Object.entries(r)) results["linkedin_" + k] = v;
        } catch (e) {
          for (const t of liTargets) results["linkedin_" + t] = { ok: false, error: e.message };
        }
      })(),
    );
  }
  await Promise.all(jobs);

  // Remember the post (author + where it went) so it can be edited / deleted per platform later.
  let id, trackError;
  try {
    const rec = await records.track({
      text, author: authorOf(req.user), source: "manual", imageUrl, hasImage: Boolean(image || imageUrl), results, scheduledAt: scheduleAt,
    });
    id = rec?.id;
    lg.record("publish", `Manual post: ${Object.entries(results).map(([k, v]) => k + (v.ok ? " ok" : " failed")).join(", ")}`, req.user);
  } catch (e) {
    trackError = e.message;
    console.error("could not save post record:", e.message);
  }
  return { results, id, trackError };
}));

// ---- AI helpers for manual mode ----
app.post("/api/ai/draft", need("ai.use"), wrap(async (req) => {
  const d = await ai.draftPost({ topic: req.body?.topic });
  return { ...d, text: ai.composeText(d) };
}));
app.post("/api/ai/image", need("ai.use"), wrap(async (req) => {
  const keyword = String(req.body?.keyword || "").trim() || "technology";
  const img = await ai.findImage(keyword);
  return { imageUrl: img.url, credit: img.credit };
}));

// ---- Posts made here (author, per-platform status) ----
app.get("/api/records", wrap((req) => records.list(Math.min(Number(req.query.limit) || 20, 50))));
app.put("/api/records/:id", wrap(async (req) => {
  if (!can(req.user.role, "post.edit") && !(can(req.user.role, "post.edit.own") && (await records.owner(req.params.id)) === req.user.uid)) throw httpError(403, "You can only edit your own posts");
  return records.edit(req.params.id, { text: req.body?.message, targets: req.body?.targets, by: req.user });
}));
app.delete("/api/records/:id", need("post.delete"), wrap((req) =>
  records.remove(req.params.id, { targets: String(req.query.targets || "").split(",").filter(Boolean), by: req.user })));

// ---- Older posts on the Facebook Page (not made here) ----
app.get("/api/posts", wrap((req) => fb.listPosts(Number(req.query.limit) || 10)));
app.get("/api/scheduled", wrap((req) => fb.listScheduled(Number(req.query.limit) || 10)));
app.put("/api/posts/:id", need("post.edit"), wrap((req) => {
  if (!req.body.message) throw httpError(400, "message is required");
  return fb.updatePost(req.params.id, req.body.message);
}));
app.delete("/api/posts/:id", need("post.delete"), wrap((req) => fb.deletePost(req.params.id)));

// ---- Engagement on Facebook posts: likes, shares, comments, replies ----
const fbId = (v) => { if (!/^[\w.-]{3,80}$/.test(String(v))) throw httpError(400, "Bad id"); return String(v); };
app.get("/api/engagement/:id", wrap((req) => fb.getEngagement(fbId(req.params.id))));
app.post("/api/comments/:id/reply", need("engage.reply"), wrap((req) => {
  const m = String(req.body?.message || "").trim();
  if (!m) throw httpError(400, "Write a reply first");
  return fb.replyToComment(fbId(req.params.id), m);
}));
app.post("/api/comments/:id/like", need("engage.reply"), wrap((req) => fb.likeComment(fbId(req.params.id))));

// ---- News tracking, daily analysis, marketing agent ----
app.get("/api/news", need("news.view"), wrap((req) => news.getNews({ force: req.query.refresh === "1" })));
app.post("/api/news/brief", need("ai.use"), wrap(async (req) => { const b = await news.makeBrief(); lg.record("news", "Daily news analysis created", req.user); return b; }));
app.post("/api/news/seen", wrap((req) => news.markSeen(Array.isArray(req.body?.ids) ? req.body.ids.slice(0, 100) : [])));
app.post("/api/agent", need("ai.use"), wrap((req) => agent.run(req.body || {})));

// ---- Automation controls ----
app.post("/api/auto/run-now", need("automation.control"), wrap((req) => auto.runNow(req.body?.type, authorOf(req.user))));
app.post("/api/auto/replan", need("automation.control"), wrap(() => auto.replan()));
app.post("/api/auto/cancel", need("automation.control"), wrap((req) => { const r = auto.cancelPending(); lg.record("settings", `Cancelled ${r.cancelled} pending posts`, req.user); return r; }));
app.get("/api/activity", need("activity.view"), wrap(async () => {
  const s = getSettings();
  const [logs, usage, counts, rs] = await Promise.all([lg.recent(60), lg.usageSummary(), auto.postCounts(), research.stats().catch(() => null)]);
  return { logs, usage, counts, research: rs, paused: s.paused, facebookEnabled: s.facebookEnabled, limits: { daily: s.dailyLimit, weekly: s.weeklyLimit } };
}));
app.get("/api/research", wrap(async () => ({ stats: await research.stats(), records: (await research.listRecords(50)).map((r) => ({ id: r.id, title: r.sourceTitle, url: r.url, publisher: r.publisher, status: r.processingStatus, verification: r.verification?.status || null, quality: r.qualityScore, duplicate: r.duplicate?.reason || null, error: r.error, at: r.retrievedAt })) })));
app.post("/api/research/run", need("automation.control"), wrap(() => runOnce()));
app.post("/api/research/:id/cancel", need("automation.control"), wrap((req) => { if (!/^[0-9a-f-]{36}$/.test(req.params.id)) throw httpError(400, "Bad id"); return research.cancelItem(req.params.id, req.user); }));
app.get("/api/integrity", requireRole("super"), wrap(() => research.integrityReport()));
app.get("/api/alerts", wrap(() => alerts.list(50)));
app.post("/api/alerts/:id/ack", wrap(async (req) => (await alerts.acknowledge(String(req.params.id).replace(/[^\w-]/g, ""))) || { ok: false }));
// ---- Activity: paginated/filterable logs, AI cost analytics, CSV export ----
const ts = (v) => { const n = Date.parse(v); return Number.isFinite(n) ? n : undefined; };
const logOpts = (q) => ({ q: q.q, type: /^[a-z]{2,20}$/.test(q.type || "") ? q.type : undefined, level: ["info", "warning", "error"].includes(q.level) ? q.level : undefined, from: ts(q.from), to: ts(q.to) && ts(q.to) + 864e5 - 1, sort: q.sort === "asc" ? "asc" : "desc", page: q.page, pageSize: q.pageSize });
app.get("/api/activity/logs", need("activity.view"), wrap((req) => lg.query(logOpts(req.query))));
app.get("/api/ai-usage", need("activity.view"), wrap(async (req) => {
  const from = ts(req.query.from) || Date.now() - 30 * 864e5, to = (ts(req.query.to) || Date.now()) + (req.query.to ? 864e5 - 1 : 0);
  let rows = await usage.ledger({ from, to });
  for (const k of ["provider", "model", "task"]) if (req.query[k]) rows = rows.filter((r) => r[k] === String(req.query[k]));
  const sum = usage.summarize(rows), rs = await research.stats();
  const taskCost = (t) => rows.filter((r) => r.task === t).reduce((a, r) => a + (r.cost || 0), 0), total = rows.reduce((a, r) => a + (r.cost || 0), 0);
  const eligible = rs.queued + rs.published, pr = usage.loadPricing();
  return { ...sum, from, to, currency: pr.currency, pricingVersion: pr.version, note: "Costs are ESTIMATES from pricing.json unless costKind is 'reported'. Not an invoice.",
    avgCostPerDraft: rs.drafts ? +(taskCost("draft") / rs.drafts).toFixed(6) : null, avgCostPerPublished: rs.published ? +(total / rs.published).toFixed(6) : null,
    costPerEligibleResearchItem: eligible ? +(total / eligible).toFixed(6) : null, researchToPublicationRate: rs.discovered ? +(rs.published / rs.discovered).toFixed(4) : null };
}));
app.get("/api/export/:kind(activity|ai-usage).csv", need("export"), async (req, res) => {
  try {
    let body;
    if (req.params.kind === "activity") body = await lg.exportCsv(logOpts(req.query));
    else {
      const rows = (await usage.ledger({ from: ts(req.query.from) || 0, to: Date.now() })).slice(0, 5000).map((r) => ({ time: new Date(r.at).toISOString(), provider: r.provider, model: r.model, task: r.task, status: r.status, inputTokens: r.usage?.inputTokens, outputTokens: r.usage?.outputTokens, cost: r.cost, costKind: r.costKind, currency: r.currency, pricingVersion: r.pricingVersion, errorClass: r.errorClass, refId: r.refId }));
      body = toCsv(["time", "provider", "model", "task", "status", "inputTokens", "outputTokens", "cost", "costKind", "currency", "pricingVersion", "errorClass", "refId"], rows);
    }
    lg.record("export", `Exported ${req.params.kind} CSV`, req.user);
    res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="araaposts-${req.params.kind}-${new Date().toISOString().slice(0, 10)}.csv"` }).send(body);
  } catch (e) { res.status(500).json({ error: redact(e.message) }); }
});
app.get("/api/drafts", wrap(() => getDrafts()));
app.post("/api/drafts/:id/approve", need("draft.approve"), wrap(async (req) => { const r = await auto.approveDraft(req.params.id, req.body, authorOf(req.user)); lg.record("draft", "Draft approved and published", req.user); return r; }));
app.delete("/api/drafts/:id", need("draft.approve"), wrap((req) => { lg.record("draft", "Draft rejected", req.user); return auto.rejectDraft(req.params.id); }));

// ---- Analytics (views, reach, likes, best hours, hashtags, keywords) ----
app.get("/api/analytics", need("analytics.view"), wrap(() => analytics.summary()));
app.post("/api/analytics/refresh", need("analytics.refresh"), wrap(async (req) => { const r = await analytics.collect({ force: true }); lg.record("news", "Analytics refreshed", req.user); const { insights, ...rest } = r; return rest; }));

// ---- Marketing AI: autopilot, strategy, workflow history, provider health, breaking news ----
const mk = need("marketing.run", "marketing.run.seo");
app.get("/api/ai/overview", need("analytics.view"), wrap(() => marketing.overview()));
app.post("/api/ai/cycle", mk, wrap(async (req) => { lg.record("settings", "Marketing AI cycle started by hand", req.user); return marketing.cycle({ reason: "manual", forceStrategy: Boolean(req.body?.strategy) }); }));
app.post("/api/ai/health/reset", need("settings.edit"), wrap(() => { aiclient.resetHealth(); return { ok: true }; }));
app.post("/api/breaking/scan", need("automation.control"), wrap((req) => breaking.scan({ dryRun: req.body?.dryRun !== false })));

// ---- Notifications (bell) ----
app.get("/api/notifications", wrap(async (req) => { const u = await notify.unread(req.user.uid); return { items: (await notify.list(40)).map((r) => ({ ...r, unread: r.at > u.last })), unread: u.items.length }; }));
app.post("/api/notifications/read", wrap(async (req) => { await notify.markRead(req.user.uid); return { ok: true }; }));

// ---- Email (EmailJS) and subscribers ----
app.get("/api/mail/status", need("mail.manage"), wrap(() => notify.status()));
app.post("/api/mail/test", need("mail.manage"), wrap(async () => { const r = await notify.test(); if (!r.ok) throw httpError(400, r.error); return r; }));
app.get("/api/mail/subscribers", need("mail.manage"), wrap(async () => ({ items: await notify.listSubscribers() })));
app.post("/api/mail/subscribers", need("mail.manage"), wrap(async (req) => {
  const list = String(req.body?.emails || "").split(/[\s,;]+/).filter(Boolean).slice(0, 500); let added = 0, bad = 0;
  for (const e of list) { try { const r = await notify.subscribe(e, "", "admin"); if (!r.already) added++; } catch { bad++; } }
  return { added, invalid: bad };
}));
app.delete("/api/mail/subscribers/:key", need("mail.manage"), wrap(async (req) => { await notify.removeSubscriber(req.params.key); return { ok: true }; }));

// JSON errors for bad/oversized bodies
app.use((err, req, res, next) => {
  const status = err.status || 500;
  res.status(status).json({ error: status === 413 ? "Image too large" : status >= 500 ? "Server error" : redact(err.message) });
});

process.on("unhandledRejection", (e) => console.error("Unhandled rejection:", e));

const cfgCheck = validateConfig();
for (const w of cfgCheck.warnings) console.warn("[config] " + w);
if (cfgCheck.errors.length) { for (const e of cfgCheck.errors) console.error("[config] ERROR: " + e); process.exit(1); }
const port = process.env.PORT || 3000;
for (const p of db.problems()) console.warn("[firebase] " + p);
try {
  await store.init(); // load settings/plan/drafts from the database before anything runs
  const m = await migrate(); if (m.applied.length) console.log("[migrate] applied:", m.applied.join(", "));
} catch (e) {
  console.error("Could not load data from the database:", e.message);
  process.exit(1);
}
const server = app.listen(port, () => {
  console.log(`AraaPosts running on port ${port}`);
  console.log(db.remote() ? "Data: Firebase Realtime Database" : "Data: local file (set FIREBASE_* to use Firebase)");
  console.log(auth.enabled() ? "Sign-in: Firebase Authentication" : "Sign-in: shared API_KEY (set FIREBASE_WEB_API_KEY to use accounts)");
  auto.start();
  notify.start();
  analytics.start();
  breaking.start();
  marketing.start();
  news.start();
  researchRun.start();
});

for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => shutdown(sig).then(() => server.close()));
