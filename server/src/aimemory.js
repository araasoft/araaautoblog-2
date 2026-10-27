// The AI's memory: what it is, why it exists, what it did last. Small on purpose (cheap to put in prompts).
// Database paths: ai/workflow/<id> (history), ai/state (live status), ai/strategy (current plan).
import crypto from "crypto";
import * as db from "./db.js";
import { redact } from "./security.js";

export const PURPOSE =
  "I am AraaBot, the autonomous marketing AI of Araa Softwares. Purpose: grow reach, views, likes and followers on Facebook and LinkedIn. " +
  "I read analytics, post at the hours that performed best, reuse hashtags/keywords that performed best, react to urgent news only when it is verified by several sources, " +
  "keep AI cost low, switch AI provider/model by myself when one fails, and keep humans informed. I never invent facts, clients or numbers.";

const newId = () => String(Date.now()).padStart(13, "0") + "-" + crypto.randomBytes(2).toString("hex");
let n = 0;

// step: short verb ("analytics", "strategy", "post", "failover", "breaking", "error"); status: ok | warn | error
export async function note(step, detail, status = "ok", extra = {}) {
  const rec = { at: Date.now(), step, status, detail: redact(String(detail || "")).slice(0, 220), ...extra };
  try {
    await db.set(`ai/workflow/${newId()}`, rec);
    if (++n % 40 === 0) await prune(150);
  } catch { /* history is best-effort */ }
  return rec;
}
async function prune(keep) {
  const all = (await db.get("ai/workflow")) || {};
  const ids = Object.keys(all).sort();
  for (const id of ids.slice(0, Math.max(0, ids.length - keep))) await db.remove(`ai/workflow/${id}`);
}
export async function history(limit = 30) {
  const raw = (await db.get("ai/workflow", { limitToLast: limit })) || {};
  return Object.entries(raw).sort(([a], [b]) => b.localeCompare(a)).map(([id, r]) => ({ id, ...r }));
}
export const getState = async () => (await db.get("ai/state")) || {};
export const setState = (patch) => db.update("ai/state", patch);
export const getStrategy = async () => (await db.get("ai/strategy")) || null;

// Compact context for prompts (about 600-900 characters): purpose + last steps + strategy + proven tags.
export async function context({ steps = 5, withTags = true } = {}) {
  const [h, st, ins] = await Promise.all([history(steps), getStrategy(), withTags ? db.get("analytics/insights") : null]);
  const last = h.slice().reverse().map((x) => `${x.step}:${x.status}:${x.detail}`.slice(0, 110)).join(" | ");
  const parts = [PURPOSE];
  if (last) parts.push(`My last steps: ${last}`);
  if (st?.summary) parts.push(`Current strategy: ${String(st.summary).slice(0, 260)}`);
  if (ins?.topHashtags?.length) parts.push(`Best hashtags so far: ${ins.topHashtags.slice(0, 6).map((t) => t.tag).join(" ")}`);
  if (ins?.topKeywords?.length) parts.push(`Best keywords so far: ${ins.topKeywords.slice(0, 8).map((t) => t.word).join(", ")}`);
  return parts.join("\n");
}
