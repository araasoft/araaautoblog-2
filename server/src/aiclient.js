// AI client with automatic failover. Any OpenAI-compatible provider works (Groq, Gemini, OpenRouter, OpenAI, custom).
// If a call fails the client switches by itself: next model (version) of the same provider, then the next provider.
// A model that no longer exists is replaced by the newest similar model found in the provider's /models list.
// Health, cooldowns and every switch are saved (ai/health) and written to the AI workflow history, so the AI "knows" what happened.
import crypto from "crypto";
import * as db from "./db.js";
import * as usage from "./usage.js";
import * as mem from "./aimemory.js";
import * as lg from "./log.js";
import { httpError } from "./facebook.js";

const split = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
export function providers(env = process.env) {
  const P = [
    { id: "groq", key: env.GROQ_API_KEY, base: "https://api.groq.com/openai/v1", models: [env.GROQ_MODEL || "openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.3-70b-versatile"], effort: true },
    { id: "gemini", key: env.GEMINI_API_KEY, base: "https://generativelanguage.googleapis.com/v1beta/openai", models: split(env.GEMINI_MODELS).length ? split(env.GEMINI_MODELS) : ["gemini-2.5-flash", "gemini-2.5-flash-lite"] },
    { id: "openrouter", key: env.OPENROUTER_API_KEY, base: "https://openrouter.ai/api/v1", models: split(env.OPENROUTER_MODELS).length ? split(env.OPENROUTER_MODELS) : ["openai/gpt-oss-120b", "meta-llama/llama-3.3-70b-instruct"] },
    { id: "openai", key: env.OPENAI_API_KEY, base: "https://api.openai.com/v1", models: split(env.OPENAI_MODELS).length ? split(env.OPENAI_MODELS) : ["gpt-4o-mini"], newTokens: true },
    { id: "custom", key: env.AI_CUSTOM_API_KEY, base: String(env.AI_CUSTOM_BASE_URL || "").replace(/\/+$/, ""), models: split(env.AI_CUSTOM_MODELS) },
  ].filter((p) => p.key && p.base && p.models.length);
  const order = split(env.AI_PROVIDER_ORDER || "groq,gemini,openrouter,openai,custom");
  return P.sort((a, b) => (order.indexOf(a.id) + 99) % 99 - (order.indexOf(b.id) + 99) % 99);
}
export const configured = () => providers().length > 0;

/* ---- health: in-memory, mirrored to the database so a restart remembers bad providers ---- */
let health = { providers: {}, models: {}, learned: {} }; // { until: ms, why }, learned: provider -> [models]
let loaded = false;
async function loadHealth() {
  if (loaded) return;
  loaded = true;
  try { health = { ...health, ...((await db.get("ai/health")) || {}) }; } catch { /* ignore */ }
  for (const k of ["providers", "models", "learned"]) health[k] ||= {};
}
const saveHealth = () => db.set("ai/health", health).catch(() => {});
const coolKey = (s) => s.replace(/[.#$/\[\]]/g, "_");
const cooling = (m, k) => (m[coolKey(k)]?.until || 0) > Date.now();
const cool = (m, k, ms, why) => { m[coolKey(k)] = { until: Date.now() + ms, why: String(why).slice(0, 120) }; saveHealth(); };

export const SKIP = /preview|embed|tts|whisper|guard|vision|image|audio|moderation|safeguard|realtime|transcribe|dall|thinking-exp/i;
// Newest model that looks like the failed one (same name tokens), not tried yet.
export function pickSimilar(failed, ids, tried = []) {
  const toks = String(failed).toLowerCase().split(/[^a-z]+/).filter((t) => t.length > 2);
  return ids.filter((id) => !SKIP.test(id) && !tried.includes(id) && toks.every((t) => id.toLowerCase().includes(t)))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
}
async function discover(p, failed, tried) {
  try {
    const r = await fetch(`${p.base}/models`, { headers: { Authorization: `Bearer ${p.key}` }, signal: AbortSignal.timeout(15_000) });
    const d = await r.json();
    const ids = (d.data || d.models || []).map((m) => String(m.id || m.name || "").replace(/^models\//, ""));
    return pickSimilar(failed, ids, tried);
  } catch { return undefined; }
}

const retryAfter = (res) => Math.min(30 * 60_000, Math.max(30_000, (Number(res.headers.get("retry-after")) || 120) * 1000));
async function callOne(p, model, prompt, max) {
  const body = { model, messages: [{ role: "user", content: prompt }], [p.newTokens ? "max_completion_tokens" : "max_tokens"]: max };
  if (p.effort && /gpt-oss/.test(model)) body.reasoning_effort = "low";
  const res = await fetch(`${p.base}/chat/completions`, {
    method: "POST", signal: AbortSignal.timeout(60_000),
    headers: { Authorization: `Bearer ${p.key}`, "Content-Type": "application/json", ...(p.id === "openrouter" ? { "X-Title": "AraaPosts" } : {}) },
    body: JSON.stringify(body),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(d.error?.message || d.message || `${p.id} HTTP ${res.status}`), { status: res.status, code: d.error?.code, retryMs: retryAfter(res) });
  const text = d.choices?.[0]?.message?.content?.trim();
  if (!text) throw Object.assign(new Error("empty response"), { status: 502, empty: true });
  return { text, usage: d.usage };
}

/* ---- daily token cap (0 = off): protects the AI budget ---- */
let capCache = { t: 0, v: 0 };
async function tokensToday() {
  if (Date.now() - capCache.t < 30_000) return capCache.v;
  const u = (await db.get(`usage/${new Date().toISOString().slice(0, 10)}`).catch(() => null)) || {};
  capCache = { t: Date.now(), v: u.tokens || 0 };
  return capCache.v;
}
const memo = new Map(); // identical prompt within 10 minutes -> cached answer (saves tokens on double clicks)

export async function generate(prompt, max = 1500, { task = "other", refId, cap = 0, cache = false } = {}) {
  const P = providers();
  if (!P.length) throw httpError(500, "No AI key is set. Set GROQ_API_KEY (or GEMINI_API_KEY / OPENROUTER_API_KEY / OPENAI_API_KEY) on the server");
  if (cap > 0 && (await tokensToday()) >= cap) throw httpError(429, `Daily AI token cap reached (${cap}). Raise it in Marketing AI > Limits.`);
  const ck = cache ? crypto.createHash("sha1").update(prompt + max).digest("hex") : null;
  if (ck && memo.get(ck)?.t > Date.now() - 600_000) return memo.get(ck).text;
  await loadHealth();

  const tried = [], errors = [];
  let first = true;
  for (const p of P) {
    if (cooling(health.providers, p.id)) continue;
    const list = [...new Set([...p.models, ...(health.learned[p.id] || [])])];
    for (let i = 0; i < list.length; i++) {
      const model = list[i];
      if (cooling(health.models, `${p.id}:${model}`)) continue;
      const t0 = Date.now();
      try {
        const r = await callOne(p, model, prompt, max);
        lg.usage("ai", 1, r.usage?.total_tokens || 0);
        capCache.v += r.usage?.total_tokens || 0;
        usage.record({ provider: p.id, model, task, refId, usage: usage.normalizeUsage(r.usage), status: "ok", durationMs: Date.now() - t0 });
        if (!first) await mem.note("failover", `Working again on ${p.id}/${model} after: ${errors.at(-1) || "error"}`, "warn");
        if (ck) { memo.set(ck, { t: Date.now(), text: r.text }); if (memo.size > 50) memo.delete(memo.keys().next().value); }
        return r.text;
      } catch (e) {
        first = false;
        const why = `${p.id}/${model}: ${e.status || ""} ${e.message}`.slice(0, 160);
        errors.push(why);
        usage.record({ provider: p.id, model, task, refId, usage: null, status: "error", durationMs: Date.now() - t0, error: e });
        if (e.status === 401 || e.status === 403) { cool(health.providers, p.id, 6 * 3600_000, "auth"); await mem.note("failover", `Key rejected by ${p.id}; switching provider. ${e.message}`, "error"); break; }
        if (e.status === 404 || e.status === 400 || e.code === "model_not_found") {
          cool(health.models, `${p.id}:${model}`, 24 * 3600_000, "gone");
          tried.push(model);
          const next = await discover(p, model, [...list, ...tried]);
          if (next) { (health.learned[p.id] ||= []).push(next); list.push(next); saveHealth(); await mem.note("failover", `Model ${model} failed on ${p.id}; switching to newer version ${next}`, "warn"); }
          else await mem.note("failover", `Model ${model} failed on ${p.id}: ${e.message}`, "warn");
          continue;
        }
        cool(health.models, `${p.id}:${model}`, e.status === 429 ? e.retryMs || 120_000 : 5 * 60_000, e.status || "error");
        await mem.note("failover", `${why}; trying next model/provider`, "warn");
      }
    }
  }
  await mem.note("error", `All AI providers failed: ${errors.slice(-3).join(" || ")}`, "error");
  throw httpError(502, `All AI providers failed (${errors.length} attempts). Last: ${errors.at(-1) || "none configured / all cooling down"}`);
}

export async function healthReport() {
  await loadHealth();
  const now = Date.now();
  return providers().map((p) => ({
    id: p.id,
    state: cooling(health.providers, p.id) ? "paused (key problem)" : "ready",
    models: [...new Set([...p.models, ...(health.learned[p.id] || [])])].map((m) => {
      const c = health.models[coolKey(`${p.id}:${m}`)];
      return { model: m, ok: !(c && c.until > now), why: c && c.until > now ? c.why : "", retryInMin: c && c.until > now ? Math.ceil((c.until - now) / 60000) : 0 };
    }),
  }));
}
export const resetHealth = () => { health = { providers: {}, models: {}, learned: {} }; loaded = true; saveHealth(); };
export const _reset = () => { health = { providers: {}, models: {}, learned: {} }; loaded = false; memo.clear(); capCache = { t: 0, v: 0 }; };
