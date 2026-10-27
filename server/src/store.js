// App state (settings, plan, drafts, history, LinkedIn connection).
// Reads are synchronous from memory; every change is written through to the database
// (Firebase Realtime Database, or a local file when Firebase is not configured).
import fs from "fs";
import path from "path";
import * as db from "./db.js";

const str = (v, n) => String(v ?? "").trim().slice(0, n);
function cleanBrand(b = {}) {
  const out = {};
  for (const [k, n] of [["name", 80], ["motto", 160], ["website", 200], ["services", 400], ["audience", 300], ["tone", 80], ["avoid", 400]]) if (b[k] !== undefined) out[k] = str(b[k], n);
  if (b.mix) out.mix = Object.fromEntries(["educational", "informational", "promotional"].map((k) => [k, Math.min(100, Math.max(0, Number(b.mix[k]) || 0))]));
  return out;
}

export const DEFAULT_SETTINGS = {
  enabled: true,
  mode: "auto", // "auto" = publish by itself | "approval" = save draft, you approve
  postType: "mixed", // "text" | "image" | "both" | "mixed"
  minPerDay: 2,
  maxPerDay: 3,
  startHour: 9,
  endHour: 21,
  utcOffsetMinutes: Number(process.env.UTC_OFFSET_MINUTES ?? 180),
  linkedinPersonal: false, // automation also posts to your LinkedIn profile
  linkedinCompany: false, // automation also posts to your LinkedIn company page
  newsTopics: ["artificial intelligence", "web development", "mobile apps", "Qatar technology"],
  paused: false, // emergency stop: nothing is posted automatically
  facebookEnabled: true, // automation posts to Facebook
  dailyLimit: 5,
  weeklyLimit: 20,
  brand: {},
  newsInAuto: false, // automation sometimes writes posts based on today's news
  researchEnabled: false, // Phase 2 research agent (stores sources, verifies, queues for the scheduler)
  researchInAuto: false, // scheduler may use verified research items
  researchIntervalMin: 180,
  researchBatch: 5,
  researchMinQuality: 70,
  // Marketing AI autopilot + analytics-driven posting
  aiAutopilot: false, // the AI runs its own cycle: analytics > strategy > adjust times/keywords
  useBestTimes: true, // plan posts at the hours that performed best (needs analytics data)
  analyticsIntervalMin: 60,
  aiDailyTokenCap: 60000, // 0 = no cap. Protects AI cost; autopilot and posts stop using AI when reached
  // Breaking / urgent / update news (automatic, immediate)
  breakingEnabled: false,
  breakingMode: "auto", // "auto" = publish immediately | "approval" = save as draft
  breakingDailyLimit: 3,
  breakingMinGapMin: 30,
  breakingMinSources: 2, // an urgent story is posted only if this many different outlets report it
  breakingScanMin: 10,
  breakingQueries: ["breaking news technology", "urgent cybersecurity alert", "AI model release", "Qatar breaking news"],
  // Email + notifications
  notifyEmails: ["araasoftwares@gmail.com", "sahranrock8@gmail.com"],
  notifyOnEngagement: true, // likes / comments / shares on Facebook (checked every few minutes)
  mailSubscribers: true, // email subscribers when a new post is published
  emailMonthlyCap: 180, // EmailJS free plan = 200 per month; stops sending at this number
};

const FALLBACK = {
  settings: DEFAULT_SETTINGS,
  state: { day: null, jobs: [] },
  drafts: [],
  history: [],
  linkedin: {},
};

const cache = new Map();
const chains = new Map();
const legacyFile = (n) => path.join(path.resolve(process.env.DATA_DIR || "./data"), n + ".json");

// Call once at startup before the server listens.
export async function init() {
  for (const [name, fallback] of Object.entries(FALLBACK)) {
    let v = await db.get(`app/${name}`);
    if (v === null) {
      // First run on the new database: import the old JSON file if there is one.
      try {
        v = JSON.parse(fs.readFileSync(legacyFile(name), "utf8"));
        await db.set(`app/${name}`, v);
      } catch {
        v = null;
      }
    }
    cache.set(name, v ?? structuredClone(fallback));
  }
}

const read = (name) => structuredClone(cache.has(name) ? cache.get(name) : FALLBACK[name]);
function write(name, data) {
  const snap = structuredClone(data);
  cache.set(name, snap);
  const next = (chains.get(name) || Promise.resolve())
    .then(() => db.set(`app/${name}`, snap))
    .catch((e) => console.error(`[db] saving "${name}" failed:`, e.message));
  chains.set(name, next);
}
export const flush = () => Promise.all([...chains.values()]);

const num = (v, min, max, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : d;
};

export function cleanSettings(input = {}) {
  const s = { ...DEFAULT_SETTINGS, ...input };
  const out = {
    enabled: Boolean(s.enabled),
    mode: s.mode === "approval" ? "approval" : "auto",
    postType: ["text", "image", "both", "mixed"].includes(s.postType) ? s.postType : "mixed",
    minPerDay: num(s.minPerDay, 1, 10, 2),
    maxPerDay: num(s.maxPerDay, 1, 10, 3),
    startHour: num(s.startHour, 0, 23, 9),
    endHour: num(s.endHour, 1, 24, 21),
    utcOffsetMinutes: num(s.utcOffsetMinutes, -720, 840, 180),
    linkedinPersonal: Boolean(s.linkedinPersonal),
    linkedinCompany: Boolean(s.linkedinCompany),
    newsTopics: (Array.isArray(s.newsTopics) ? s.newsTopics : DEFAULT_SETTINGS.newsTopics).map((t) => String(t).trim().slice(0, 60)).filter(Boolean).slice(0, 8),
    newsInAuto: Boolean(s.newsInAuto),
    researchEnabled: Boolean(s.researchEnabled),
    researchInAuto: Boolean(s.researchInAuto),
    researchIntervalMin: num(s.researchIntervalMin, 30, 1440, 180),
    researchBatch: num(s.researchBatch, 1, 10, 5),
    researchMinQuality: num(s.researchMinQuality, 50, 100, 70),
    paused: Boolean(s.paused),
    facebookEnabled: s.facebookEnabled !== false,
    dailyLimit: num(s.dailyLimit, 1, 20, 5),
    weeklyLimit: num(s.weeklyLimit, 1, 140, 20),
    brand: cleanBrand(s.brand),
    aiAutopilot: Boolean(s.aiAutopilot),
    useBestTimes: s.useBestTimes !== false,
    analyticsIntervalMin: num(s.analyticsIntervalMin, 15, 1440, 60),
    aiDailyTokenCap: num(s.aiDailyTokenCap, 0, 5_000_000, 60000),
    breakingEnabled: Boolean(s.breakingEnabled),
    breakingMode: s.breakingMode === "approval" ? "approval" : "auto",
    breakingDailyLimit: num(s.breakingDailyLimit, 1, 10, 3),
    breakingMinGapMin: num(s.breakingMinGapMin, 5, 720, 30),
    breakingMinSources: num(s.breakingMinSources, 1, 5, 2),
    breakingScanMin: num(s.breakingScanMin, 5, 120, 10),
    breakingQueries: (Array.isArray(s.breakingQueries) ? s.breakingQueries : DEFAULT_SETTINGS.breakingQueries).map((t) => String(t).trim().slice(0, 80)).filter(Boolean).slice(0, 6),
    notifyEmails: (Array.isArray(s.notifyEmails) ? s.notifyEmails : DEFAULT_SETTINGS.notifyEmails).map((t) => String(t).trim().toLowerCase()).filter((t) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t)).slice(0, 6),
    notifyOnEngagement: s.notifyOnEngagement !== false,
    mailSubscribers: s.mailSubscribers !== false,
    emailMonthlyCap: num(s.emailMonthlyCap, 0, 100000, 180),
  };
  if (out.maxPerDay < out.minPerDay) out.maxPerDay = out.minPerDay;
  if (out.endHour <= out.startHour) out.endHour = Math.min(24, out.startHour + 1);
  return out;
}

export const getSettings = () => cleanSettings(read("settings"));
export const saveSettings = (s) => {
  const clean = cleanSettings(s);
  write("settings", clean);
  return clean;
};

export const getState = () => {
  const s = read("state");
  return { day: s.day ?? null, jobs: s.jobs || [], lastOk: s.lastOk || null }; // Firebase drops empty arrays
};
export const saveState = (s) => write("state", s);

export const getDrafts = () => read("drafts") || [];
export const saveDrafts = (d) => write("drafts", d);

export const getHistory = () => read("history") || [];
export const pushHistory = (text) => {
  const h = getHistory();
  h.push(String(text || "").replace(/\s+/g, " ").slice(0, 120));
  write("history", h.slice(-30));
};

// LinkedIn connection (access token, member URN). Kept in the database, readable only by this server.
export const getLinkedIn = () => read("linkedin") || {};
export const saveLinkedIn = (d) => write("linkedin", d);
