// Guest (view-only) role, CORS allow-list and security headers. No network or Firebase needed.
import assert from "node:assert/strict";
import { ROLES, can, need, permList, isStaff, isReadOnly, guestAllowed, guestGuard } from "./src/roles.js";
import { cors, parseOrigins, originProblems } from "./src/cors.js";
import { securityHeaders, validateConfig } from "./src/security.js";

let n = 0; const ok = (name, fn) => { fn(); n++; console.log("ok -", name); };
const res = () => { const r = { h: {}, code: 200, body: null, ended: false }; r.set = (a, b) => { typeof a === "object" ? Object.assign(r.h, a) : (r.h[a] = b); return r; }; r.removeHeader = () => r; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; r.ended = true; return r; }; r.end = () => { r.ended = true; return r; }; return r; };
const run = (mw, req) => { const r = res(); let nexted = false; mw({ method: "GET", path: "/", ...req, get: (k) => ({ origin: req.origin, host: req.host })[k.toLowerCase()] }, r, () => { nexted = true; }); return { r, nexted }; };

ok("guest role exists, is staff, read-only and has only view permissions", () => {
  assert.ok(ROLES.guest && isStaff("guest") && isReadOnly("guest") && !isReadOnly("manager"));
  assert.deepEqual(permList("guest"), ["analytics.view", "news.view"]);
  for (const p of ["post.create", "post.edit", "post.delete", "settings.edit", "users.view", "users.manage", "mail.manage", "automation.control", "ai.use", "activity.view", "export", "draft.approve", "engage.reply"]) assert.equal(can("guest", p), false, p);
});
ok("guest can read only the allowed GET endpoints", () => {
  for (const p of ["/me", "/status", "/records", "/posts", "/scheduled", "/analytics", "/news", "/engagement/123_45"]) assert.ok(guestAllowed("GET", p), p);
  for (const p of ["/settings", "/drafts", "/alerts", "/notifications", "/admins", "/ai/overview", "/activity", "/mail/subscribers", "/research", "/integrity", "/ai-usage", "/export/activity.csv"]) assert.ok(!guestAllowed("GET", p), p);
  for (const m of ["POST", "PUT", "DELETE"]) assert.ok(!guestAllowed(m, "/records"), m);
});
ok("guestGuard blocks guest writes/forbidden reads with 403 guest_readonly, lets staff through", () => {
  let o = run(guestGuard, { user: { role: "guest" }, method: "POST", path: "/publish" });
  assert.equal(o.r.code, 403); assert.equal(o.r.body.code, "guest_readonly"); assert.equal(o.nexted, false);
  o = run(guestGuard, { user: { role: "guest" }, method: "GET", path: "/analytics" }); assert.ok(o.nexted);
  o = run(guestGuard, { user: { role: "manager" }, method: "POST", path: "/publish" }); assert.ok(o.nexted);
});
ok("need() still denies guest on write permissions", () => {
  const o = run(need("post.create"), { user: { role: "guest" } }); assert.equal(o.r.code, 403);
});
ok("ORIGINS parsing accepts ORGINS alias and trims slashes", () => {
  assert.deepEqual(parseOrigins({ ORGINS: "http://localhost:5173, https://araaposts.web.app/" }), ["http://localhost:5173", "https://araaposts.web.app"]);
  assert.deepEqual(parseOrigins({ ORIGINS: "https://a.com", ORGINS: "https://b.com" }), ["https://a.com"]);
});
ok("origin validation rejects *, paths and junk", () => {
  assert.equal(originProblems(["http://localhost:5173", "https://araaposts.web.app"]).length, 0);
  assert.ok(originProblems(["*"]).length && originProblems(["https://a.com/path"]).length && originProblems(["nope"]).length);
  assert.ok(validateConfig({ ORIGINS: "*" }).errors.some((e) => /ORIGINS/.test(e)));
  assert.equal(validateConfig({ ORIGINS: "https://araaposts.web.app" }).errors.filter((e) => /ORIGINS/.test(e)).length, 0);
});
const mw = cors({ ORIGINS: "http://localhost:5173,https://araaposts.web.app" });
ok("CORS: listed origin gets headers, no credentials", () => {
  const { r, nexted } = run(mw, { origin: "https://araaposts.web.app", host: "api.example.com" });
  assert.ok(nexted); assert.equal(r.h["Access-Control-Allow-Origin"], "https://araaposts.web.app"); assert.equal(r.h["Vary"], "Origin");
  assert.ok(!("Access-Control-Allow-Credentials" in r.h)); assert.match(r.h["Access-Control-Allow-Headers"], /Authorization/);
});
ok("CORS: preflight answered 204 before auth", () => {
  const { r, nexted } = run(mw, { method: "OPTIONS", origin: "http://localhost:5173", host: "x" });
  assert.equal(r.code, 204); assert.equal(nexted, false);
});
ok("CORS: unlisted origin refused (403), also on preflight", () => {
  let o = run(mw, { origin: "https://evil.example", host: "x" }); assert.equal(o.r.code, 403); assert.equal(o.nexted, false); assert.ok(!o.r.h["Access-Control-Allow-Origin"]);
  o = run(mw, { method: "OPTIONS", origin: "https://evil.example", host: "x" }); assert.equal(o.r.code, 403);
});
ok("CORS: same-origin and no-Origin requests pass without CORS headers", () => {
  let o = run(mw, { origin: "https://api.example.com", host: "api.example.com" }); assert.ok(o.nexted); assert.ok(!o.r.h["Access-Control-Allow-Origin"]);
  o = run(mw, {}); assert.ok(o.nexted);
});
ok("CORS: with ORIGINS unset every foreign origin is refused", () => {
  const o = run(cors({}), { origin: "http://localhost:5173", host: "x" }); assert.equal(o.r.code, 403);
});
ok("security headers: API gets no-store + locked CSP, HSTS only over https", () => {
  let o = run(securityHeaders, { path: "/api/me", secure: true });
  assert.equal(o.r.h["Cache-Control"], "no-store"); assert.match(o.r.h["Content-Security-Policy"], /default-src 'none'/); assert.match(o.r.h["Strict-Transport-Security"], /max-age/);
  assert.equal(o.r.h["X-Frame-Options"], "DENY");
  o = run(securityHeaders, { path: "/", secure: false }); assert.ok(!o.r.h["Strict-Transport-Security"]); assert.match(o.r.h["Content-Security-Policy"], /frame-ancestors 'none'/);
});
console.log(`\n${n} checks passed`);
