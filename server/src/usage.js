// AI usage ledger: one record per real provider request (usage/ledger/<id>), with pricing used, estimate-vs-reported, status.
import fs from "fs";
import crypto from "crypto";
import * as db from "./db.js";
import { redact } from "./security.js";

export const TASKS = ["research", "draft", "verification", "quality", "rewrite", "other"];
let pricingCache;
export function loadPricing(file = process.env.PRICING_FILE || "./pricing.json") {
  if (pricingCache?.file === file) return pricingCache.v;
  let v = { version: "none", currency: "USD", models: {} };
  try { v = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* missing file: every cost becomes "unpriced", never zero */ }
  pricingCache = { file, v }; return v;
}
export const _resetPricing = () => { pricingCache = undefined; };

// u: provider-reported usage or null. Returns cost fields; cost is null when usage or price is unknown (never silently 0).
export function computeCost({ provider, model, usage, reportedCost }, pricing = loadPricing()) {
  const base = { currency: pricing.currency || "USD", pricingVersion: pricing.version };
  if (reportedCost != null && Number.isFinite(reportedCost)) return { ...base, cost: reportedCost, costKind: "reported" };
  if (!usage) return { ...base, cost: null, costKind: "unknown", costNote: "provider returned no usage" };
  const p = pricing.models?.[`${provider}:${model}`];
  if (!p) return { ...base, cost: null, costKind: "unpriced", costNote: `no pricing configured for ${provider}:${model}` };
  const cached = usage.cachedInputTokens || 0, input = Math.max(0, (usage.inputTokens || 0) - cached);
  const cost = (input * (p.inputPerMTok || 0) + cached * (p.cachedInputPerMTok ?? p.inputPerMTok ?? 0) + (usage.outputTokens || 0) * (p.outputPerMTok || 0)) / 1e6;
  return { ...base, cost: +cost.toFixed(8), costKind: "estimated", rates: p };
}
export const classifyError = (e) => !e ? undefined : e.status === 429 ? "rate_limit" : e.status === 401 || e.status === 403 ? "auth" : e.status >= 500 ? "provider_5xx" : /timeout|abort/i.test(e.message || "") ? "timeout" : e.status >= 400 ? "bad_request" : "unknown";
export function normalizeUsage(u) {
  if (!u || (u.prompt_tokens == null && u.completion_tokens == null && u.total_tokens == null)) return null;
  const inT = u.prompt_tokens ?? null, out = u.completion_tokens ?? null;
  return { inputTokens: inT ?? 0, outputTokens: out ?? 0, cachedInputTokens: u.prompt_tokens_details?.cached_tokens || 0, totalTokens: u.total_tokens ?? ((inT || 0) + (out || 0)) };
}

// requestId makes recording idempotent: the same request is never recorded twice.
export async function record({ provider = "groq", model, task = "other", usage, reportedCost, status = "ok", durationMs = 0, refId, error, requestId, at = Date.now() }) {
  const id = String(at).padStart(13, "0") + "-" + (requestId || crypto.randomUUID()).slice(0, 12);
  const rec = { id, at, provider, model: model || "unknown", task: TASKS.includes(task) ? task : "other", status, durationMs, refId: refId || null,
    usage: usage || null, usageKnown: Boolean(usage), ...computeCost({ provider, model, usage, reportedCost }), errorClass: classifyError(error), error: error ? redact(error.message || String(error)).slice(0, 160) : undefined };
  if (status !== "ok" && !usage) { rec.cost = null; rec.costKind = "none"; } // a failed call without reported usage costs nothing we know of
  try { if (!(await db.claim(`usage/ledger/${id}`, rec))) return null; } catch { /* ledger is best-effort but never throws into the request path */ }
  return rec;
}

export async function ledger({ from = 0, to = Date.now(), limit = 5000 } = {}) {
  const raw = (await db.get("usage/ledger", { limitToLast: limit })) || {};
  return Object.values(raw).filter((r) => r && r.at >= from && r.at <= to).sort((a, b) => b.at - a.at);
}
const add = (m, k, r) => { const x = (m[k] ||= { calls: 0, ok: 0, failed: 0, inputTokens: 0, outputTokens: 0, cost: 0, unpricedCalls: 0 }); x.calls++; r.status === "ok" ? x.ok++ : x.failed++; x.inputTokens += r.usage?.inputTokens || 0; x.outputTokens += r.usage?.outputTokens || 0; if (r.cost != null) x.cost += r.cost; else if (r.status === "ok") x.unpricedCalls++; };
export function summarize(rows, now = Date.now()) {
  const out = { total: {}, byProvider: {}, byModel: {}, byTask: {}, estimatedCost: 0, reportedCost: 0, periods: {} };
  for (const r of rows) { add(out, "x", r); add(out.byProvider, r.provider, r); add(out.byModel, `${r.provider}:${r.model}`, r); add(out.byTask, r.task, r);
    if (r.cost != null) r.costKind === "reported" ? (out.reportedCost += r.cost) : (out.estimatedCost += r.cost); }
  out.total = out.x; delete out.x;
  const day = new Date(now).setUTCHours(0, 0, 0, 0), cost = (from) => +rows.filter((r) => r.at >= from).reduce((a, r) => a + (r.cost || 0), 0).toFixed(6);
  out.periods = { today: cost(day), week: cost(day - 6 * 864e5), month: cost(day - 29 * 864e5) };
  out.estimatedCost = +out.estimatedCost.toFixed(6); out.reportedCost = +out.reportedCost.toFixed(6);
  return out;
}
