// Marketing agent: one compact AI call per request.
import * as ai from "./ai.js";
import * as news from "./news.js";
import { httpError } from "./facebook.js";

const TASKS = {
  calendar: "Create a 7-day content calendar for Facebook and LinkedIn. For each day give: platform(s), post type (text/image/both), topic, hook line and call to action.",
  ideas: "Give 8 practical campaign and content ideas, each with one line on why it works.",
  caption: "Rewrite the draft below as two versions: one for Facebook (friendly, a few emojis) and one for LinkedIn (professional). Add 5 hashtags for each.",
  seo: "Give 10 keywords (mix of short and long-tail, include local Qatar / Sri Lanka ones where relevant), 10 hashtags and 3 SEO tips.",
  strategy: "Write a short marketing strategy: target audience, positioning, best channels, 3 quick wins this week, and how to measure results.",
  ads: "Write 3 ad copy variants, each with headline, body and call to action.",
  chat: "Answer the question as a marketing expert.",
};

export async function run({ task, input, prev, useNews }) {
  const t = TASKS[task] ? task : "chat";
  const text = String(input || "").trim().slice(0, 3000);
  if ((t === "caption" || t === "chat") && !text) throw httpError(400, "Type your draft or question first");
  const co = ai.company();
  let ctx = "";
  if (useNews) {
    const b = await news.getBrief().catch(() => null);
    if (b?.summary) ctx = `\nToday's news context: ${b.summary}\n`;
  }
  const prompt = `You are a senior digital marketing, SEO and social media strategist for ${co.name}, a software company in Qatar and Sri Lanka (web development, mobile apps, AI automation, startup solutions). Website: ${co.website}.
Be practical and concise. Never invent statistics, clients or awards. Plain text only: short sections, no markdown tables, no ** or # symbols.${ctx}
${prev ? `\nPrevious answer (for follow-up):\n${String(prev).slice(0, 1500)}\n` : ""}
Task: ${TASKS[t]}
${text ? `Input: ${text}` : ""}`;
  const out = await ai.generateText(prompt, 1500, { task: "other" });
  return { text: out.replace(/\*\*/g, "").replace(/^#+\s*/gm, "").trim() };
}
