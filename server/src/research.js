// Phase 2 research agent: discovery (reuses news.js) -> store -> verify -> dedupe -> draft -> quality -> queue.
// It NEVER publishes. Eligible items go into a queue that the existing scheduler (automation.js) consumes,
// and the scheduler re-runs finalCheck() immediately before publishing.
import crypto from "crypto";
import * as db from "./db.js";
import * as lg from "./log.js";
import { publishGate } from "./gate.js";
import { isShuttingDown } from "./lifecycle.js";

export const CFG = {
  minRelevance: 40, minQuality: 70, maxAgeHours: 48, breakingHours: 6, titleSim: 0.7, textSim: 0.6,
  blockedHosts: /^(localhost|.*\.local|.*\.internal)$/i,
};
const sha = (s) => crypto.createHash("sha1").update(s).digest("hex");
const norm = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
const STOP = new Set("the a an and or of to in on for with is are was were be by at as it this that from".split(" "));
const toks = (s) => new Set(norm(s).split(" ").filter((w) => w.length > 2 && !STOP.has(w)));
export function jaccard(a, b) {
  const A = toks(a), B = toks(b);
  if (!A.size || !B.size) return 0;
  let i = 0; for (const w of A) if (B.has(w)) i++;
  return i / (A.size + B.size - i);
}

/* ---------- URLs ---------- */
const TRACK = /^(utm_|fbclid|gclid|mc_|ref$|ref_)/i;
export function canonicalUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || CFG.blockedHosts.test(u.hostname) || /^(\d+\.){3}\d+$/.test(u.hostname) || u.username || u.password) return null;
  u.hash = ""; u.hostname = u.hostname.replace(/^www\./, "");
  for (const k of [...u.searchParams.keys()]) if (TRACK.test(k)) u.searchParams.delete(k);
  u.searchParams.sort();
  return (u.protocol + "//" + u.host + u.pathname.replace(/\/+$/, "") + u.search).toLowerCase();
}

/* ---------- duplicates (no AI involved) ---------- */
// existing: [{url, title, text, hasNewEvidence?}] from research records, drafts, scheduled and published posts.
export function checkDuplicate(cand, existing) {
  const cu = canonicalUrl(cand.url), ct = norm(cand.title), ch = sha(norm(cand.text || cand.title));
  for (const e of existing) {
    const reason = cu && canonicalUrl(e.url) === cu ? "same canonical URL"
      : sha(norm(e.text || e.title)) === ch ? "identical normalized text"
      : jaccard(cand.title, e.title) >= CFG.titleSim ? "similar title"
      : cand.text && e.text && jaccard(cand.text, e.text) >= CFG.textSim ? "similar content" : "";
    if (!reason) continue;
    // A genuinely new development: same topic but different URL AND new facts (numbers) absent from the old item.
    const nums = (t) => new Set((String(t).match(/\d[\d.,%]*/g) || []));
    const fresh = [...nums(cand.text || cand.title)].filter((n) => !nums(e.text || e.title).has(n));
    if (reason !== "same canonical URL" && reason !== "identical normalized text" && fresh.length >= 2) return { duplicate: false, note: `new development (new figures: ${fresh.slice(0, 3)})`, matched: e.id };
    return { duplicate: true, reason, matched: e.id };
  }
  return { duplicate: false };
}

/* ---------- relevance / reliability scoring ---------- */
const PRIMARY = /(^|\.)(openai\.com|anthropic\.com|google\.com|microsoft\.com|github\.blog|github\.com|aws\.amazon\.com|cloudflare\.com|mozilla\.org|w3\.org|nist\.gov|cisa\.gov|developer\.mozilla\.org|nodejs\.org|vercel\.com|meta\.com)$/;
const REPUTABLE = /(reuters|apnews|bbc|theverge|techcrunch|arstechnica|wired|zdnet|infoq|bleepingcomputer|therecord|venturebeat)/i;
export function scoreSource({ url, publisher, publishedAt, title }, keywords = [], now = Date.now()) {
  const host = (canonicalUrl(url) ? new URL(canonicalUrl(url)).hostname : "");
  const reliability = PRIMARY.test(host) ? 100 : REPUTABLE.test(host + " " + (publisher || "")) ? 75 : 40;
  const ageH = publishedAt ? (now - publishedAt) / 36e5 : null;
  const recency = ageH == null ? 30 : ageH < 0 ? 0 : Math.max(0, 100 - ageH * 2);
  const t = toks(title);
  const hit = keywords.filter((k) => [...toks(k)].some((w) => t.has(w))).length;
  const relevance = Math.min(100, keywords.length ? Math.round((hit / Math.min(keywords.length, 3)) * 100) : 50);
  return { reliability, recency: Math.round(recency), relevance, primary: reliability === 100, ageHours: ageH };
}

/* ---------- claim verification (deterministic matching + cross-source conflict detection) ---------- */
// Text matching shows that evidence *mentions* a claim; it does not prove the claim true. Anything unmatched => NEEDS_REVIEW.
const numsOf = (s) => (String(s).match(/\d[\d.,]*%?/g) || []).map((n) => n.replace(/[.,]$/, ""));
function quantities(text) {
  const m = new Map();
  for (const [, n, u] of String(text).matchAll(/(\d[\d,.]*)\s*(%|[a-z]{3,})/gi)) {
    const k = u.toLowerCase(); if (STOP.has(k)) continue;
    if (!m.has(k)) m.set(k, new Set()); m.get(k).add(n.replace(/,/g, "").replace(/\.$/, ""));
  }
  return m;
}
// Same quantity unit, no shared value, between two sources about the same claim.
// Sources 7+ days apart are treated as a change over time, not a contradiction.
export function detectConflicts(claimText, evidence) {
  const rel = evidence.filter((e) => jaccard(claimText, e.text) >= 0.2), out = [];
  for (let i = 0; i < rel.length; i++) for (let j = i + 1; j < rel.length; j++) {
    const a = quantities(rel[i].text), b = quantities(rel[j].text);
    for (const [u, va] of a) {
      const vb = b.get(u); if (!vb || [...va].some((x) => vb.has(x))) continue;
      const gap = rel[i].publishedAt && rel[j].publishedAt ? Math.abs(rel[i].publishedAt - rel[j].publishedAt) / 864e5 : null;
      out.push({ unit: u, kind: gap != null && gap >= 7 ? "CHANGED_OVER_TIME" : "CONTRADICTION", sources: [rel[i], rel[j]].map((e, k) => ({ url: e.url, publisher: e.publisher || "", values: [...(k ? vb : va)] })) });
    }
  }
  return out;
}
const evRef = (e, now) => e && ({ url: e.url, title: e.title || "", publisher: e.publisher || "", publishedAt: e.publishedAt || null, retrievedAt: e.retrievedAt || now, excerpt: String(e.text).slice(0, 300) });
// claims: [{text, important}], evidence: [{url, title, publisher, publishedAt, primary, text}]
export function verifyClaims(claims, evidence, { now = Date.now(), publishedAt } = {}) {
  const out = claims.map((c) => {
    const best = evidence.map((e) => ({ e, sim: jaccard(c.text, e.text) })).sort((a, b) => b.sim - a.sim)[0];
    const supported = best && best.sim >= 0.3;
    const badNums = numsOf(c.text).filter((n) => !evidence.some((e) => e.text.includes(n)));
    const conflicts = detectConflicts(c.text, evidence);
    const hard = conflicts.filter((x) => x.kind === "CONTRADICTION");
    const status = hard.length ? "CONFLICTING_EVIDENCE" : badNums.length ? "REJECTED" : supported ? "VERIFIED" : c.important ? "NEEDS_REVIEW" : "PARTIALLY_VERIFIED";
    const reason = hard.length ? `sources disagree on "${hard[0].unit}" (${hard[0].sources.map((s) => s.values).join(" vs ")}); needs human review`
      : badNums.length ? `numbers not found in any evidence: ${badNums.join(", ")}` : supported ? `matched evidence (overlap ${best.sim.toFixed(2)})` : "no evidence matched; this is not evidence the claim is false";
    return { claim: c.text, important: !!c.important, status, method: "token-overlap+quantity-compare", reason, source: supported ? best.e.url : null, primary: !!(supported && best.e.primary),
      evidence: supported ? evRef(best.e, now) : null, unsupportedNumbers: badNums, conflicts };
  });
  const publishers = new Set(evidence.map((e) => e.publisher || e.url));
  const breaking = publishedAt && (now - publishedAt) / 36e5 < CFG.breakingHours;
  let status = out.some((c) => c.important && c.status === "CONFLICTING_EVIDENCE") ? "CONFLICTING_EVIDENCE"
    : out.some((c) => c.status === "REJECTED") ? "REJECTED"
    : out.some((c) => c.status === "CONFLICTING_EVIDENCE" || (c.important && c.status !== "VERIFIED")) || !out.length ? "NEEDS_REVIEW"
    : out.every((c) => c.status === "VERIFIED") ? "VERIFIED" : "PARTIALLY_VERIFIED";
  let note = "";
  if (status === "VERIFIED" && breaking && publishers.size < 2 && !out.every((c) => c.primary)) { status = "NEEDS_REVIEW"; note = "breaking news needs a primary source or 2+ publishers"; }
  return { status, claims: out, note };
}

/* ---------- content quality (mandatory checks override the score) ---------- */
const SENSATIONAL = /\b(shocking|you won'?t believe|guaranteed|100% (safe|secure)|revolutionary|game[- ]changer|destroys?|miracle)\b/i;
const CTA = /(contact|message us|visit|follow|learn more|reach out|\?|let us know|comment)/i;
export function qualityReport(draft, { brand = {}, history = [], verification, minQuality = CFG.minQuality } = {}) {
  const text = String(draft.text || ""), sc = {}, why = {}, mandatory = [];
  const sentences = text.split(/[.!?]+\s/).filter(Boolean);
  const avg = text.split(/\s+/).filter(Boolean).length / Math.max(1, sentences.length);
  sc.readability = avg <= 22 ? 100 : avg <= 30 ? 70 : 40; why.readability = `avg ${avg.toFixed(1)} words/sentence`;
  sc.length = text.length >= 200 && text.length <= 1500 ? 100 : 50; why.length = `${text.length} chars`;
  sc.tone = SENSATIONAL.test(text) ? 20 : 100; why.tone = SENSATIONAL.test(text) ? "sensational wording" : "neutral";
  const letters = text.replace(/[^A-Za-z]/g, ""); const caps = letters ? letters.replace(/[^A-Z]/g, "").length / letters.length : 0;
  if (caps > 0.35) sc.tone = Math.min(sc.tone, 30);
  sc.cta = CTA.test(text) ? 100 : 40; why.cta = CTA.test(text) ? "has call to action" : "no call to action";
  const promo = (text.match(/\b(buy|discount|offer|best|#1|leading|we are the)\b/gi) || []).length;
  sc.promotionalBalance = promo <= 2 ? 100 : promo <= 4 ? 60 : 30; why.promotionalBalance = `${promo} promotional terms`;
  const maxSim = Math.max(0, ...history.map((h) => jaccard(text, h)));
  sc.originality = maxSim < 0.4 ? 100 : maxSim < 0.6 ? 60 : 20; why.originality = `max similarity to recent posts ${maxSim.toFixed(2)}`;
  const tags = (text.match(/#\w+/g) || []).length;
  sc.platformFormat = tags <= 6 && !/https?:\/\/\S{200,}/.test(text) ? 100 : 50; why.platformFormat = `${tags} hashtags`;
  const avoid = String(brand.avoid || "").split(/[,;\n]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const hit = avoid.filter((a) => text.toLowerCase().includes(a));
  sc.brandConsistency = hit.length ? 0 : 100; why.brandConsistency = hit.length ? `mentions: ${hit.join(", ")}` : "ok";
  if (hit.length) mandatory.push("brand: mentions a forbidden topic");
  if (!verification || verification.status !== "VERIFIED") mandatory.push(`facts: verification is ${verification?.status || "missing"}`);
  if (/\b(api[_-]?key|password|secret|token)\b\s*[:=]/i.test(text)) mandatory.push("security: looks like a credential");
  if (text.length > 3000 || !text.trim()) mandatory.push("format: empty or too long");
  const unsupportedNums = numsOf(text).filter((n) => n.length > 1 && verification && !verification.claims.some((c) => c.claim.includes(n)));
  if (unsupportedNums.length) mandatory.push(`facts: numbers not in verified claims (${unsupportedNums.slice(0, 3)})`);
  const overall = Math.round(Object.values(sc).reduce((a, b) => a + b, 0) / Object.keys(sc).length);
  return { scores: sc, explanations: why, overall, mandatoryFailures: mandatory, passed: !mandatory.length && overall >= minQuality };
}

/* ---------- states, validation, storage ---------- */
// Lifecycle: NEW -> (verified+quality ok) QUEUED -> CLAIMED -> PUBLISHING -> PUBLISHED. Everything else is a terminal or review state.
export const TRANSITIONS = {
  NEW: ["QUEUED", "REJECTED", "DUPLICATE", "SOURCE_UNAVAILABLE", "FAILED", "NEEDS_REVIEW", "QUALITY_REJECTED", "BLOCKED"],
  QUEUED: ["CLAIMED", "CANCELLED", "REJECTED"],
  CLAIMED: ["PUBLISHING", "CANCELLED", "NEEDS_REVIEW", "FAILED"],
  PUBLISHING: ["PUBLISHED", "FAILED", "NEEDS_REVIEW"],
  SOURCE_UNAVAILABLE: ["SUPERSEDED", "DEAD"], FAILED: ["SUPERSEDED", "DEAD"],
  NEEDS_REVIEW: ["CANCELLED"], BLOCKED: ["CANCELLED"],
  REJECTED: [], DUPLICATE: [], QUALITY_REJECTED: [], PUBLISHED: [], CANCELLED: [], SUPERSEDED: [], DEAD: [],
};
export const STATES = Object.keys(TRANSITIONS);
export function validateRecord(r) {
  const e = [];
  if (!r || typeof r !== "object") return ["not an object"];
  if (!/^[0-9a-f-]{36}$/.test(r.id || "")) e.push("bad id");
  if (typeof r.sourceTitle !== "string") e.push("missing sourceTitle");
  if (!STATES.includes(r.processingStatus)) e.push("bad processingStatus " + r.processingStatus);
  if (!Number.isFinite(r.retrievedAt)) e.push("bad retrievedAt");
  if (["QUEUED", "CLAIMED", "PUBLISHING", "PUBLISHED"].includes(r.processingStatus)) {
    if (r.verification?.status !== "VERIFIED") e.push("queued/published without VERIFIED verification");
    if (!r.quality?.passed) e.push("queued/published without passing quality");
    if (!r.draft?.text) e.push("no draft text");
  }
  return e;
}
export function setStatus(rec, to, detail, now = Date.now()) {
  const from = rec.processingStatus;
  if (!(TRANSITIONS[from] || []).includes(to)) throw Object.assign(new Error(`illegal transition ${from} -> ${to}`), { code: "bad_transition" });
  rec.processingStatus = to; rec.updatedAt = now;
  (rec.history ||= []).push({ at: now, from, to, detail: detail ? String(detail).slice(0, 160) : undefined });
  if (rec.history.length > 30) rec.history.splice(0, rec.history.length - 30);
  return rec;
}
const save = async (r) => { const bad = validateRecord(r); if (bad.length) throw new Error("invalid research record: " + bad.join("; ")); await db.set(`research/${r.id}`, r); };
export const listRecords = async (limit = 100) => Object.values((await db.get("research", { limitToLast: limit })) || {}).filter((r) => r && typeof r === "object").sort((a, b) => b.retrievedAt - a.retrievedAt);
export const getRecord = (id) => db.get(`research/${id}`);

export async function integrityReport() {
  const raw = (await db.get("research")) || {}, problems = [];
  for (const [k, r] of Object.entries(raw)) { const e = validateRecord(r); if (r?.id && r.id !== k) e.push("key/id mismatch"); if (e.length) problems.push({ key: k, problems: e }); }
  return { checked: Object.keys(raw).length, corrupted: problems.length, problems: problems.slice(0, 50) };
}

// Final gate, called immediately before a queue item is used (and again by the scheduler before publishing).
export function finalCheck(rec, settings, now = Date.now()) {
  if (!rec) return "research item not found";
  if (settings.paused) return "emergency stop is ON";
  if (settings.facebookEnabled === false) return "Facebook automation is paused";
  if (rec.processingStatus !== "QUEUED") return `status is ${rec.processingStatus}`;
  if (rec.verification?.status !== "VERIFIED") return "claims not verified";
  if (!rec.quality?.passed) return "quality check not passed";
  if (!rec.draft?.text) return "no draft text";
  if (rec.publishedAt && (now - rec.publishedAt) / 36e5 > CFG.maxAgeHours) return "source too old";
  return "";
}

export const LOCK_TTL_MS = 15 * 60_000;
// Restart/abandonment recovery. A CLAIMED/PUBLISHING item whose worker vanished may already be live on the platform,
// so it goes to NEEDS_REVIEW and is NEVER republished automatically.
export async function recoverStale(now = Date.now(), ttl = LOCK_TTL_MS) {
  let n = 0;
  for (const r of await listRecords(300)) {
    if (r.awaitingApproval || !["CLAIMED", "PUBLISHING"].includes(r.processingStatus) || now - (r.claimedAt || r.updatedAt || 0) < ttl) continue;
    setStatus(r, "NEEDS_REVIEW", "abandoned lock; publish outcome unknown", now); r.error = "abandoned lock recovered; verify on the Page before any manual action";
    await save(r); lg.record("research", `Recovered abandoned item ${r.id} -> NEEDS_REVIEW`); n++;
  }
  return n;
}

let queueLock = Promise.resolve();
// Take the next eligible item (in-process atomic via a promise chain; single-instance only - see docs).
export function claimNext(settings, now = Date.now()) {
  const run = queueLock.then(async () => {
    if (isShuttingDown() || settings.paused || settings.facebookEnabled === false) return null; // pauses/shutdown leave the queue untouched
    await recoverStale(now);
    for (const r of await listRecords(200)) {
      if (r.processingStatus !== "QUEUED") continue;
      const why = finalCheck(r, settings, now);
      if (why) { setStatus(r, "REJECTED", "final check: " + why, now); r.error = "final check: " + why; await save(r); lg.record("research", `Research ${r.id} dropped at final check: ${why}`); continue; }
      setStatus(r, "CLAIMED", "scheduler", now); r.claimedAt = now; await save(r);
      return r;
    }
    return null;
  });
  queueLock = run.catch(() => {});
  return run;
}
const withRecord = (id, fn) => { const run = queueLock.then(async () => { const r = await getRecord(id); if (!r) throw new Error("research item not found"); const x = await fn(r); await save(r); return x; }); queueLock = run.catch(() => {}); return run; };
// Last check before the network call. Moves CLAIMED -> PUBLISHING (persisted) so a crash leaves a visible marker.
export const beginPublish = (id, settings, counts, source = "auto") => withRecord(id, (r) => {
  if (r.processingStatus !== "CLAIMED") return { ok: false, code: "already_done", why: `Item is ${r.processingStatus}` }; // cancelled/published/publishing/recovered: never publish
  const g = publishGate({ settings, counts, source, item: r });
  if (!g.ok) { setStatus(r, "NEEDS_REVIEW", "gate: " + g.why); r.error = g.why; return g; }
  setStatus(r, "PUBLISHING"); r.awaitingApproval = false; r.claimedAt = Date.now(); return { ok: true };
});
export const holdForApproval = (id) => withRecord(id, (r) => { r.awaitingApproval = true; }); // approval mode: draft waits for a human
export const markPublished = (id, ok, detail, { ambiguous = false } = {}) => withRecord(id, (r) => {
  if (r.processingStatus === "CANCELLED") return;
  if (ok) { setStatus(r, "PUBLISHED"); r.publishedOn = Date.now(); r.postId = detail || r.postId; }
  else { setStatus(r, ambiguous ? "NEEDS_REVIEW" : "FAILED", detail); r.error = String(detail).slice(0, 200); } // never auto-retried
});
export const cancelItem = (id, by) => withRecord(id, (r) => { setStatus(r, "CANCELLED", "cancelled by " + (by?.name || "system")); lg.record("cancel", `Research item ${id} cancelled`, by); return { cancelled: true }; });

/* ---------- pipeline ---------- */
const backoff = (attempts, rnd = Math.random) => Math.round(Math.min(6 * 3600e3, 15 * 60e3 * 2 ** attempts) * (0.75 + rnd() * 0.5));
export const MAX_ATTEMPTS = 3;
// deps (injectable for tests): existing(), fetchEvidence(url), relatedEvidence?(rec), extractClaims(text), writeDraft(rec), history()
export async function processCandidate(c, deps, settings, now = Date.now()) {
  const rec = { id: crypto.randomUUID(), topic: c.topic || "", category: c.category || "", sourceTitle: String(c.title || "").slice(0, 200), url: c.url, publisher: c.publisher || "", publishedAt: c.publishedAt || null,
    retrievedAt: now, evidence: [], summary: "", verification: null, relevanceScore: 0, qualityScore: 0, processingStatus: "NEW", duplicate: null, draftId: null, error: null, attempts: c.attempts || 0, history: [] };
  const stop = async (status, error, extra = {}) => {
    setStatus(rec, status, error, now); rec.error = error || null; Object.assign(rec, extra);
    await save(rec); lg.record("research", `${status}: ${rec.sourceTitle}${error ? " - " + error : ""}`.slice(0, 280)); return rec;
  };
  const cu = canonicalUrl(c.url);
  if (!cu) return stop("REJECTED", "invalid or unsafe URL");
  rec.url = cu; rec.canonicalUrl = cu;
  const idx = `researchIdx/${sha(cu)}`;
  if (c.retryOf) await db.set(idx, rec.id); // retries replace the unique-URL index entry
  else if (!(await db.claim(idx, rec.id))) return stop("DUPLICATE", "URL already queued or processed (unique index)", { duplicate: { duplicate: true, reason: "unique URL index" } });
  const sc = scoreSource({ ...c, url: cu }, settings.newsTopics, now);
  rec.relevanceScore = sc.relevance; rec.sourceScores = sc;
  if (sc.relevance < CFG.minRelevance) return stop("REJECTED", "low relevance");
  const others = async () => (await deps.existing()).filter((x) => x.id !== c.retryOf);
  const dup = checkDuplicate({ url: cu, title: rec.sourceTitle }, await others());
  rec.duplicate = dup;
  if (dup.duplicate) return stop("DUPLICATE", dup.reason);
  let ev;
  try { ev = await deps.fetchEvidence(cu); } catch (e) {
    const permanent = e.permanent === true || e.status === 404 || e.status === 403 || e.status === 410;
    const attempts = rec.attempts + 1;
    if (permanent) return stop("SOURCE_UNAVAILABLE", e.message, { retry: { retryable: false } });
    if (attempts >= MAX_ATTEMPTS) return stop("DEAD" in TRANSITIONS ? "SOURCE_UNAVAILABLE" : "FAILED", `${e.message} (gave up after ${attempts} attempts)`, { attempts, retry: { retryable: false, exhausted: true } });
    return stop("SOURCE_UNAVAILABLE", e.message, { attempts, retry: { retryable: true, nextAt: now + backoff(attempts) } });
  }
  if (!ev?.text) return stop("SOURCE_UNAVAILABLE", "no readable evidence", { retry: { retryable: false } });
  const mk = (x, primary) => ({ url: x.url || cu, title: x.title || rec.sourceTitle, publisher: x.publisher || "", publishedAt: x.publishedAt || null, primary, text: String(x.text).slice(0, 600), retrievedAt: now });
  rec.evidence = [mk({ ...ev, publisher: ev.publisher || rec.publisher, publishedAt: rec.publishedAt }, sc.primary)];
  try { for (const r of (await deps.relatedEvidence?.(rec)) || []) if (r?.text) rec.evidence.push(mk(r, false)); } catch (e) { rec.relatedError = String(e.message).slice(0, 120); }
  rec.summary = ev.text.slice(0, 280);
  const dup2 = checkDuplicate({ url: rec.evidence[0].url, title: rec.sourceTitle, text: ev.text }, await others());
  if (dup2.duplicate) { rec.duplicate = dup2; return stop("DUPLICATE", dup2.reason); }
  let draft;
  try { draft = await deps.writeDraft(rec); } catch (e) { return stop("FAILED", "draft: " + e.message, { retry: { retryable: false } }); }
  rec.draft = { text: draft.text };
  let claims;
  try { claims = await deps.extractClaims(draft.text); } catch (e) { return stop("FAILED", "claims: " + e.message, { retry: { retryable: false } }); }
  rec.verification = verifyClaims(claims, rec.evidence, { now, publishedAt: rec.publishedAt });
  rec.quality = qualityReport(rec.draft, { brand: settings.brand, history: await deps.history(), verification: rec.verification, minQuality: settings.researchMinQuality || CFG.minQuality });
  rec.qualityScore = rec.quality.overall;
  if (!rec.quality.passed) return stop(rec.verification.status === "VERIFIED" ? "QUALITY_REJECTED" : "NEEDS_REVIEW", rec.quality.mandatoryFailures.join("; ") || `quality ${rec.quality.overall}`);
  const why = finalCheck({ ...rec, processingStatus: "QUEUED" }, settings, now);
  if (why) return stop("BLOCKED", why);
  setStatus(rec, "QUEUED", "eligible", now); await save(rec);
  lg.record("research", `Queued for scheduler: ${rec.sourceTitle}`.slice(0, 280));
  return rec;
}

// Source-unavailable records whose backoff has elapsed (reprocessed by the research worker; old record is superseded).
export async function retryDue(now = Date.now()) {
  return (await listRecords(200)).filter((r) => r.processingStatus === "SOURCE_UNAVAILABLE" && r.retry?.retryable && r.retry.nextAt <= now && (r.attempts || 0) < MAX_ATTEMPTS);
}
export const supersede = (id) => withRecord(id, (r) => { setStatus(r, "SUPERSEDED", "retried"); });

export async function stats() {
  const all = await listRecords(500), by = (s) => all.filter((r) => r.processingStatus === s).length;
  const cl = all.flatMap((r) => r.verification?.claims || []);
  return { discovered: all.length, stored: all.filter((r) => r.evidence?.length).length, rejected: all.filter((r) => ["REJECTED", "SOURCE_UNAVAILABLE"].includes(r.processingStatus)).length,
    sourceFailures: by("SOURCE_UNAVAILABLE"), conflicts: all.filter((r) => r.verification?.status === "CONFLICTING_EVIDENCE").length,
    claimsVerified: cl.filter((c) => c.status === "VERIFIED").length, claimsNeedReview: cl.filter((c) => c.status === "NEEDS_REVIEW" || c.status === "CONFLICTING_EVIDENCE").length, duplicates: by("DUPLICATE"),
    drafts: all.filter((r) => r.draft).length, qualityRejected: by("QUALITY_REJECTED"), queued: by("QUEUED"), published: by("PUBLISHED"), needsReview: by("NEEDS_REVIEW"), dead: by("DEAD") };
}
