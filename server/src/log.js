// Activity log + AI usage counters (kept in the database: logs/<id>, usage/<day>)
import crypto from "crypto";
import * as db from "./db.js";
import { redact, toCsv } from "./security.js";

const id = () => String(Date.now()).padStart(13, "0") + "-" + crypto.randomBytes(2).toString("hex");
const day = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

// type: publish | error | skipped | settings | stop | news | draft | post
export function record(type, message, by, extra = {}) {
  // message is redacted so tokens/keys never reach the log; extra: {status, jobId, refId, url, code}
  const e = {}; for (const k of ["status", "jobId", "refId", "url", "code"]) if (extra[k] != null) e[k] = redact(String(extra[k])).slice(0, 200);
  db.set(`logs/${id()}`, { at: Date.now(), type, message: redact(message).slice(0, 300), by: by?.name || "System", ...e }).catch((err) => console.error("[log] write failed:", err.message));
}
export const levelOf = (r) => (r.type === "error" || r.status === "error" ? "error" : ["skipped", "stop", "cancel", "alert"].includes(r.type) ? "warning" : "info");
// Server-side filtering + stable ordering (timestamp-prefixed ids) + pagination. Scans at most `scan` newest entries (bounded).
export function filterRows(rows, { q, type, level, from, to, sort = "desc", page = 1, pageSize = 25 } = {}) {
  pageSize = Math.min(100, Math.max(1, Number(pageSize) || 25)); page = Math.max(1, Number(page) || 1);
  const needle = String(q || "").toLowerCase().slice(0, 80);
  let r = rows.filter((x) => (!type || x.type === type) && (!level || levelOf(x) === level) && (!from || x.at >= from) && (!to || x.at <= to) && (!needle || (x.message + " " + x.type + " " + (x.refId || "")).toLowerCase().includes(needle)));
  r.sort((a, b) => (sort === "asc" ? 1 : -1) * (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { total: r.length, page, pageSize, pages: Math.max(1, Math.ceil(r.length / pageSize)), rows: r.slice((page - 1) * pageSize, page * pageSize).map((x) => ({ ...x, level: levelOf(x) })) };
}
export async function query(opts = {}, scan = 2000) { return filterRows(await recent(scan), opts); }
export async function exportCsv(opts = {}, max = 5000) {
  const full = (await recent(Math.min(max, 5000))).filter((x) => filterRows([x], opts).total).map((x) => ({ ...x, time: new Date(x.at).toISOString(), level: levelOf(x) }));
  return toCsv(["time", "type", "level", "status", "message", "by", "refId", "jobId", "url", "code"], full);
}
export async function recent(limit = 60) {
  const raw = (await db.get("logs", { limitToLast: limit })) || {};
  return Object.entries(raw).sort(([a], [b]) => b.localeCompare(a)).map(([k, r]) => ({ id: k, ...r }));
}

export async function usage(kind, calls = 1, tokens = 0) {
  const p = `usage/${day()}`;
  try {
    const cur = (await db.get(p)) || {};
    await db.set(p, { ...cur, [kind]: (cur[kind] || 0) + calls, tokens: (cur.tokens || 0) + tokens });
  } catch {
    /* counters are best-effort */
  }
}
export async function usageSummary() {
  const raw = (await db.get("usage", { limitToLast: 30 })) || {};
  const sum = (from) => Object.entries(raw).filter(([k]) => k >= from).reduce((a, [, v]) => ({ ai: a.ai + (v.ai || 0), image: a.image + (v.image || 0), tokens: a.tokens + (v.tokens || 0) }), { ai: 0, image: 0, tokens: 0 });
  const back = (n) => day(Date.now() - n * 864e5);
  const rate = Number(process.env.AI_COST_PER_MTOK ?? 0.4); // rough blended USD per 1M tokens - an estimate only
  const fin = (o) => ({ ...o, estCost: +((o.tokens / 1e6) * rate).toFixed(4) });
  return { today: fin(sum(day())), week: fin(sum(back(6))), month: fin(sum(back(29))), rate };
}
