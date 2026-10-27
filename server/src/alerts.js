// In-app alerts with dedup + cooldown + severity. Optional webhook delivery only if ALERT_WEBHOOK_URL is set (untested against any real endpoint).
import crypto from "crypto";
import * as db from "./db.js";
import { redact } from "./security.js";

const SEV = ["info", "warning", "critical"];
const last = new Map(); // dedupe key -> time (in-memory; persisted via alerts/<id>.key for restart)
export async function raise(key, severity, message, { cooldownMs = 3600e3, now = Date.now(), webhook = process.env.ALERT_WEBHOOK_URL } = {}) {
  if (!SEV.includes(severity)) severity = "warning";
  if (now - (last.get(key) || 0) < cooldownMs) return null;
  last.set(key, now);
  const a = { id: String(now).padStart(13, "0") + "-" + crypto.randomBytes(2).toString("hex"), at: now, key, severity, message: redact(message).slice(0, 240), acknowledged: false, delivered: null };
  await db.set(`alerts/${a.id}`, a).catch(() => {});
  if (webhook && severity !== "info") {
    try { const r = await fetch(webhook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: `[AraaPosts ${severity}] ${a.message}` }), signal: AbortSignal.timeout(8000) }); a.delivered = r.ok; }
    catch { a.delivered = false; }
    await db.set(`alerts/${a.id}`, a).catch(() => {});
  }
  return a;
}
export async function list(limit = 50) { return Object.values((await db.get("alerts", { limitToLast: limit })) || {}).sort((a, b) => b.at - a.at); }
export async function acknowledge(id) { const a = await db.get(`alerts/${id}`); if (!a) return null; a.acknowledged = true; await db.set(`alerts/${id}`, a); return a; }
export const _reset = () => last.clear();

// Periodic checks; each is deduplicated by key.
export async function evaluate({ research, usageRows, settings, env = process.env, run, now = Date.now() }) {
  const out = [], r = (key, sev, msg, o = {}) => raise(key, sev, msg, { webhook: env.ALERT_WEBHOOK_URL, ...o, now }).then((x) => x && out.push(x));
  if (settings.paused) await r("stop", "critical", "Emergency stop is ON: no automatic publishing", { cooldownMs: 6 * 3600e3 });
  if (settings.facebookEnabled === false) await r("fbpause", "warning", "Facebook automation is paused");
  if (!env.FB_PAGE_ID || !env.FB_PAGE_TOKEN) await r("creds-fb", "critical", "Facebook credentials are missing");
  if (!env.GROQ_API_KEY) await r("creds-ai", "critical", "AI API key is missing");
  if (run && run.ok === false) await r("research-fail", "warning", `Research worker failed: ${run.error}`);
  const recent = usageRows.filter((x) => now - x.at < 3600e3), bad = recent.filter((x) => x.status !== "ok");
  if (bad.length >= 5) await r("ai-errors", "critical", `${bad.length} AI request failures in the last hour (${bad[0].errorClass || "unknown"})`);
  if (research) {
    if (research.sourceFailures >= Number(env.ALERT_SOURCE_FAILURES || 10)) await r("source-fail", "warning", `${research.sourceFailures} sources unavailable`);
    if (research.queued >= Number(env.ALERT_QUEUE_BACKLOG || 20)) await r("backlog", "warning", `Research queue backlog: ${research.queued} items`);
    if (research.needsReview > 0) await r("review", "info", `${research.needsReview} research items need review`, { cooldownMs: 12 * 3600e3 });
  }
  const budget = Number(env.AI_BUDGET_USD_MONTH || 0);
  if (budget > 0) {
    const spent = usageRows.filter((x) => now - x.at < 30 * 864e5).reduce((a, x) => a + (x.cost || 0), 0);
    if (spent >= budget) await r("budget", "critical", `AI estimated spend $${spent.toFixed(2)} reached budget $${budget}`);
    else if (spent >= budget * 0.8) await r("budget80", "warning", `AI estimated spend at 80% of budget ($${spent.toFixed(2)}/$${budget})`);
  }
  return out;
}
