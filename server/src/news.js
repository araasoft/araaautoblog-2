// News tracking + daily AI analysis. Headlines come from Google News RSS (no API key, no dependencies).
import crypto from "crypto";
import * as db from "./db.js";
import * as ai from "./ai.js";
import { getSettings } from "./store.js";
import { dayKey } from "./planner.js";

const log = (...a) => console.log(new Date().toISOString(), "[news]", ...a);
const dec = (s) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&");
const tag = (x, t) => {
  const m = new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`).exec(x);
  return m ? dec(m[1]).trim() : "";
};
const topics = () => getSettings().newsTopics || [];
const cache = new Map(); // topic -> { t, items }

export async function fetchTopic(topic, { maxAgeMs = 20 * 60_000, when = "2d" } = {}) {
  const c = cache.get(topic + "|" + when);
  if (c && Date.now() - c.t < maxAgeMs) return c.items;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(topic + " when:" + when)}&hl=en&gl=US&ceid=US:en`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 AraaPosts" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`News feed failed (${res.status})`);
  const xml = await res.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 8).map((m) => {
    const raw = tag(m[1], "title"), source = tag(m[1], "source") || "News";
    const title = raw.endsWith(" - " + source) ? raw.slice(0, -(source.length + 3)) : raw;
    return {
      id: crypto.createHash("sha1").update(title.toLowerCase()).digest("hex").slice(0, 10),
      title, source, link: tag(m[1], "link"), at: Date.parse(tag(m[1], "pubDate")) || Date.now(), topic,
    };
  });
  cache.set(topic + "|" + when, { t: Date.now(), items });
  return items;
}

const seenIds = async () => new Set(((await db.get("app/newsSeen")) || {}).ids || []);

export async function getNews({ force } = {}) {
  if (force) cache.clear();
  const list = topics();
  const res = await Promise.allSettled(list.map(fetchTopic));
  const seen = new Set();
  const items = res.flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .filter((n) => n.title && !seen.has(n.id) && seen.add(n.id))
    .sort((a, b) => b.at - a.at).slice(0, 40);
  const old = await seenIds().catch(() => new Set());
  return { topics: list, items: items.map((n) => ({ ...n, isNew: !old.has(n.id) })), brief: await getBrief() };
}

export async function markSeen(ids = []) {
  const merged = [...new Set([...ids.map(String), ...(await seenIds())])].slice(0, 300);
  await db.set("app/newsSeen", { ids: merged });
  return { ok: true };
}

export async function getBrief() {
  const b = await db.get("app/newsBrief");
  return b ? { trends: [], opportunities: [], risks: [], postIdeas: [], ...b } : null;
}

// One AI call: summary, trends, opportunities, risks and post ideas from the latest headlines.
export async function makeBrief() {
  const { items } = await getNews();
  if (!items.length) throw new Error("No headlines found - add topics first");
  const co = ai.company();
  const heads = items.slice(0, 16).map((n) => `- ${n.title} (${n.source})`).join("\n");
  const raw = await ai.generateText(
    `You are the news analyst and marketing strategist for ${co.name}, a software company (web, mobile apps, AI, startups) in Qatar and Sri Lanka.
Headlines from the last 2 days:\n${heads}\n
Use ONLY facts in these headlines; do not invent details. Return ONLY JSON:
{"summary":"3-4 sentence overview","trends":["max 4 short items"],"opportunities":["max 3: how our business can benefit or market"],"risks":["max 2"],"postIdeas":["3 short social post topics based on the news"]}`,
    1200, { task: "research" },
  );
  const d = ai.parseJSON(raw);
  const arr = (x, n) => (Array.isArray(x) ? x.map(String).slice(0, n) : []);
  const brief = {
    day: dayKey(Date.now(), getSettings().utcOffsetMinutes), at: Date.now(), summary: String(d.summary || ""),
    trends: arr(d.trends, 4), opportunities: arr(d.opportunities, 3), risks: arr(d.risks, 2), postIdeas: arr(d.postIdeas, 3),
  };
  await db.set("app/newsBrief", brief);
  return brief;
}

// Topic text for a news-based automatic post
export async function topicForPost() {
  const { items } = await getNews();
  const n = items.slice(0, 8)[Math.floor(Math.random() * Math.min(8, items.length))];
  if (!n) return undefined;
  return `our short take for business owners on this news: "${n.title}" (${n.source}). Use only facts in the headline, invent no details, and mention the source by name`;
}

// Once a day (after the start hour) the brief is prepared automatically.
export function start() {
  const check = async () => {
    try {
      const s = getSettings();
      if (!process.env.GROQ_API_KEY || !s.newsTopics?.length) return;
      const now = Date.now(), hour = new Date(now + s.utcOffsetMinutes * 60000).getUTCHours();
      const b = await getBrief();
      if (hour >= s.startHour && (!b || b.day !== dayKey(now, s.utcOffsetMinutes))) {
        await makeBrief();
        log("daily brief ready");
      }
    } catch (e) {
      log("daily brief failed:", e.message);
    }
  };
  setInterval(check, 30 * 60_000);
  setTimeout(check, 20_000);
}
