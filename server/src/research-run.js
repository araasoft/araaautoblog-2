// Live wiring for research.js: discovery via news.js, evidence fetch, AI claim extraction/drafting.
// Starts a background loop; never publishes (the scheduler consumes the queue).
import * as news from "./news.js";
import * as ai from "./ai.js";
import * as lg from "./log.js";
import * as db from "./db.js";
import { getSettings, getDrafts, getHistory } from "./store.js";
import * as R from "./research.js";
import * as alerts from "./alerts.js";
import * as usage from "./usage.js";
import { isShuttingDown, track, onShutdown } from "./lifecycle.js";

const strip = (h) => h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&amp;/g, " ").replace(/\s+/g, " ").trim();
const meta = (h, n) => new RegExp(`<meta[^>]+(?:property|name)=["']${n}["'][^>]*content=["']([^"']+)`, "i").exec(h)?.[1] || "";

const UA = "AraaPosts-Research/1.0";
const robotsCache = new Map(), pageCache = new Map(), lastHit = new Map();
const err = (m, o = {}) => Object.assign(new Error(m), o);
// Minimal robots.txt check ("User-agent: *" Disallow prefixes). Unreachable robots.txt = allowed (standard practice); 4xx = allowed.
export async function robotsAllows(url, fetcher = fetch) {
  const u = new URL(url), key = u.origin; let rules = robotsCache.get(key);
  if (!rules || Date.now() - rules.t > 3600e3) {
    rules = { t: Date.now(), dis: [] };
    try {
      const r = await fetcher(key + "/robots.txt", { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(8000) });
      if (r.ok) { let on = false; for (const line of (await r.text()).split(/\r?\n/)) { const m = /^\s*([a-z-]+)\s*:\s*(.*?)\s*(#.*)?$/i.exec(line); if (!m) continue; const k = m[1].toLowerCase(); if (k === "user-agent") on = m[2] === "*" || /araaposts/i.test(m[2]); else if (on && k === "disallow" && m[2]) rules.dis.push(m[2]); } }
    } catch { /* treat as allowed */ }
    robotsCache.set(key, rules);
  }
  return !rules.dis.some((d) => (u.pathname + u.search).startsWith(d));
}
// Google News RSS links wrap the publisher URL in a base64 token. Older tokens contain the URL; newer ones need Google's
// own resolver, which we do NOT call. Unresolvable links are reported, never guessed.
export function resolveGoogleNews(link) {
  let u; try { u = new URL(link); } catch { return null; }
  if (u.hostname !== "news.google.com") return link;
  const id = u.pathname.split("/").pop();
  try {
    const buf = Buffer.from(id.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("latin1");
    const m = /https?:\/\/[A-Za-z0-9\-._~:\/?#\[\]@!$&'()*+,;=%]+/.exec(buf);
    if (m) return m[0];
  } catch { /* fallthrough */ }
  return null;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function fetchEvidence(link) {
  const url = resolveGoogleNews(link);
  if (!url) throw err("could not resolve Google News redirect to the publisher URL", { permanent: true });
  const canon = R.canonicalUrl(url); if (!canon) throw err("unsafe or invalid URL", { permanent: true });
  const hit = pageCache.get(canon); if (hit && Date.now() - hit.t < 6 * 3600e3) return hit.v; // don't re-download the same page
  if (!(await robotsAllows(canon))) throw err("blocked by robots.txt", { permanent: true });
  const host = new URL(canon).host, wait = (lastHit.get(host) || 0) + 2000 - Date.now(); // >=2s between hits per host
  if (wait > 0) await sleep(wait); lastHit.set(host, Date.now());
  let res;
  try { res = await fetch(canon, { redirect: "follow", headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15_000) }); }
  catch (e) { throw err("source fetch failed: " + e.message); } // transient: network/timeout
  if (!res.ok) throw err(`source returned ${res.status}`, { status: res.status, permanent: res.status < 500 && res.status !== 429 && res.status !== 408 });
  const html = (await res.text()).slice(0, 400_000);
  const finalUrl = R.canonicalUrl(res.url);
  if (!finalUrl) throw err("redirected to an unsafe URL", { permanent: true });
  const title = strip(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || "");
  // Short factual extract only (title + description + start of body) - not a copy of the article.
  const text = [title, meta(html, "og:description") || meta(html, "description"), strip(html).slice(0, 500)].filter(Boolean).join(". ");
  const pub = Date.parse(meta(html, "article:published_time")) || null;
  const v = { url: finalUrl, title, publisher: meta(html, "og:site_name"), publishedAt: pub, text };
  pageCache.set(canon, { t: Date.now(), v });
  return v;
}
export const _caches = { robotsCache, pageCache, lastHit };

let batchItems = [];
export const deps = {
  // Other publishers covering the same story (title similarity), used for cross-source conflict checks.
  async relatedEvidence(rec) {
    const rel = batchItems.filter((n) => n.link && R.canonicalUrl(n.link) !== rec.url && n.source !== rec.publisher && R.jaccard(n.title, rec.sourceTitle) >= 0.5).slice(0, 2), out = [];
    for (const n of rel) { try { const e = await fetchEvidence(n.link); out.push({ ...e, publisher: e.publisher || n.source }); } catch { /* unavailable related source is not a contradiction */ } }
    return out;
  },
  fetchEvidence,
  async existing() {
    const recs = await R.listRecords(300);
    return [...recs.map((r) => ({ id: r.id, url: r.url, title: r.sourceTitle, text: r.draft?.text })),
      ...getDrafts().map((d) => ({ id: d.id, title: d.text?.slice(0, 80), text: d.text })),
      ...getHistory().map((t, i) => ({ id: "h" + i, title: t.slice(0, 80), text: t }))];
  },
  history: async () => getHistory(),
  async writeDraft(rec) {
    const d = await ai.draftPost({ history: getHistory(), topic: `${rec.sourceTitle}. Use ONLY these facts, no other numbers or claims: ${rec.evidence[0].text}` });
    return { text: ai.composeText(d) };
  },
  async extractClaims(text) {
    const raw = await ai.generateText(`List the factual claims in this post as JSON only: [{"text":"claim copied from post","important":true|false}]. Include every number/statistic/release/event as important.\n\nPOST:\n${text}`, 800, { task: "verification" });
    const arr = ai.parseJSON(raw);
    return (Array.isArray(arr) ? arr : arr.claims || []).slice(0, 12).map((c) => ({ text: String(c.text || ""), important: c.important !== false })).filter((c) => c.text);
  },
};

let running = false;
export function runOnce() { return track(runOnceInner()); }
async function runOnceInner() {
  if (running) return { skipped: "already running" };
  running = true;
  try {
    const s = getSettings();
    if (!s.researchEnabled) return { skipped: "research disabled" };
    const { items } = await news.getNews();
    batchItems = items;
    let queued = 0;
    for (const r of await R.retryDue()) { // transient failures retried with backoff, bounded attempts
      if (isShuttingDown()) break;
      await R.supersede(r.id);
      const x = await R.processCandidate({ title: r.sourceTitle, url: r.url, publisher: r.publisher, publishedAt: r.publishedAt, topic: r.topic, attempts: r.attempts, retryOf: r.id }, deps, getSettings());
      if (x.processingStatus === "QUEUED") queued++;
    }
    for (const n of items.slice(0, s.researchBatch)) {
      if (isShuttingDown()) break; // stop claiming new work during shutdown
      const r = await R.processCandidate({ title: n.title, url: n.link, publisher: n.source, publishedAt: n.at, topic: n.topic }, deps, getSettings());
      if (r.processingStatus === "QUEUED") queued++;
    }
    await db.set("app/researchRun", { at: Date.now(), ok: true, queued });
    return { queued };
  } catch (e) {
    await db.set("app/researchRun", { at: Date.now(), ok: false, error: String(e.message).slice(0, 200) }).catch(() => {});
    lg.record("error", `Research run failed: ${e.message}`);
    return { error: e.message };
  } finally { running = false; }
}

export function start() {
  const tick = async () => {
    const last = (await db.get("app/researchRun").catch(() => null))?.at || 0;
    if (Date.now() - last >= getSettings().researchIntervalMin * 60_000) await runOnce(); // survives restarts: interval measured from persisted last run
  };
  const watch = async () => alerts.evaluate({ research: await R.stats(), usageRows: await usage.ledger({ from: Date.now() - 30 * 864e5 }), settings: getSettings(), run: await db.get("app/researchRun") }).catch((e) => lg.record("error", "alert evaluation failed: " + e.message));
  const iv = setInterval(() => { if (!isShuttingDown()) { tick().catch((e) => lg.record("error", "research tick failed: " + e.message)); watch(); } }, 5 * 60_000);
  onShutdown(() => clearInterval(iv));
  tick().catch((e) => lg.record("error", "research tick failed: " + e.message));
}
