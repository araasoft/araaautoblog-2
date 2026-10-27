// Marketing AI autopilot. One cycle, cheap by design (at most ONE AI call, and only when it is really needed):
//   1. refresh analytics (no AI)            2. read what works: best hours, hashtags, keywords (no AI)
//   3. if the strategy is older than N days or the data changed a lot -> ONE AI call writes a short strategy
//   4. re-plan today's posts at the best hours (no AI)       5. check AI providers, write everything to the workflow history
// The AI always knows its purpose and its last steps (aimemory.context), so it continues the work instead of starting over.
import * as db from "./db.js";
import * as analytics from "./analytics.js";
import * as ai from "./ai.js";
import * as client from "./aiclient.js";
import * as mem from "./aimemory.js";
import * as notify from "./notify.js";
import * as auto from "./automation.js";
import { getSettings } from "./store.js";
import { isShuttingDown, onShutdown } from "./lifecycle.js";

const DAY = 864e5;
let running = false;

export async function cycle({ reason = "schedule", forceStrategy = false } = {}) {
  if (running) return { busy: true };
  running = true;
  const out = { steps: [], reason };
  try {
    const s = getSettings();
    await mem.setState({ status: "running", currentGoal: "Learn from analytics and improve posting", lastCycleStart: Date.now() });
    await mem.note("cycle", `Cycle started (${reason})`);

    // 1-2 analytics (free)
    const a = await analytics.collect({ force: reason === "manual" });
    out.steps.push("analytics");
    const ins = a.insights;

    // 3 strategy (one cheap AI call, weekly or when forced)
    const strat = await mem.getStrategy();
    const age = strat ? Date.now() - strat.at : Infinity;
    if (ins && (forceStrategy || age > 7 * DAY || (age > 2 * DAY && ins.ready && !strat?.basedOnReady))) {
      try {
        const brand = ai.brand();
        const ctx = await mem.context({ steps: 6 });
        const data = `Best hours (local): ${ins.bestHours.map((h) => `${h.hour}:00 (avg ${h.avg}, ${h.n} posts)`).join("; ") || "no data yet"}
Best hashtags: ${ins.topHashtags.slice(0, 8).map((t) => `${t.tag}(${t.avg})`).join(" ") || "none"}
Best keywords: ${ins.topKeywords.slice(0, 10).map((t) => t.word).join(", ") || "none"}
Measured posts: ${ins.measured}`;
        const raw = await ai.generateText(
          `${ctx}\n\nBrand: ${brand.name}; services: ${brand.services}; audience: ${brand.audience}.\n${data}\n\nWrite my short strategy for the next 7 days. Use ONLY the data above; if data is thin say so and keep the plan general. Return ONLY JSON:\n{"summary":"2 sentences","topics":["6 post topics likely to get views"],"avoid":"one short line","nextCheck":"what I will measure next"}`,
          700, { task: "research", cache: true });
        const d = ai.parseJSON(raw), arr = (x, n) => (Array.isArray(x) ? x.map((v) => String(v).slice(0, 120)).slice(0, n) : []);
        await db.set("ai/strategy", { at: Date.now(), summary: String(d.summary || "").slice(0, 400), topics: arr(d.topics, 6), avoid: String(d.avoid || "").slice(0, 200), nextCheck: String(d.nextCheck || "").slice(0, 200), basedOnReady: ins.ready });
        await mem.note("strategy", `New strategy: ${String(d.summary || "").slice(0, 150)}`);
        out.steps.push("strategy");
      } catch (e) { await mem.note("strategy", `Skipped: ${e.message}`, "warn"); out.strategyError = e.message; }
    }

    // 4 re-plan today at the best hours (free)
    if (s.enabled && !s.paused && s.useBestTimes && ins?.ready) {
      const st = await auto.replan();
      await mem.note("plan", `Today's plan updated: ${st.jobs.filter((j) => j.status === "pending").length} pending post(s) at best hours`);
      out.steps.push("replan");
    }

    // 5 provider health
    const hr = await client.healthReport();
    const bad = hr.flatMap((p) => p.models.filter((m) => !m.ok).map((m) => `${p.id}/${m.model}`));
    if (bad.length) { await mem.note("health", `Paused AI models: ${bad.join(", ")}`, "warn"); out.paused = bad; }
    if (!hr.length) await notify.event("ai", { title: "No AI provider configured", detail: "Set GROQ_API_KEY (or another provider key).", level: "warning", mail: false });

    await mem.setState({ status: "idle", lastCycleAt: Date.now(), lastError: "", currentGoal: "Waiting for the next cycle" });
    await mem.note("cycle", `Cycle finished: ${out.steps.join(", ") || "nothing to do"}`);
    return out;
  } catch (e) {
    await mem.setState({ status: "error", lastError: e.message.slice(0, 200), lastCycleAt: Date.now() }).catch(() => {});
    await mem.note("cycle", `Cycle failed: ${e.message}`, "error");
    out.error = e.message;
    return out;
  } finally { running = false; }
}

export async function overview() {
  const [state, strategy, history, ins, health, tokens] = await Promise.all([
    mem.getState(), mem.getStrategy(), mem.history(25), db.get("analytics/insights"), client.healthReport(),
    db.get(`usage/${new Date().toISOString().slice(0, 10)}`).then((u) => u?.tokens || 0).catch(() => 0),
  ]);
  const s = getSettings();
  return { purpose: mem.PURPOSE, autopilot: s.aiAutopilot, state, strategy, history, insights: ins, providers: health, tokens: { today: tokens, cap: s.aiDailyTokenCap }, running };
}

let timer;
export function start() {
  const loop = () => { timer = setTimeout(async () => { if (!isShuttingDown() && getSettings().aiAutopilot) await cycle({ reason: "schedule" }); loop(); }, 6 * 3600_000); };
  loop();
  setTimeout(() => { if (getSettings().aiAutopilot) cycle({ reason: "startup" }); }, 120_000);
  onShutdown(() => clearTimeout(timer));
}
