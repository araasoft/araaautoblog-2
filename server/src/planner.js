// Pure scheduling logic (no dependencies) so it can be tested on its own.
const MIN = 60000;

export const dayKey = (ms, offMin) => new Date(ms + offMin * MIN).toISOString().slice(0, 10);
export const midnightUtc = (key, offMin) => Date.parse(`${key}T00:00:00Z`) - offMin * MIN;

export function pickType(postType, rand = Math.random) {
  if (postType === "text" || postType === "image" || postType === "both") return postType;
  const r = rand(); // "mixed"
  return r < 0.5 ? "both" : r < 0.75 ? "text" : "image";
}

// Returns [{ at: <ms>, type }] - random times spread across the posting window.
// preferredHours: local hours ordered best-first (from analytics). Posts go at those hours (random minute), at least 60 min apart.
export function planDay({ now, settings, alreadyDone = 0, rand = Math.random, preferredHours }) {
  const off = settings.utcOffsetMinutes;
  const mid = midnightUtc(dayKey(now, off), off);
  const endMs = mid + settings.endHour * 60 * MIN;
  const lo = Math.max(mid + settings.startHour * 60 * MIN, now + 2 * MIN);
  const span = endMs - lo;
  if (span < 45 * MIN) return [];

  const { minPerDay: a, maxPerDay: b } = settings;
  let count = a + Math.floor(rand() * (b - a + 1)) - alreadyDone;
  if (count <= 0) return [];
  count = Math.min(count, Math.max(1, Math.floor(span / (60 * MIN))));

  if (preferredHours?.length) {
    const hrs = preferredHours.filter((h) => { const t = mid + h * 60 * MIN; return h >= settings.startHour && h < settings.endHour && t + 50 * MIN > lo; });
    const picked = [];
    for (const h of hrs) {
      if (picked.length >= count) break;
      if (picked.every((x) => Math.abs(x - h) >= 1)) picked.push(h);
    }
    if (picked.length) {
      const times = picked.map((h) => Math.max(lo, mid + h * 60 * MIN + Math.floor(rand() * 45) * MIN)).sort((a, b) => a - b);
      // not enough good hours left today: fill the rest with the normal random spread
      const rest = count - times.length;
      const extra = rest > 0 ? Array.from({ length: rest }, (_, i) => Math.round(lo + (span / rest) * i + (span / rest) * (0.1 + 0.8 * rand()))) : [];
      return [...times, ...extra].sort((a, b) => a - b).map((at) => ({ at, type: pickType(settings.postType, rand) }));
    }
  }
  const seg = span / count; // one post per segment => posts never bunch together
  return Array.from({ length: count }, (_, i) => ({
    at: Math.round(lo + seg * i + seg * (0.1 + 0.8 * rand())),
    type: pickType(settings.postType, rand),
  }));
}
