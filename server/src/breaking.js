// Breaking / urgent / update news: scans fresh headlines every few minutes and, when a story is both urgent and confirmed by
// several outlets, writes a short post and publishes it IMMEDIATELY (or saves a draft in approval mode).
// Safety: only facts from the headlines, needs N different outlets (setting), tragedy/violence stories are never auto-posted
// (admins get a notification to decide), daily limit, minimum gap, emergency stop, and the AI is optional (template fallback).
import crypto from "crypto";
import * as db from "./db.js";
import * as news from "./news.js";
import * as ai from "./ai.js";
import * as mem from "./aimemory.js";
import * as notify from "./notify.js";
import * as lg from "./log.js";
import { publishGate } from "./gate.js";
import { publishContent } from "./automation.js";
import { getSettings, getDrafts, saveDrafts } from "./store.js";
import { dayKey } from "./planner.js";
import { isShuttingDown, onShutdown, track } from "./lifecycle.js";

const BOT = { author: { name: "Breaking news bot" }, source: "breaking" };
const RX = {
  emergency: /\b(urgent|emergency|zero[- ]day|critical (vulnerability|flaw|patch)|data breach|breach|ransomware|outage|down worldwide|actively exploited|security alert|recall)\b/i,
  breaking: /\b(breaking|just in|developing|announces?|unveils?|launch(es|ed)?|acquires?|acquisition|bans?|approves?|released?)\b/i,
  update: /\b(update|updated|new version|rolls? out|patch|upgrade|v\d+(\.\d+)*)\b/i,
  tragedy: /\b(killed|dead|death|dies|shooting|massacre|terror|attack on|rape|suicide|casualt|victims?|bomb|war)\b/i,
};
const STOP = new Set("the a an of in on for to and at by with from as is are was be after over new says say".split(" "));
const toks = (t) => new Set(String(t).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
const jac = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i || 1); };
export const kindOf = (t) => (RX.emergency.test(t) ? "emergency" : RX.breaking.test(t) ? "breaking" : RX.update.test(t) ? "update" : null);

// items: [{title, source, link, at}] -> clusters [{kind, items, sources, score, tragedy, title}]  (pure, tested offline)
export function cluster(items, now = Date.now(), maxAgeMs = 3 * 3600_000) {
  const fresh = items.filter((i) => i.title && now - i.at <= maxAgeMs);
  const cl = [];
  for (const it of fresh) {
    const t = toks(it.title);
    const c = cl.find((x) => jac(x.t, t) >= 0.5);
    c ? c.items.push(it) : cl.push({ t, items: [it] });
  }
  return cl.map((c) => {
    const text = c.items.map((i) => i.title).join(" . ");
    const kind = kindOf(text);
    const sources = [...new Set(c.items.map((i) => i.source))];
    const newest = Math.max(...c.items.map((i) => i.at));
    const w = { emergency: 50, breaking: 30, update: 15 }[kind] || 0;
    return { kind, items: c.items, sources, tragedy: RX.tragedy.test(text), title: c.items[0].title, link: c.items[0].link, sig: crypto.createHash("sha1").update([...c.t].sort().slice(0, 6).join(" ")).digest("hex").slice(0, 16),
      score: kind ? w + sources.length * 12 + Math.max(0, 20 - (now - newest) / 60000 / 9) : 0 };
  }).filter((c) => c.kind).sort((a, b) => b.score - a.score);
}

const LABEL = { emergency: "🚨 URGENT", breaking: "📰 BREAKING", update: "🔄 UPDATE" };
async function write(c) {
  const src = c.sources.slice(0, 3).join(", ");
  const tags = { emergency: ["#UrgentAlert", "#Cybersecurity"], breaking: ["#BreakingNews", "#Tech"], update: ["#TechUpdate", "#Software"] }[c.kind];
  const fallback = `${LABEL[c.kind]}: ${c.title}\n\nReported by ${src}. We will share more as it develops.`;
  let caption = fallback;
  try {
    const heads = c.items.slice(0, 4).map((i) => `- ${i.title} (${i.source})`).join("\n");
    const raw = await ai.generateText(
      `You write a SHORT social post for Araa Softwares (software company) about this ${c.kind} news. Use ONLY facts in these headlines, add no details, no speculation, no numbers that are not in them. Name the sources. 250-500 characters, start with "${LABEL[c.kind]}:", one line on what it means for businesses, no hashtags, no links.\n${heads}\nReturn ONLY JSON: {"caption":"..."}`,
      450, { task: "draft" });
    const d = ai.parseJSON(raw);
    if (String(d.caption || "").length > 60) caption = String(d.caption).trim();
  } catch { /* AI down or capped: the template post is still accurate */ }
  const ins = await db.get("analytics/insights").catch(() => null);
  const proven = (ins?.topHashtags || []).slice(0, 2).map((t) => t.tag);
  return `${caption}\n\n${[...new Set([...tags, ...proven])].join(" ")}\n\n🔗 ${c.link}\n🌐 ${ai.company().website}`;
}

let busy = false;
export async function scan({ dryRun = false } = {}) {
  if (busy) return { busy: true };
  busy = true;
  try {
    const s = getSettings(), now = Date.now();
    if (!s.breakingEnabled && !dryRun) return { off: true };
    const g = publishGate({ settings: s, source: "breaking" });
    if (!g.ok && !dryRun) return { blocked: g.why };
    const all = (await Promise.allSettled(s.breakingQueries.map((q) => news.fetchTopic(q, { maxAgeMs: 4 * 60_000, when: "1d" })))).flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    const cands = cluster(all, now).filter((c) => c.sources.length >= (c.kind === "update" ? 1 : s.breakingMinSources));
    if (dryRun) return { found: cands.length, top: cands.slice(0, 5).map((c) => ({ kind: c.kind, title: c.title, sources: c.sources, tragedy: c.tragedy })) };
    const day = dayKey(now, s.utcOffsetMinutes);
    const [seen, count, last] = await Promise.all([db.get("breaking/seen"), db.get(`stats/breaking/${day}`), db.get("breaking/last")]);
    const todo = cands.find((c) => !seen?.[c.sig]);
    if (!todo) return { found: cands.length, posted: 0 };
    await db.set(`breaking/seen/${todo.sig}`, { at: now, title: todo.title.slice(0, 100) }); // remember first: never handle one story twice
    if (todo.tragedy) {
      await notify.event("breaking", { title: "Urgent story needs a human decision", detail: `${todo.title} (${todo.sources.join(", ")}). Not auto-posted because it involves harm to people.`, level: "warning", url: todo.link });
      await mem.note("breaking", `Skipped (sensitive, human review): ${todo.title}`, "warn");
      return { posted: 0, review: todo.title };
    }
    if ((count?.n || 0) >= s.breakingDailyLimit) { await mem.note("breaking", `Daily breaking limit reached (${s.breakingDailyLimit}); skipped: ${todo.title}`, "warn"); return { posted: 0, limit: true }; }
    if (last && now - last < s.breakingMinGapMin * 60_000) { await db.remove(`breaking/seen/${todo.sig}`); return { posted: 0, gap: true }; } // try again next scan
    const text = await write(todo);
    if (s.breakingMode === "approval") {
      const d = getDrafts(); d.push({ id: crypto.randomUUID(), createdAt: now, type: "text", text, breaking: true }); saveDrafts(d);
      await notify.event("breaking", { title: `${todo.kind} draft waiting for approval`, detail: todo.title, url: todo.link });
      await mem.note("breaking", `Draft saved (${todo.kind}): ${todo.title}`);
      return { posted: 0, draft: true };
    }
    const r = await track(publishContent({ text }, BOT));
    await Promise.all([db.set(`stats/breaking/${day}`, { n: (count?.n || 0) + 1 }), db.set("breaking/last", now)]);
    lg.record("publish", `Breaking ${todo.kind} post published: ${todo.title.slice(0, 120)}`, { name: BOT.author.name });
    await mem.note("breaking", `Posted ${todo.kind} (${todo.sources.length} sources): ${todo.title}`);
    return { posted: 1, kind: todo.kind, postId: r.postId };
  } catch (e) {
    await mem.note("breaking", e.message, "error");
    lg.record("error", "Breaking news scan failed: " + e.message);
    return { error: e.message };
  } finally { busy = false; }
}

let timer;
export function start() {
  const loop = () => { timer = setTimeout(async () => { if (!isShuttingDown()) await scan(); loop(); }, Math.max(5, getSettings().breakingScanMin) * 60_000); };
  loop();
  onShutdown(() => clearTimeout(timer));
}
