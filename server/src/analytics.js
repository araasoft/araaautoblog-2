// Analytics: collects views / reach / likes / comments / shares for every post made here (Facebook insights + LinkedIn company
// page statistics), learns WHICH HOURS, DAYS, HASHTAGS and KEYWORDS perform best, and feeds that back into posting.
// No AI is used here (pure maths), so it costs no AI tokens. Also watches likes/comments/shares and raises notifications.
import * as db from "./db.js";
import * as fb from "./facebook.js";
import * as li from "./linkedin.js";
import * as records from "./records.js";
import * as notify from "./notify.js";
import * as mem from "./aimemory.js";
import { getSettings } from "./store.js";
import { onShutdown } from "./lifecycle.js";

const STOP = new Set("this that with from your have will what when where which their about into more than they them then also just like been being were over only some very most make made much many such each other our you and the for are but not can all any how why who its has had was out use using get got one two new now".split(" "));
const FOOTER = /^\s*(📞|🌐|✉️|WhatsApp|http)/i;

export const score = (m = {}) => (m.views || 0) + 20 * (m.likes || 0) + 40 * (m.comments || 0) + 60 * (m.shares || 0);
export const hashtagsOf = (t) => [...new Set((String(t).match(/#[\p{L}\p{N}_]{2,40}/gu) || []).map((x) => x.toLowerCase()))];
export function keywordsOf(t) {
  const body = String(t).split("\n").filter((l) => !FOOTER.test(l)).join(" ").replace(/#[\p{L}\p{N}_]+/gu, " ").toLowerCase();
  return [...new Set((body.match(/[a-z][a-z-]{3,}/g) || []).filter((w) => !STOP.has(w)))];
}
const hourOf = (at, off) => new Date(at + off * 60000).getUTCHours();
const dowOf = (at, off) => new Date(at + off * 60000).getUTCDay();

// rows: [{at, text, score, ...}] -> insights. Pure function (tested without network).
export function computeInsights(rows, offMin = 180) {
  const used = rows.filter((r) => r.score > 0 || r.measured);
  const agg = (keyFn, minN) => {
    const m = new Map();
    for (const r of used) for (const k of keyFn(r)) { const x = m.get(k) || { sum: 0, n: 0 }; x.sum += r.score; x.n++; m.set(k, x); }
    return [...m].map(([k, x]) => ({ k, avg: Math.round(x.sum / x.n), n: x.n })).filter((x) => x.n >= minN).sort((a, b) => b.avg * Math.log(1 + b.n) - a.avg * Math.log(1 + a.n));
  };
  const minN = used.length >= 12 ? 2 : 1;
  const hours = agg((r) => [hourOf(r.at, offMin)], 1).slice(0, 6).map((x) => ({ hour: x.k, avg: x.avg, n: x.n }));
  const days = agg((r) => [dowOf(r.at, offMin)], 1).slice(0, 7).map((x) => ({ day: x.k, avg: x.avg, n: x.n }));
  return {
    at: Date.now(), posts: rows.length, measured: used.length, ready: used.length >= 8, // below 8 measured posts the data is too thin to steer posting
    bestHours: hours, bestDays: days,
    topHashtags: agg((r) => hashtagsOf(r.text), minN).slice(0, 12).map((x) => ({ tag: x.k, avg: x.avg, n: x.n })),
    topKeywords: agg((r) => keywordsOf(r.text), minN).slice(0, 15).map((x) => ({ word: x.k, avg: x.avg, n: x.n })),
  };
}
export async function preferredHours(s = getSettings()) {
  if (!s.useBestTimes) return undefined;
  const i = await db.get("analytics/insights").catch(() => null);
  return i?.ready && i.bestHours?.length ? i.bestHours.map((h) => h.hour) : undefined;
}

let running = false;
// Refreshes numbers for recent posts. Young posts (< 3 days) every run; older ones once a day. Max 25 posts per run.
export async function collect({ force = false } = {}) {
  if (running) return { skipped: true };
  running = true;
  const s = getSettings(), st = { lastRun: Date.now(), updated: 0, fbError: "", liError: "" };
  try {
    const recs = (await records.list(50)).filter((r) => r.createdAt > Date.now() - 45 * 864e5);
    const old = (await db.get("analytics/posts")) || {};
    const due = recs.filter((r) => force || !old[r.id]?.updatedAt || Date.now() - old[r.id].updatedAt > (Date.now() - r.createdAt < 3 * 864e5 ? 50 * 60e3 : 24 * 3600e3)).slice(0, 25);
    const liUrns = due.map((r) => r.targets?.linkedin_company?.postId).filter(Boolean);
    let liStats = {};
    if (liUrns.length) { try { liStats = await li.shareStats(liUrns); } catch (e) { st.liError = e.message.slice(0, 160); } }
    for (const r of due) {
      const row = { at: r.createdAt, text: r.text, author: r.author?.name || "", source: r.source || "", hour: hourOf(r.createdAt, s.utcOffsetMinutes), updatedAt: Date.now(), measured: old[r.id]?.measured || false };
      const f = r.targets?.facebook;
      if (f?.postId && !(f.scheduledAt && f.scheduledAt > Date.now())) {
        try {
          const [ins, cnt] = await Promise.all([fb.getInsights(f.postId), fb.getCounts(f.postId)]);
          row.fb = { ...cnt, views: ins.views, reach: ins.reach };
          if (ins.viewsError) st.fbError = ins.viewsError.slice(0, 160);
          row.measured = true;
        } catch (e) { st.fbError = e.message.slice(0, 160); row.fb = old[r.id]?.fb; }
      }
      const l = liStats[r.targets?.linkedin_company?.postId];
      if (l) { row.li = l; row.measured = true; }
      row.score = score({ views: (row.fb?.views || 0) + (row.li?.views || 0), likes: (row.fb?.likes || 0) + (row.li?.likes || 0), comments: (row.fb?.comments || 0) + (row.li?.comments || 0), shares: (row.fb?.shares || 0) + (row.li?.shares || 0) });
      await db.set(`analytics/posts/${r.id}`, row);
      old[r.id] = row; st.updated++;
    }
    const rows = Object.values(old);
    const ins = computeInsights(rows, s.utcOffsetMinutes);
    await db.set("analytics/insights", ins);
    st.insightsReady = ins.ready;
    await mem.note("analytics", `Updated ${st.updated} posts; ${ins.measured} measured; best hours ${ins.bestHours.slice(0, 3).map((h) => h.hour + ":00").join(", ") || "n/a"}${st.fbError ? "; FB: " + st.fbError : ""}`, st.fbError || st.liError ? "warn" : "ok");
    await db.set("analytics/status", st);
    return { ...st, insights: ins };
  } catch (e) {
    await mem.note("analytics", e.message, "error");
    throw e;
  } finally { running = false; }
}

export async function summary() {
  const [ins, posts, status] = await Promise.all([db.get("analytics/insights"), db.get("analytics/posts"), db.get("analytics/status")]);
  const rows = Object.entries(posts || {}).map(([id, p]) => ({ id, ...p })).sort((a, b) => b.at - a.at);
  const tot = { fb: { posts: 0, views: 0, reach: 0, likes: 0, comments: 0, shares: 0 }, li: { posts: 0, views: 0, reach: 0, likes: 0, comments: 0, shares: 0 } };
  for (const r of rows) for (const k of ["fb", "li"]) if (r[k]) { tot[k].posts++; for (const f of ["views", "reach", "likes", "comments", "shares"]) tot[k][f] += r[k][f] || 0; }
  return { insights: ins, status, totals: tot, top: rows.slice().sort((a, b) => b.score - a.score).slice(0, 8), recent: rows.slice(0, 12) };
}

/* ---------------- engagement watcher: likes / comments / shares -> notifications ---------------- */
export async function watch() {
  const s = getSettings();
  if (!s.notifyOnEngagement || !process.env.FB_PAGE_ID) return { checked: 0 };
  const recs = (await records.list(15)).filter((r) => r.targets?.facebook?.postId && r.createdAt > Date.now() - 7 * 864e5 && !(r.targets.facebook.scheduledAt > Date.now()));
  let changed = 0;
  for (const r of recs) {
    const pid = r.targets.facebook.postId, key = `engagement/${pid.replace(/\W/g, "_")}`;
    try {
      const now = await fb.getCounts(pid), prev = await db.get(key);
      await db.set(key, { ...now, at: Date.now() });
      if (!prev) continue; // first look: remember only
      const title = String(r.text || "").split("\n")[0].slice(0, 60), url = r.targets.facebook.url;
      if (now.likes > prev.likes) { changed++; await notify.event("like", { title: `+${now.likes - prev.likes} like${now.likes - prev.likes > 1 ? "s" : ""} (${now.likes} total)`, detail: title, url }); }
      if (now.comments > prev.comments) { changed++; const c = await fb.latestComment(pid).catch(() => null); await notify.event("comment", { title: `+${now.comments - prev.comments} comment${now.comments - prev.comments > 1 ? "s" : ""}`, detail: `${c ? `${c.by}: ${c.text} — ` : ""}${title}`, url }); }
      if (now.shares > prev.shares) { changed++; await notify.event("share", { title: `+${now.shares - prev.shares} share${now.shares - prev.shares > 1 ? "s" : ""}`, detail: title, url }); }
    } catch { /* one post failing never stops the others */ }
  }
  return { checked: recs.length, changed };
}

let t1, t2;
export function start() {
  const run = async () => { try { await collect(); } catch { /* logged in AI history */ } };
  const loop = () => { const iv = Math.max(15, getSettings().analyticsIntervalMin) * 60_000; t1 = setTimeout(async () => { await run(); loop(); }, iv); };
  setTimeout(run, 60_000); loop();
  t2 = setInterval(() => watch().catch(() => {}), 8 * 60_000);
  setTimeout(() => watch().catch(() => {}), 90_000);
  onShutdown(() => { clearTimeout(t1); clearInterval(t2); });
}
