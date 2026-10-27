import { httpError } from "./facebook.js";
import { getSettings } from "./store.js";
import * as lg from "./log.js";
import * as usage from "./usage.js";

import * as client from "./aiclient.js";
import * as mem from "./aimemory.js";
import * as db from "./db.js";

export const brand = () => ({
  name: "Araa Softwares", motto: "Empowering the world through intelligent software.", website: "https://araasoftwares.com",
  services: "web development, mobile apps, AI automation and startup solutions", audience: "small and medium businesses and startups in Qatar and Sri Lanka",
  tone: "friendly professional", avoid: "", mix: { educational: 50, informational: 30, promotional: 20 },
  ...(getSettings().brand || {}),
});
export const company = () => {
  const b = brand();
  return {
    name: b.name,
    whatsapp: process.env.COMPANY_WHATSAPP || "51884262",
    website: b.website || process.env.COMPANY_WEBSITE || "https://araasoftwares.com",
    email: process.env.COMPANY_EMAIL || "araasoftwares@gmail.com",
  };
};
const CATS = {
  educational: "educational (teach one useful tip, no hard sell)",
  informational: "informational (industry or technology update, balanced and factual)",
  promotional: "promotional (one genuine service benefit with a clear call to action)",
};
function pickCategory(mix = {}) {
  const w = Object.keys(CATS).map((k) => [k, Math.max(0, Number(mix[k]) || 0)]);
  let r = Math.random() * (w.reduce((a, [, v]) => a + v, 0) || 1);
  for (const [k, v] of w) if ((r -= v) < 0) return k;
  return "educational";
}

const TOPICS = [
  "why businesses in Qatar and Sri Lanka need a fast, modern website",
  "how a mobile app can help a small business grow",
  "a short insight on an AI trend and what it means for businesses",
  "how AI automation saves time and cost for companies",
  "launching a startup: one practical technical tip",
  "a behind-the-scenes look at how our team builds software",
  "a web development best practice (speed, SEO or security)",
  "a general lesson learned from building software projects (no fake clients or numbers)",
  "a productivity or coding workflow tip for developers",
  "why custom software beats off-the-shelf tools for growing companies",
  "a motivational message about learning to code and building a tech career",
  "a short promotion of our services: web development, mobile apps and startup solutions",
];

export const IMAGE_KEYWORDS = [
  "software development", "mobile app", "artificial intelligence", "startup team",
  "coding laptop", "web design", "cloud computing", "data analytics",
  "technology office", "cybersecurity",
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Every AI call goes through the failover client (provider/model switching, token cap, usage ledger).
export async function generateText(prompt, max = 1500, { task = "other", refId, cache } = {}) {
  return client.generate(prompt, max, { task, refId, cache, cap: Number(getSettings().aiDailyTokenCap) || 0 });
}

export function parseJSON(raw) {
  const s = raw.indexOf("{");
  const e = raw.lastIndexOf("}");
  if (s < 0 || e < s) throw new Error("No JSON in AI response");
  const body = raw.slice(s, e + 1);
  try {
    return JSON.parse(body);
  } catch {
    return JSON.parse(body.replace(/,(\s*[}\]])/g, "$1")); // remove trailing commas
  }
}

// Returns { caption, hashtags[], imageKeyword }
export async function draftPost({ topic, history = [] } = {}) {
  const co = company(), b = brand(), cat = pickCategory(b.mix);
  const [ctx, strat, ins] = await Promise.all([mem.context({ steps: 3, withTags: false }).catch(() => ""), mem.getStrategy().catch(() => null), db.get("analytics/insights").catch(() => null)]);
  if (!topic?.trim() && strat?.topics?.length) topic = pick(strat.topics);
  const proven = (ins?.topHashtags || []).slice(0, 6).map((t) => t.tag);
  const words = (ins?.topKeywords || []).slice(0, 8).map((t) => t.word);
  const prompt = `${ctx.slice(0, 700)}

You write social media posts for ${co.name}${b.motto ? ` (motto: "${b.motto}")` : ""}, a software company. Services: ${b.services}. Audience: ${b.audience}. Tone: ${b.tone}.

Write ONE engaging post about: ${topic?.trim() || pick(TOPICS)}
Content type: ${CATS[cat]}

Rules:
- 500 to 900 characters, friendly professional tone, short paragraphs, 2-4 natural emojis.
- Start with a hook line. ${cat === "promotional" ? "End with a clear call to action (message us / visit our website)." : "End with a soft call to action (a question or an invitation to follow)."}
${b.avoid ? `- Never mention or claim: ${b.avoid}\n` : ""}
- Do NOT invent statistics, client names, awards or milestones.
- Do NOT include phone, email or website (added automatically) and do NOT include hashtags inside the caption.
${words.length ? `- Naturally use some of these keywords that got the most views: ${words.join(", ")}.\n` : ""}${proven.length ? `- Pick hashtags mainly from these proven ones (add 1-2 new): ${proven.join(" ")}.\n` : ""}${strat?.avoid ? `- Strategy says avoid: ${String(strat.avoid).slice(0, 160)}.\n` : ""}- Avoid repeating these recent posts:
${history.slice(-10).map((h) => `  * ${h}`).join("\n") || "  (none)"}

Return ONLY valid JSON, no markdown:
{"caption": "...", "hashtags": ["#Tag1", "#Tag2", "#Tag3", "#Tag4"], "imageKeyword": "2-3 word photo search term"}`;

  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const d = parseJSON(await generateText(prompt, 1400, { task: "draft" }));
      const caption = String(d.caption || "").trim();
      if (caption.length < 40) throw new Error("AI caption too short");
      const hashtags = (Array.isArray(d.hashtags) ? d.hashtags : [])
        .map((h) => "#" + String(h).replace(/[^\p{L}\p{N}_]/gu, ""))
        .filter((h) => h.length > 1)
        .slice(0, 6);
      const merged = [...new Set([...hashtags, ...proven.slice(0, 2)])].slice(0, 6);
      return { caption, hashtags: merged, imageKeyword: String(d.imageKeyword || "").trim() || pick(IMAGE_KEYWORDS) };
    } catch (e) {
      lastErr = e;
    }
  }
  throw httpError(502, `AI could not write a valid post: ${lastErr?.message}`);
}

// Final text that goes on Facebook: caption + hashtags + contact footer
export function composeText({ caption, hashtags = [] }) {
  const co = company();
  const tags = hashtags.length ? `\n\n${hashtags.join(" ")}` : "";
  return `${caption}${tags}\n\n📞 WhatsApp: ${co.whatsapp}\n🌐 ${co.website}\n✉️ ${co.email}`;
}

export async function findImage(keyword) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) throw httpError(500, "UNSPLASH_ACCESS_KEY is not set on the server");
  const url = `https://api.unsplash.com/photos/random?query=${encodeURIComponent(keyword)}&orientation=landscape&client_id=${key}`;
  lg.usage("image", 1, 0);
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d?.urls?.regular) throw httpError(502, `No image found for "${keyword}"`);
  if (d.links?.download_location) {
    const sep = d.links.download_location.includes("?") ? "&" : "?";
    fetch(`${d.links.download_location}${sep}client_id=${key}`).catch(() => {}); // Unsplash API guideline
  }
  return { url: d.urls.regular, credit: `Photo by ${d.user?.name || "Unsplash"} on Unsplash` };
}

export async function downloadImage(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw httpError(502, "Could not download image");
  return Buffer.from(await res.arrayBuffer());
}

export const status = () => ({
  ai: client.configured(),
  unsplash: Boolean(process.env.UNSPLASH_ACCESS_KEY),
});
