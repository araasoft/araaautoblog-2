// Final publishing gate + ambiguity reconciliation. Pure functions so they are easy to test; automation.js calls them
// immediately before every automatic publication (never trust an earlier check).
export function publishGate({ settings: s, counts, env = process.env, item, source = "auto" }) {
  const block = (code, why) => ({ ok: false, code, why });
  if (s.paused) return block("emergency_stop", "Emergency stop is ON");
  if (source === "auto") {
    if (!s.enabled) return block("disabled", "Automation is switched off");
    if (counts) {
      if (counts.today >= s.dailyLimit) return block("daily_limit", `Daily limit reached (${s.dailyLimit})`);
      if (counts.week >= s.weeklyLimit) return block("weekly_limit", `Weekly limit reached (${s.weeklyLimit})`);
    }
  }
  if (s.facebookEnabled !== false && (!env.FB_PAGE_ID || !env.FB_PAGE_TOKEN)) return block("credentials", "Facebook credentials are missing");
  if (item) {
    if (["CANCELLED", "PUBLISHED", "PUBLISHING"].includes(item.processingStatus)) return block("already_done", `Item is ${item.processingStatus}`);
    if (item.verification?.status !== "VERIFIED") return block("unverified", "Source verification has not passed");
    if (!item.quality?.passed || item.quality.overall < (s.researchMinQuality || 0)) return block("quality", "Quality below threshold");
  }
  return { ok: true };
}

// An error is "ambiguous" when the platform may have accepted the request (timeout, reset, 5xx).
export const isAmbiguous = (e) => !e?.status || e.status >= 500 || /timeout|aborted|ECONNRESET|fetch failed/i.test(e?.message || "");
const key = (t) => String(t || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 60);
// listPosts: () => Promise<{data:[{id,message,created_time}]}>
export async function reconcile(text, listPosts, sinceMs) {
  const { data = [] } = await listPosts();
  const k = key(text);
  const hit = k && data.find((p) => key(p.message) === k && (!sinceMs || Date.parse(p.created_time) >= sinceMs - 60_000));
  return hit ? { published: true, postId: hit.id } : { published: false };
}
