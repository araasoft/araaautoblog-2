import crypto from "crypto";
import * as fb from "./facebook.js";
import * as ai from "./ai.js";
import * as li from "./linkedin.js";
import * as records from "./records.js";
import * as news from "./news.js";
import * as db from "./db.js";
import * as lg from "./log.js";
import * as research from "./research.js";
import * as insights from "./analytics.js";
import { publishGate, isAmbiguous, reconcile } from "./gate.js";
import { isShuttingDown, track, onShutdown } from "./lifecycle.js";
import { planDay, dayKey } from "./planner.js";
import { getSettings, getState, saveState, getDrafts, saveDrafts, getHistory, pushHistory } from "./store.js";

const MIN = 60000;
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const AUTO = { author: { name: "Automation" }, source: "automation" };
const log = (...a) => console.log(new Date().toISOString(), "[auto]", ...a);
const newJob = (j) => ({ id: crypto.randomUUID(), at: j.at, type: j.type, status: "pending", attempts: 0 });

// Build what to post. type: "text" | "image" | "both"
async function buildContent(type) {
  if (type === "image") {
    const img = await ai.findImage(pick(ai.IMAGE_KEYWORDS));
    return { type, text: "", imageUrl: img.url };
  }
  let topic;
  if (getSettings().researchInAuto && type !== "image") {
    // Verified research items only; claimNext re-runs the final safety check (stop, Facebook pause, verification, quality).
    const r = await research.claimNext(getSettings());
    if (r) {
      const c = { type, text: r.draft.text, researchId: r.id };
      if (type === "text") return c;
      try { return { ...c, imageUrl: (await ai.findImage(pick(ai.IMAGE_KEYWORDS))).url }; } catch { return { ...c, type: "text" }; }
    }
  }
  if (getSettings().newsInAuto && Math.random() < 0.5) topic = await news.topicForPost().catch(() => undefined);
  const draft = await ai.draftPost({ history: getHistory(), topic });
  const text = ai.composeText(draft);
  if (type === "text") return { type, text };
  try {
    const img = await ai.findImage(draft.imageKeyword);
    return { type, text, imageUrl: img.url };
  } catch (e) {
    log("image failed, posting text only:", e.message);
    return { type: "text", text };
  }
}

export async function publishContent({ text, imageUrl, researchId }, by = AUTO) {
  const s = getSettings();
  if (by === AUTO) {
    // Final server-side gate, evaluated immediately before publishing (never trusts earlier checks).
    const g = publishGate({ settings: s, counts: await postCounts(s), item: undefined });
    if (!g.ok) throw Object.assign(fb.httpError(423, g.why), { gate: g.code });
  }
  if (researchId) {
    const b = await research.beginPublish(researchId, s, by === AUTO ? await postCounts(s) : undefined, by === AUTO ? "auto" : "manual");
    if (!b.ok) throw Object.assign(fb.httpError(423, b.why), { gate: b.code });
  }
  const fbOn = s.facebookEnabled !== false;
  const liTargets = [s.linkedinPersonal && "personal", s.linkedinCompany && "company"].filter(Boolean);
  if (!fbOn && !liTargets.length) throw fb.httpError(400, "All platforms are switched off in Automation settings");
  const buffer = imageUrl ? await ai.downloadImage(imageUrl) : undefined;
  let r = {};
  const sent = Date.now();
  if (fbOn) {
    try {
      r = buffer ? await fb.createPhotoPost({ imageBuffer: buffer, mime: "image/jpeg", caption: text }) : await fb.createPost({ message: text });
    } catch (e) {
      if (!isAmbiguous(e)) throw e;
      // The Page may have accepted the post. Check before anything can retry; never blindly re-send.
      let rec;
      try { rec = await reconcile(text, () => fb.listPosts(10), sent); } catch (e2) { throw Object.assign(new Error(`Publish outcome unknown (${e.message}); check the Page before retrying`), { ambiguous: true, status: 502 }); }
      if (!rec.published) throw Object.assign(new Error(`Publish failed, not found on the Page: ${e.message}`), { status: 502, notPublished: true });
      lg.record("publish", "Recovered ambiguous publish: post found on the Page", undefined, { status: "reconciled", refId: rec.postId });
      r = { id: rec.postId };
    }
  }
  if (text) pushHistory(text);
  // LinkedIn is best-effort: its errors are logged but never fail the job, so Facebook is not posted twice on retry.
  let linkedin;
  if (liTargets.length) {
    linkedin = await li.postMany(liTargets, { text, imageBuffer: buffer });
    for (const [t, v] of Object.entries(linkedin)) log(`linkedin ${t}:`, v.ok ? v.id : v.error);
  }
  // Remember the post (author, where it went) so it can be edited or deleted from the dashboard.
  try {
    const results = fbOn ? { facebook: { ok: true, ...r } } : {};
    for (const [t, v] of Object.entries(linkedin || {})) results["linkedin_" + t] = v;
    await records.track({ text, author: by.author, source: by.source, imageUrl, hasImage: Boolean(imageUrl), results });
  } catch (e) {
    log("could not save post record:", e.message);
  }
  if (researchId) await research.markPublished(researchId, true, r.post_id || r.id).catch((e) => lg.record("error", "research state update failed: " + e.message));
  return { postId: r.post_id || r.id, linkedin };
}

// ---- publishing limits (automation only) ----
export async function postCounts(s = getSettings(), now = Date.now()) {
  const raw = (await db.get("stats/posts", { limitToLast: 7 })) || {};
  const keys = new Set(Array.from({ length: 7 }, (_, i) => dayKey(now - i * 864e5, s.utcOffsetMinutes)));
  const today = raw[dayKey(now, s.utcOffsetMinutes)]?.n || 0;
  const week = Object.entries(raw).filter(([k]) => keys.has(k)).reduce((a, [, v]) => a + (v?.n || 0), 0);
  return { today, week };
}
async function limitHit(s, now) {
  const c = await postCounts(s, now);
  if (c.today >= s.dailyLimit) return `Daily limit reached (${s.dailyLimit})`;
  if (c.week >= s.weeklyLimit) return `Weekly limit reached (${s.weeklyLimit})`;
  return "";
}
async function bump(s, now) {
  const k = dayKey(now, s.utcOffsetMinutes);
  const cur = (await db.get(`stats/posts/${k}`))?.n || 0;
  await db.set(`stats/posts/${k}`, { n: cur + 1 });
}

export function cancelPending() {
  const st = getState();
  let n = 0;
  for (const j of st.jobs) if (j.status === "pending") { j.status = "cancelled"; n++; }
  saveState(st);
  return { cancelled: n };
}

async function executeJob(type, by = AUTO) {
  const content = await buildContent(type);
  if (getSettings().mode === "approval") {
    const drafts = getDrafts();
    drafts.push({ id: crypto.randomUUID(), createdAt: Date.now(), ...content });
    saveDrafts(drafts);
    if (content.researchId) await research.holdForApproval(content.researchId);
    return { queued: true };
  }
  try { return await publishContent(content, by); } catch (e) {
    // Outcome may be uncertain: never auto-reuse a research item whose publish failed.
    if (content.researchId && !e.gate) await research.markPublished(content.researchId, false, e.message, { ambiguous: Boolean(e.ambiguous) }).catch((x) => lg.record("error", "research state update failed: " + x.message));
    throw e;
  }
}

let busy = false;
export async function tick() {
  if (busy) return;
  busy = true;
  try {
    const s = getSettings();
    if (!s.enabled || s.paused || isShuttingDown()) return;
    const now = Date.now();
    let st = getState();
    const key = dayKey(now, s.utcOffsetMinutes);
    if (st.day !== key) {
      st = { day: key, jobs: planDay({ now, settings: s, preferredHours: await insights.preferredHours(s) }).map(newJob), lastOk: st.lastOk };
      saveState(st);
      log(`planned ${st.jobs.length} posts for ${key}:`, st.jobs.map((j) => new Date(j.at).toISOString()));
    }
    for (const job of st.jobs) {
      if (job.status !== "pending" || job.at > now) continue;
      if (now - job.at > 3 * 60 * MIN) {
        job.status = "missed"; // server was off for a long time; don't post a burst
        saveState(st);
        continue;
      }
      if (s.mode !== "approval") {
        const why = await limitHit(s, now);
        if (why) {
          job.status = "skipped";
          job.error = why;
          saveState(st);
          lg.record("skipped", `Scheduled post skipped: ${why}`);
          continue;
        }
      }
      job.status = "running";
      saveState(st);
      try {
        const r = await track(executeJob(job.type));
        job.status = r.queued ? "awaiting_approval" : "done";
        job.postId = r.postId;
        job.linkedin = r.linkedin;
        job.error = undefined;
        job.doneAt = st.lastOk = Date.now();
        if (!r.queued) await bump(s, now);
        lg.record("publish", r.queued ? `Automation created a ${job.type} draft` : `Automation published a ${job.type} post`);
        log(`${job.type} job ${job.status}`, r.postId || "");
      } catch (e) {
        job.attempts += 1;
        job.error = e.message;
        if (e.ambiguous || e.gate) { // uncertain outcome or safety block: never auto-retry
          job.status = e.gate ? "skipped" : "needs_review"; job.attempts = 99;
          lg.record(e.gate ? "skipped" : "error", `Automation ${job.type} post ${e.gate ? "blocked by gate" : "outcome unknown"}: ${e.message}`, undefined, { status: job.status, jobId: job.id, code: e.gate });
          saveState(st); continue;
        }
        lg.record("error", `Automation ${job.type} post failed (try ${job.attempts}): ${e.message}`);
        job.status = job.attempts >= 3 ? "failed" : "pending";
        if (job.status === "pending") job.at = Date.now() + 10 * MIN; // retry in 10 minutes
        log(`${job.type} job error (attempt ${job.attempts}):`, e.message);
      }
      saveState(st);
    }
  } catch (e) {
    log("tick error:", e.message);
  } finally {
    busy = false;
  }
}

export function start() {
  // A job left "running" by a crash may already be live on Facebook - never repeat it.
  const st = getState();
  let changed = false;
  for (const j of st.jobs) if (j.status === "running") { j.status = "missed"; changed = true; }
  if (changed) saveState(st);
  const iv = setInterval(tick, 30_000); onShutdown(() => clearInterval(iv));
  research.recoverStale().catch((e) => log("recover failed:", e.message));
  tick();
  log("scheduler started");
}

export async function replan() {
  const s = getSettings();
  const now = Date.now();
  const st = getState();
  const key = dayKey(now, s.utcOffsetMinutes);
  const kept = st.day === key ? st.jobs.filter((j) => j.status !== "pending") : [];
  const done = kept.filter((j) => j.status === "done" || j.status === "awaiting_approval").length;
  const jobs = planDay({ now, settings: s, alreadyDone: done, preferredHours: await insights.preferredHours(s) }).map(newJob);
  const next = { day: key, jobs: [...kept, ...jobs], lastOk: st.lastOk };
  saveState(next);
  return next;
}

// "Post one now" button (works even if automation is switched off)
export async function runNow(type, user) {
  if (getSettings().paused) throw fb.httpError(423, "Emergency stop is ON - resume automation first");
  const t = ["text", "image", "both"].includes(type) ? type : "both";
  return executeJob(t, user ? { author: user, source: "ai" } : AUTO);
}

export async function approveDraft(id, edits = {}, user) {
  const drafts = getDrafts();
  const d = drafts.find((x) => x.id === id);
  if (!d) throw fb.httpError(404, "Draft not found");
  const text = edits.text !== undefined ? String(edits.text) : d.text;
  if (!text.trim() && !d.imageUrl) throw fb.httpError(400, "Draft is empty");
  const r = await publishContent({ text, imageUrl: d.imageUrl, researchId: d.researchId }, user ? { author: user, source: "approved" } : AUTO);
  saveDrafts(drafts.filter((x) => x.id !== id));
  return r;
}

export function rejectDraft(id) {
  const d = getDrafts().find((x) => x.id === id);
  if (d?.researchId) research.cancelItem(d.researchId).catch(() => {});
  saveDrafts(getDrafts().filter((x) => x.id !== id));
  return { success: true };
}
