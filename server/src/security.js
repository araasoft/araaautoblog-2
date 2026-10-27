// Security helpers: secret redaction, security headers, in-memory rate limiting, CSV escaping, config validation.
const SECRET_ENV = ["FB_PAGE_TOKEN", "GROQ_API_KEY", "UNSPLASH_ACCESS_KEY", "LI_CLIENT_SECRET", "LI_ACCESS_TOKEN", "FIREBASE_SERVICE_ACCOUNT", "FIREBASE_WEB_API_KEY", "API_KEY", "ALERT_WEBHOOK_URL", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "OPENAI_API_KEY", "AI_CUSTOM_API_KEY", "EMAILJS_PRIVATE_KEY", "EMAILJS_PUBLIC_KEY"];
const PATTERNS = [/access_token=[^&\s"']+/gi, /Bearer\s+[A-Za-z0-9._~+\/-]{12,}/g, /(api[_-]?key|token|secret|password)["']?\s*[:=]\s*["']?[^\s"',}]{6,}/gi, /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, /gsk_[A-Za-z0-9]{16,}/g, /EAA[A-Za-z0-9]{20,}/g];
export function redact(input) {
  let s = typeof input === "string" ? input : (() => { try { return JSON.stringify(input); } catch { return String(input); } })();
  for (const k of SECRET_ENV) { const v = process.env[k]; if (v && v.length >= 8) s = s.split(v).join("[REDACTED]"); }
  for (const p of PATTERNS) s = s.replace(p, (m) => (m.includes("=") || m.includes(":") ? m.split(/[=:]/)[0] + "=[REDACTED]" : "[REDACTED]"));
  return s;
}

const PAGE_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";
const API_CSP = "default-src 'none'; frame-ancestors 'none'";
export function securityHeaders(req, res, next) {
  res.removeHeader("X-Powered-By");
  res.set({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer", "Cross-Origin-Opener-Policy": "same-origin", "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()", "X-DNS-Prefetch-Control": "off", "X-Permitted-Cross-Domain-Policies": "none" });
  if (req.secure) res.set("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  const api = req.path.startsWith("/api");
  res.set("Content-Security-Policy", api ? API_CSP : PAGE_CSP);
  if (api) res.set("Cache-Control", "no-store");
  next();
}

// Sliding-window limiter keyed by IP (+ user when known). In-memory: per process (documented limitation).
export function rateLimit({ windowMs = 60_000, max = 120, key = (req) => req.ip + "|" + (req.claims?.uid || ""), now = () => Date.now() } = {}) {
  const hits = new Map();
  return (req, res, next) => {
    const k = key(req), t = now(), arr = (hits.get(k) || []).filter((x) => t - x < windowMs);
    if (arr.length >= max) { res.set("Retry-After", String(Math.ceil(windowMs / 1000))); return res.status(429).json({ error: "Too many requests - slow down", code: "rate_limited" }); }
    arr.push(t); hits.set(k, arr);
    if (hits.size > 5000) for (const [kk, v] of hits) if (!v.some((x) => t - x < windowMs)) hits.delete(kk);
    next();
  };
}

// Server-side role gate. Roles: pending < admin < super.
export const RANK = { pending: 0, guest: 0, admin: 1, super: 2 };
export const requireRole = (role) => (req, res, next) => (RANK[req.user?.role] >= RANK[role] ? next() : res.status(403).json({ error: `Requires ${role} role`, code: "forbidden" }));

export function csvCell(v) {
  let s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // spreadsheet formula injection guard
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export const toCsv = (cols, rows) => [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\r\n") + "\r\n";

export function validateConfig(env = process.env) {
  const errors = [], warnings = [];
  const port = env.PORT === undefined ? 3000 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push("PORT must be 1-65535");
  const fbSet = ["FIREBASE_WEB_API_KEY", "FIREBASE_DATABASE_URL", "FIREBASE_SERVICE_ACCOUNT"].filter((k) => env[k]);
  if (fbSet.length && fbSet.length < 3) errors.push("Firebase is partly configured: set all of FIREBASE_WEB_API_KEY, FIREBASE_DATABASE_URL, FIREBASE_SERVICE_ACCOUNT");
  if (!fbSet.length) warnings.push("Firebase not configured: dashboard sign-in is unavailable (all /api requests return 503)");
  if (!env.FB_PAGE_ID || !env.FB_PAGE_TOKEN) warnings.push("FB_PAGE_ID/FB_PAGE_TOKEN missing: Facebook publishing is blocked by the publishing gate");
  if (!["GROQ_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY", "OPENAI_API_KEY", "AI_CUSTOM_API_KEY"].some((k) => env[k])) warnings.push("No AI key set (GROQ_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY or OPENAI_API_KEY): AI features are unavailable");
  if (!env.EMAILJS_SERVICE_ID || !env.EMAILJS_TEMPLATE_ID || !env.EMAILJS_PUBLIC_KEY) warnings.push("EmailJS not configured: no alert or subscriber emails will be sent (in-app notifications still work)");
  if (env.AI_BUDGET_USD_MONTH && !(Number(env.AI_BUDGET_USD_MONTH) > 0)) errors.push("AI_BUDGET_USD_MONTH must be a positive number");
  if (env.ALERT_WEBHOOK_URL && !/^https:\/\//.test(env.ALERT_WEBHOOK_URL)) errors.push("ALERT_WEBHOOK_URL must be https");
  const origins = String(env.ORIGINS || env.ORGINS || "").split(/[\s,]+/).filter(Boolean);
  for (const o of origins) {
    if (o === "*") { errors.push('ORIGINS must list exact origins, "*" is not allowed'); continue; }
    try { const u = new URL(o); if (!/^https?:$/.test(u.protocol) || u.origin !== o.replace(/\/+$/, "")) errors.push(`ORIGINS: "${o}" must look like https://host[:port] (no path)`); }
    catch { errors.push(`ORIGINS: "${o}" is not a valid origin`); }
  }
  if (!origins.length) warnings.push("ORIGINS not set: only same-origin browsers can call the API (set ORIGINS for a separately hosted dashboard)");
  return { errors, warnings };
}
