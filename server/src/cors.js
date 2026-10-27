// CORS allow-list. Origins come from ORIGINS (comma separated, e.g. http://localhost:5173,https://araaposts.web.app).
// "ORGINS" is accepted as an alias. Same-origin requests always work; any other origin must be listed exactly.
// Auth uses Bearer tokens (no cookies), so credentials are never enabled.
export function parseOrigins(env = process.env) {
  return String(env.ORIGINS || env.ORGINS || "")
    .split(/[\s,]+/)
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

export function originProblems(list) {
  const bad = [];
  for (const o of list) {
    if (o === "*") { bad.push('"*" is not allowed - list each origin'); continue; }
    try {
      const u = new URL(o);
      if (!/^https?:$/.test(u.protocol) || u.origin !== o) bad.push(`"${o}" must look like https://host[:port] (no path)`);
    } catch { bad.push(`"${o}" is not a valid origin`); }
  }
  return bad;
}

export function cors(env = process.env) {
  const allowed = new Set(parseOrigins(env));
  return (req, res, next) => {
    const origin = req.get("origin");
    if (!origin) return next();
    const sameOrigin = (() => { try { return new URL(origin).host === req.get("host"); } catch { return false; } })();
    if (!sameOrigin && !allowed.has(origin)) {
      if (req.method === "OPTIONS") return res.status(403).end();
      return res.status(403).json({ error: "Origin not allowed", code: "cors" });
    }
    res.set("Vary", "Origin");
    if (!sameOrigin) {
      res.set({
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "600",
      });
    }
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  };
}
