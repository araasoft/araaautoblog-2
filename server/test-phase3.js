// Phase 3 tests. ALL external services are mocked. Nothing here proves live Facebook / AI / news behaviour.
import assert from "assert";
import fs from "fs";
process.env.DATA_DIR = "./data/_test_p3"; for (const k of ["FIREBASE_SERVICE_ACCOUNT", "FIREBASE_DATABASE_URL"]) delete process.env[k];
fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
process.env.FB_PAGE_ID = "123"; process.env.FB_PAGE_TOKEN = "test-token-not-real-0000";
const t = (n, f) => f().then(() => console.log("  ok -", n), (e) => { console.error("FAIL -", n); throw e; });
const sec = await import("./src/security.js"), gate = await import("./src/gate.js"), life = await import("./src/lifecycle.js");
const R = await import("./src/research.js"), U = await import("./src/usage.js"), A = await import("./src/alerts.js"), L = await import("./src/log.js");
const rr = await import("./src/research-run.js"), M = await import("./src/migrate.js"), db = await import("./src/db.js");
const store = await import("./src/store.js"); await store.init();
const S = { ...store.DEFAULT_SETTINGS, enabled: true, paused: false, facebookEnabled: true, newsTopics: ["artificial intelligence"] };
const ENV = { FB_PAGE_ID: "1", FB_PAGE_TOKEN: "x".repeat(20) };

await t("secret redaction", async () => {
  process.env.GROQ_API_KEY = "gsk_" + "a".repeat(30);
  const out = sec.redact(`failed https://g.x/?access_token=EAAB${"z".repeat(30)} key=${process.env.GROQ_API_KEY} Bearer abcdefghijklmnop12345`);
  assert.ok(!/EAAB|gsk_a|abcdefghijklmnop/.test(out), out);
  assert.ok(!sec.redact({ password: "hunter2hunter2" }).includes("hunter2"));
});
await t("config validation", async () => {
  assert.ok(sec.validateConfig({ PORT: "abc" }).errors.length);
  assert.ok(sec.validateConfig({ FIREBASE_WEB_API_KEY: "k" }).errors.some((e) => /partly/.test(e)));
  assert.ok(sec.validateConfig({}).warnings.length >= 2);
  assert.ok(sec.validateConfig({ ALERT_WEBHOOK_URL: "http://x" }).errors.length);
});
await t("role gate (server-side)", async () => {
  const run = (role, need) => { let st = 200; const res = { status: (c) => ({ json: () => (st = c) }) }; sec.requireRole(need)({ user: role && { role } }, res, () => (st = "next")); return st; };
  assert.equal(run("super", "super"), "next"); assert.equal(run("admin", "admin"), "next");
  assert.equal(run("admin", "super"), 403); assert.equal(run("pending", "admin"), 403); assert.equal(run(undefined, "admin"), 403);
});
await t("rate limiter", async () => {
  let now = 0; const rl = sec.rateLimit({ max: 3, windowMs: 1000, key: () => "k", now: () => now }); let blocked = 0;
  const res = { set() {}, status: () => ({ json: () => blocked++ }) };
  for (let i = 0; i < 5; i++) rl({}, res, () => {}); assert.equal(blocked, 2);
  now = 2000; let ok = 0; rl({}, res, () => ok++); assert.equal(ok, 1);
});
await t("CSV escaping + formula injection", async () => {
  assert.equal(sec.csvCell('a,"b"'), '"a,""b"""'); assert.equal(sec.csvCell("=cmd|x"), "'=cmd|x"); assert.equal(sec.csvCell(null), "");
});
await t("publish gate: stop, pause, limits, credentials, item state", async () => {
  const c = { today: 0, week: 0 };
  assert.ok(gate.publishGate({ settings: S, counts: c, env: ENV }).ok);
  assert.equal(gate.publishGate({ settings: { ...S, paused: true }, counts: c, env: ENV }).code, "emergency_stop");
  assert.equal(gate.publishGate({ settings: { ...S, enabled: false }, counts: c, env: ENV }).code, "disabled");
  assert.equal(gate.publishGate({ settings: S, counts: { today: S.dailyLimit, week: 0 }, env: ENV }).code, "daily_limit");
  assert.equal(gate.publishGate({ settings: S, counts: { today: 0, week: S.weeklyLimit }, env: ENV }).code, "weekly_limit");
  assert.equal(gate.publishGate({ settings: S, counts: c, env: {} }).code, "credentials");
  const item = { processingStatus: "CLAIMED", verification: { status: "VERIFIED" }, quality: { passed: true, overall: 90 } };
  assert.ok(gate.publishGate({ settings: S, counts: c, env: ENV, item }).ok);
  assert.equal(gate.publishGate({ settings: S, counts: c, env: ENV, item: { ...item, processingStatus: "CANCELLED" } }).code, "already_done");
  assert.equal(gate.publishGate({ settings: S, counts: c, env: ENV, item: { ...item, verification: { status: "CONFLICTING_EVIDENCE" } } }).code, "unverified");
  assert.equal(gate.publishGate({ settings: S, counts: c, env: ENV, item: { ...item, quality: { passed: true, overall: 10 } } }).code, "quality");
  assert.ok(gate.publishGate({ settings: S, counts: { today: 99, week: 99 }, env: ENV, source: "manual" }).ok, "manual follows existing policy (no caps)");
  assert.equal(gate.publishGate({ settings: { ...S, paused: true }, env: ENV, source: "manual" }).code, "emergency_stop");
});
await t("ambiguous publish reconciliation", async () => {
  assert.ok(gate.isAmbiguous(new Error("fetch failed"))); assert.ok(gate.isAmbiguous(Object.assign(new Error("x"), { status: 502 })));
  assert.ok(!gate.isAmbiguous(Object.assign(new Error("bad"), { status: 400 })));
  const posts = { data: [{ id: "9_1", message: "Hello   World from Araa", created_time: new Date().toISOString() }] };
  assert.deepEqual(await gate.reconcile("hello world from araa", async () => posts, Date.now() - 1000), { published: true, postId: "9_1" });
  assert.equal((await gate.reconcile("other text", async () => posts)).published, false);
  await assert.rejects(gate.reconcile("x", async () => { throw new Error("down"); }));
});
await t("state machine + record validation", async () => {
  const rec = { id: "00000000-0000-0000-0000-000000000001", sourceTitle: "t", processingStatus: "NEW", retrievedAt: 1 };
  assert.throws(() => R.setStatus(rec, "PUBLISHED"), /illegal/);
  R.setStatus(rec, "REJECTED"); assert.throws(() => R.setStatus(rec, "QUEUED"), /illegal/);
  assert.ok(R.validateRecord({ ...rec, processingStatus: "QUEUED" }).length, "QUEUED needs verification+quality");
  assert.ok(R.validateRecord({ ...rec, id: "x" }).length);
});
await t("conflicting evidence vs change over time", async () => {
  const mk = (n, d, pub) => ({ url: "https://s" + n + ".com/a", publisher: "P" + n, publishedAt: pub, primary: false, text: `Acme framework release now supports ${d} plugins in the new version` });
  const day = 864e5, now = Date.now();
  const same = R.verifyClaims([{ text: "Acme framework release supports 50 plugins", important: true }], [mk(1, 50, now - day), mk(2, 80, now - day)], { now });
  assert.equal(same.status, "CONFLICTING_EVIDENCE"); assert.match(same.claims[0].reason, /disagree/);
  const later = R.verifyClaims([{ text: "Acme framework release supports 80 plugins", important: true }], [mk(1, 50, now - 30 * day), mk(2, 80, now - day)], { now });
  assert.notEqual(later.status, "CONFLICTING_EVIDENCE", "30 days apart = change over time");
  assert.equal(later.claims[0].conflicts[0].kind, "CHANGED_OVER_TIME");
  const noev = R.verifyClaims([{ text: "Zeta quantum chip ships", important: true }], [mk(1, 50, now)], { now });
  assert.match(noev.claims[0].reason, /not evidence the claim is false/);
});
await t("conflicting evidence blocks publishing end-to-end", async () => {
  const good = "Acme framework release supports 50 plugins in the new version. Teams can upgrade this week and plan ahead. Want help? Message us today.";
  const deps = { existing: async () => [], history: async () => [], writeDraft: async () => ({ text: good + " Builders get a simpler upgrade path and clearer docs for the whole release." }),
    extractClaims: async () => [{ text: "Acme framework release supports 50 plugins", important: true }], fetchEvidence: async () => ({ url: "https://a.com/1", publisher: "A", text: "Acme framework release now supports 50 plugins in the new version" }),
    relatedEvidence: async () => [{ url: "https://b.com/1", publisher: "B", text: "Acme framework release now supports 80 plugins in the new version" }] };
  const r = await R.processCandidate({ title: "Acme artificial intelligence framework release", url: "https://a.com/1", publisher: "A", publishedAt: Date.now() - 864e5 }, deps, S);
  assert.equal(r.processingStatus, "NEEDS_REVIEW"); assert.equal(r.verification.status, "CONFLICTING_EVIDENCE");
  assert.equal(await R.claimNext(S), null);
});
await t("unique URL index blocks duplicate queue records", async () => {
  const deps = { existing: async () => [], history: async () => [], writeDraft: async () => ({ text: "x" }), extractClaims: async () => [], fetchEvidence: async () => { throw Object.assign(new Error("boom"), { status: 503 }); } };
  const c = { title: "Unique artificial intelligence story", url: "https://u.com/story" };
  const a = await R.processCandidate(c, deps, S), b = await R.processCandidate(c, deps, S);
  assert.equal(a.processingStatus, "SOURCE_UNAVAILABLE"); assert.ok(a.retry.retryable && a.retry.nextAt > Date.now());
  assert.equal(b.processingStatus, "DUPLICATE");
});
await t("retry policy: permanent vs transient, bounded attempts", async () => {
  const mk = (e) => ({ existing: async () => [], history: async () => [], writeDraft: async () => ({}), extractClaims: async () => [], fetchEvidence: async () => { throw e; } });
  const p = await R.processCandidate({ title: "artificial intelligence perm", url: "https://p.com/1" }, mk(Object.assign(new Error("gone"), { status: 404 })), S);
  assert.equal(p.retry.retryable, false);
  const last = await R.processCandidate({ title: "artificial intelligence last", url: "https://p.com/2", attempts: R.MAX_ATTEMPTS - 1 }, mk(Object.assign(new Error("down"), { status: 503 })), S);
  assert.ok(last.retry.exhausted && !last.retry.retryable);
  assert.ok(!(await R.retryDue(Date.now() + 99 * 864e5)).some((r) => r.id === p.id || r.id === last.id));
});
// a queued item for the lifecycle tests
const good = "Acme framework release supports 50 plugins in the new version. Teams can upgrade this week and plan ahead. Want help? Message us today.";
const queue = async (url) => R.processCandidate({ title: "Acme artificial intelligence update " + url, url, publisher: "A", publishedAt: Date.now() - 20 * 36e5 },
  { existing: async () => [], history: async () => [], writeDraft: async () => ({ text: good + " Builders get a simpler upgrade path and clearer docs for the whole release." }), extractClaims: async () => [{ text: "Acme framework release supports 50 plugins", important: true }],
    fetchEvidence: async () => ({ url, publisher: "A", text: "Acme framework release now supports 50 plugins in the new version" }) }, S);
await t("concurrent claim, stop/pause leave queue intact, cancel", async () => {
  const q = await queue("https://q.com/1"); assert.equal(q.processingStatus, "QUEUED");
  assert.equal(await R.claimNext({ ...S, paused: true }), null); assert.equal(await R.claimNext({ ...S, facebookEnabled: false }), null);
  assert.equal((await R.getRecord(q.id)).processingStatus, "QUEUED");
  const [a, b] = await Promise.all([R.claimNext(S), R.claimNext(S)]); assert.ok(a && !b);
  await R.cancelItem(a.id); assert.equal((await R.getRecord(a.id)).processingStatus, "CANCELLED");
  const g = await R.beginPublish(a.id, S, { today: 0, week: 0 }); assert.equal(g.ok, false, "cancelled item can never be published");
});
await t("publish lifecycle, gate re-check, failure never auto-retried", async () => {
  const q = await queue("https://q.com/2"); const c = await R.claimNext(S);
  assert.equal((await R.beginPublish(c.id, { ...S, paused: true }, { today: 0, week: 0 })).code, "emergency_stop", "stop pressed after claim");
  assert.equal((await R.getRecord(q.id)).processingStatus, "NEEDS_REVIEW");
  const q2 = await queue("https://q.com/3"); const c2 = await R.claimNext(S);
  assert.ok((await R.beginPublish(c2.id, S, { today: 0, week: 0 })).ok); assert.equal((await R.getRecord(c2.id)).processingStatus, "PUBLISHING");
  assert.equal((await R.beginPublish(c2.id, S, { today: 0, week: 0 })).ok, false, "second worker cannot publish the same item");
  await R.markPublished(c2.id, false, "boom", { ambiguous: false }); assert.equal((await R.getRecord(c2.id)).processingStatus, "FAILED");
  assert.equal(await R.claimNext(S), null, "failed item is not re-queued"); void q2;
  const q3 = await queue("https://q.com/4"); const c3 = await R.claimNext(S); await R.beginPublish(c3.id, S, { today: 0, week: 0 });
  await R.markPublished(c3.id, false, "timeout", { ambiguous: true }); assert.equal((await R.getRecord(c3.id)).processingStatus, "NEEDS_REVIEW");
});
await t("restart recovery: abandoned lock -> NEEDS_REVIEW, never republished", async () => {
  const q = await queue("https://q.com/5"); const c = await R.claimNext(S, Date.now() - 3600e3); // claimed an hour ago, worker died
  assert.equal(await R.recoverStale(Date.now()), 1);
  const r = await R.getRecord(c.id); assert.equal(r.processingStatus, "NEEDS_REVIEW"); assert.equal(await R.claimNext(S), null); void q;
  const q2 = await queue("https://q.com/6"); const c2 = await R.claimNext(S, Date.now() - 3600e3); await R.holdForApproval(c2.id);
  assert.equal(await R.recoverStale(Date.now()), 0, "items waiting for human approval are not recovered");
});
await t("integrity report finds corrupted records", async () => {
  await db.set("research/bad-1", { id: "bad-1", processingStatus: "QUEUED" });
  const rep = await R.integrityReport(); assert.ok(rep.corrupted >= 1);
  await db.set("research/bad-1", null).catch(() => {});
});
await t("graceful shutdown stops claiming", async () => {
  life._reset(); let ran = false; life.onShutdown(() => (ran = true));
  const q = await queue("https://q.com/7"); life.track(new Promise((r) => setTimeout(r, 20)));
  await life.shutdown("test", { exit: false, timeoutMs: 500 }); assert.ok(ran);
  assert.equal(await R.claimNext(S), null); assert.equal((await R.getRecord(q.id)).processingStatus, "QUEUED", "persisted, not lost"); life._reset();
});
await t("AI cost: estimated, reported, unknown, unpriced, failed", async () => {
  const pr = { version: "t1", currency: "USD", models: { "groq:m1": { inputPerMTok: 1, outputPerMTok: 2, cachedInputPerMTok: 0.5 } } };
  const u = { inputTokens: 1_000_000, outputTokens: 500_000, cachedInputTokens: 200_000 };
  const e = U.computeCost({ provider: "groq", model: "m1", usage: u }, pr);
  assert.equal(e.costKind, "estimated"); assert.equal(e.cost, 0.8 * 1 + 0.2 * 0.5 + 0.5 * 2); assert.equal(e.pricingVersion, "t1");
  assert.equal(U.computeCost({ provider: "groq", model: "m1", usage: u, reportedCost: 0.42 }, pr).costKind, "reported");
  assert.equal(U.computeCost({ provider: "groq", model: "m1", usage: null }, pr).cost, null, "missing usage is not zero");
  assert.equal(U.computeCost({ provider: "x", model: "nope", usage: u }, pr).costKind, "unpriced");
  assert.equal(U.normalizeUsage(undefined), null); assert.equal(U.normalizeUsage({}), null);
  assert.deepEqual(U.normalizeUsage({ prompt_tokens: 3, completion_tokens: 4 }), { inputTokens: 3, outputTokens: 4, cachedInputTokens: 0, totalTokens: 7 });
  const ok = await U.record({ model: "m1", task: "draft", usage: u, requestId: "req-1", at: 1000 });
  assert.equal(await U.record({ model: "m1", task: "draft", usage: u, requestId: "req-1", at: 1000 }), null, "same request is recorded once");
  const bad = await U.record({ model: "m1", task: "verification", status: "error", error: Object.assign(new Error("429 access_token=EAA" + "q".repeat(30)), { status: 429 }), at: 2000 });
  assert.equal(bad.cost, null); assert.equal(bad.errorClass, "rate_limit"); assert.ok(!bad.error.includes("EAAqqq"));
  const sum = U.summarize([ok, bad].map((r) => ({ ...r, cost: r.cost })), 3000); assert.equal(sum.byTask.draft.calls, 1); assert.equal(sum.byTask.verification.failed, 1);
  assert.ok(sum.total.calls === 2 && sum.estimatedCost >= 0);
});
await t("activity pagination, filters, stable order, export", async () => {
  const rows = Array.from({ length: 57 }, (_, i) => ({ id: String(i).padStart(13, "0"), at: i * 1000, type: i % 10 === 0 ? "error" : "publish", message: `event ${i} ${i % 7 === 0 ? "special" : ""}`, by: "System" }));
  const p1 = L.filterRows(rows, { page: 1, pageSize: 20 }), p3 = L.filterRows(rows, { page: 3, pageSize: 20 });
  assert.equal(p1.total, 57); assert.equal(p1.pages, 3); assert.equal(p3.rows.length, 17); assert.ok(p1.rows[0].id > p1.rows[1].id);
  assert.ok(L.filterRows(rows, { q: "special" }).rows.every((r) => r.message.includes("special")));
  assert.ok(L.filterRows(rows, { level: "error" }).rows.every((r) => r.type === "error"));
  assert.equal(L.filterRows(rows, { from: 10_000, to: 20_000 }).total, 11);
  assert.equal(L.filterRows(rows, { pageSize: 9999 }).pageSize, 100, "page size bounded");
  assert.equal(L.filterRows(rows, { sort: "asc" }).rows[0].id, rows[0].id);
});
await t("alerts: dedup/cooldown, redaction, severity, budget", async () => {
  A._reset();
  assert.ok(await A.raise("k", "warning", "first access_token=EAA" + "z".repeat(30), { cooldownMs: 1000, now: 1000, webhook: "" }));
  assert.equal(await A.raise("k", "warning", "again", { cooldownMs: 1000, now: 1500, webhook: "" }), null, "within cooldown");
  assert.ok(await A.raise("k", "warning", "later", { cooldownMs: 1000, now: 2600, webhook: "" }));
  const list = await A.list(); assert.ok(list.every((a) => !a.message.includes("EAAzzz")));
  A._reset();
  const T0 = Date.now(), rows = [{ at: T0 - 1000, cost: 9, status: "ok" }, { at: T0 - 500, cost: 2, status: "ok" }];
  const out = await A.evaluate({ research: { sourceFailures: 50, queued: 99, needsReview: 1 }, usageRows: rows, settings: { ...S, paused: true, facebookEnabled: false }, env: { AI_BUDGET_USD_MONTH: "10", FB_PAGE_ID: "1", FB_PAGE_TOKEN: "t", GROQ_API_KEY: "k" }, run: { ok: false, error: "x" }, now: T0 });
  const keys = out.map((a) => a.key); for (const k of ["stop", "fbpause", "research-fail", "source-fail", "backlog", "budget"]) assert.ok(keys.includes(k), k);
});
await t("research-run: robots.txt, Google News resolver, URL safety", async () => {
  const f = async (u) => ({ ok: true, text: async () => "User-agent: *\nDisallow: /private\n" });
  assert.equal(await rr.robotsAllows("https://r.com/private/x", f), false); assert.equal(await rr.robotsAllows("https://r.com/open", f), true);
  const target = "https://example.com/story?id=1"; const tok = Buffer.from("\x08\x13\x22" + String.fromCharCode(target.length) + target).toString("base64url");
  assert.equal(rr.resolveGoogleNews("https://news.google.com/rss/articles/" + tok), target);
  assert.equal(rr.resolveGoogleNews("https://news.google.com/rss/articles/CBMiXXXX"), null, "unresolvable stays unresolved");
  assert.equal(rr.resolveGoogleNews("https://example.com/a"), "https://example.com/a");
  await assert.rejects(rr.fetchEvidence("http://127.0.0.1/x"), /unsafe/);
});
await t("migration is repeatable and backup excludes credentials", async () => {
  await db.set("app/linkedin", { token: "SECRET-TOKEN-VALUE" });
  const m1 = await M.migrate(), m2 = await M.migrate();
  assert.ok(m1.backup && fs.existsSync(m1.backup)); assert.equal(m2.applied.length, 0, "second run is a no-op");
  assert.ok(!fs.readFileSync(m1.backup, "utf8").includes("SECRET-TOKEN-VALUE"));
});
await t("theme: no-flash script, selector, invalid saved value (static)", async () => {
  const h = fs.readFileSync("public/index.html", "utf8");
  assert.ok(h.indexOf('localStorage.getItem("araaTheme")') < h.indexOf("<style>"), "theme applied before CSS paints");
  for (const m of ["light", "dark", "system"]) assert.ok(h.includes(`data-theme-set="${m}"`));
  assert.ok(/t==="light"\|\|t==="dark"/.test(h), "invalid saved values fall back to system");
  assert.ok(/:root\[data-theme=dark\]/.test(h) && /:root:not\(\[data-theme=light\]\)/.test(h));
  assert.ok(/aria-pressed/.test(h) && /:focus-visible/.test(h));
});
fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
process.env.FB_PAGE_ID = "123"; process.env.FB_PAGE_TOKEN = "test-token-not-real-0000";
console.log("phase 3 OK");
