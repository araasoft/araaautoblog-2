// Repeatable, non-destructive migrations. Each step is idempotent; a backup (without credentials) is written before changes.
import fs from "fs";
import path from "path";
import * as db from "./db.js";
import { STATES, validateRecord } from "./research.js";

export const SCHEMA_VERSION = 7;
const SKIP = new Set(["linkedin"]); // app/linkedin holds tokens: never exported

export async function backup(dir = path.resolve(process.env.DATA_DIR || "./data", "backups")) {
  const out = {};
  for (const root of ["app", "research", "logs", "usage", "alerts", "stats", "posts"]) {
    const v = await db.get(root); if (v == null) continue;
    if (root === "app") out.app = Object.fromEntries(Object.entries(v).filter(([k]) => !SKIP.has(k)));
    else out[root] = v;
  }
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(out), { mode: 0o600 });
  return file;
}

const STEPS = [
  { id: 7, name: "research records: attempts/history fields", async run() {
    const raw = (await db.get("research")) || {}; let n = 0;
    for (const [k, r] of Object.entries(raw)) {
      if (!r || typeof r !== "object" || !STATES.includes(r.processingStatus) && r.processingStatus !== "NEW") continue;
      const next = { ...r, attempts: r.attempts ?? 0, history: r.history ?? [] };
      if (JSON.stringify(next) !== JSON.stringify(r)) { await db.set(`research/${k}`, next); n++; }
    }
    return n;
  } },
];
export async function migrate({ doBackup = true } = {}) {
  const cur = (await db.get("app/schemaVersion"))?.v || 0, applied = [];
  const todo = STEPS.filter((s) => s.id > cur);
  if (!todo.length) return { applied, from: cur, to: cur };
  const file = doBackup ? await backup() : null;
  for (const s of todo) { const n = await s.run(); applied.push(`${s.id}:${s.name} (${n} records)`); await db.set("app/schemaVersion", { v: s.id, at: Date.now() }); }
  return { applied, from: cur, to: SCHEMA_VERSION, backup: file };
}
export const checkRecords = validateRecord;
