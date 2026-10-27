// Offline tests for phase 4: failover, analytics maths, breaking-news clustering, roles, planner, EmailJS limits, profile rules.
// No live Facebook / AI / EmailJS calls: servers and fetch are mocked.
import http from "http";
import assert from "assert";
process.env.DATA_DIR = "/tmp/araa-test-" + Date.now();
process.env.EMAILJS_SERVICE_ID = "svc"; process.env.EMAILJS_TEMPLATE_ID = "tpl"; process.env.EMAILJS_PUBLIC_KEY = "pub";
let pass = 0; const ok = (n, f) => Promise.resolve().then(f).then(() => { pass++; console.log("ok  " + n); }, (e) => { console.error("FAIL " + n + ": " + e.message); process.exitCode = 1; });

const client = await import("./src/aiclient.js");
const analytics = await import("./src/analytics.js");
const breaking = await import("./src/breaking.js");
const roles = await import("./src/roles.js");
const { planDay } = await import("./src/planner.js");
const admins = await import("./src/admins.js");
const store = await import("./src/store.js");
const notify = await import("./src/notify.js");
await store.init();

// ---- mock AI providers: A fails 401, B model1 -> 404 (gone) with /models listing a newer one, then works ----
const calls = [];
const srv = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    calls.push(req.url + " " + (b ? JSON.parse(b).model : ""));
    const send = (code, o) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
    if (req.url.startsWith("/a/")) return send(401, { error: { message: "bad key" } });
    if (req.url === "/b/models") return send(200, { data: [{ id: "mini-model-2" }, { id: "mini-model-3" }, { id: "mini-model-3-preview" }] });
    if (req.url === "/b/chat/completions") { const m = JSON.parse(b).model; return m === "mini-model-1" ? send(404, { error: { message: "model not found", code: "model_not_found" } }) : send(200, { choices: [{ message: { content: "hello from " + m } }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }); }
    send(500, {});
  });
});
await new Promise((r) => srv.listen(0, r));
const port = srv.address().port;
process.env.GROQ_API_KEY = "k1"; process.env.AI_CUSTOM_API_KEY = "k2"; process.env.AI_CUSTOM_BASE_URL = `http://127.0.0.1:${port}/b`; process.env.AI_CUSTOM_MODELS = "mini-model-1";
// provider A (groq) points at the mock that returns 401
const realFetch = globalThis.fetch;
globalThis.fetch = (u, o) => realFetch(String(u).replace("https://api.groq.com/openai/v1", `http://127.0.0.1:${port}/a`), o);

await ok("failover: bad key provider is skipped, missing model replaced by newest similar one", async () => {
  client._reset();
  const t = await client.generate("hi", 50, { task: "other" });
  assert.equal(t, "hello from mini-model-3"); // not the -preview one
  const rep = await client.healthReport();
  assert.ok(rep.find((p) => p.id === "groq").state.includes("paused"));
});
await ok("failover: pickSimilar ignores preview models", () => assert.equal(client.pickSimilar("gemini-2.5-flash", ["gemini-2.5-flash-preview", "gemini-3-flash", "gemini-2.0-flash"], []), "gemini-3-flash"));
await ok("daily token cap blocks AI calls", async () => {
  client._reset();
  const db = await import("./src/db.js");
  await db.set(`usage/${new Date().toISOString().slice(0, 10)}`, { tokens: 999 });
  await assert.rejects(() => client.generate("x", 10, { cap: 500 }), /cap reached/);
});
globalThis.fetch = realFetch; srv.close();

// ---- analytics maths ----
await ok("computeInsights finds best hour, hashtags, keywords", () => {
  const off = 0, mk = (h, sc, text) => ({ at: Date.UTC(2026, 9, 1, h), score: sc, text, measured: true });
  const rows = [mk(9, 100, "Fast websites win #WebDev #Speed"), mk(9, 120, "Speed matters for websites #WebDev"), mk(20, 10, "Random thing #Misc"), mk(20, 12, "Another #Misc"), mk(13, 60, "Apps grow business #Apps"), mk(13, 55, "Apps again #Apps #WebDev"), mk(15, 30, "x post #Misc"), mk(16, 35, "y post #Apps")];
  const i = analytics.computeInsights(rows, off);
  assert.equal(i.bestHours[0].hour, 9); assert.equal(i.topHashtags[0].tag, "#webdev"); assert.ok(i.topKeywords.some((k) => k.word === "websites")); assert.equal(i.ready, true);
});
await ok("computeInsights: thin data is not ready", () => assert.equal(analytics.computeInsights([{ at: 1, score: 5, text: "a #b", measured: true }]).ready, false));
await ok("score weights comments and shares above views", () => assert.ok(analytics.score({ views: 0, comments: 1 }) > analytics.score({ views: 30 })));

// ---- planner uses best hours ----
await ok("planDay uses preferred hours when given", () => {
  const s = { ...store.DEFAULT_SETTINGS, utcOffsetMinutes: 0, startHour: 8, endHour: 22, minPerDay: 2, maxPerDay: 2 };
  const now = Date.UTC(2026, 9, 26, 0, 5);
  const jobs = planDay({ now, settings: s, preferredHours: [9, 13, 20], rand: () => 0 });
  assert.equal(jobs.length, 2); assert.deepEqual(jobs.map((j) => new Date(j.at).getUTCHours()), [9, 13]);
});
await ok("planDay without data keeps random spread", () => assert.ok(planDay({ now: Date.UTC(2026, 9, 26, 0, 5), settings: { ...store.DEFAULT_SETTINGS, utcOffsetMinutes: 0 } }).length >= 2));

// ---- breaking news ----
await ok("breaking: clusters same story from different outlets and detects kind", () => {
  const now = Date.now(), it = (title, source, ago = 10) => ({ title, source, link: "u", at: now - ago * 60000 });
  const c = breaking.cluster([it("Critical vulnerability found in popular router firmware", "A"), it("Popular router firmware critical vulnerability found", "B"), it("Totally unrelated gadget review", "C"), it("Old story about breach", "D", 600)], now);
  assert.equal(c.length, 1); assert.equal(c[0].kind, "emergency"); assert.equal(c[0].sources.length, 2);
});
await ok("breaking: harm stories are flagged for human review", () => {
  const now = Date.now(), c = breaking.cluster([{ title: "Urgent: attack on data center kills two", source: "A", link: "", at: now - 60000 }], now);
  assert.equal(c[0].tragedy, true);
});

// ---- roles ----
await ok("roles: permissions", () => {
  assert.ok(roles.can("super", "anything")); assert.ok(roles.can("admin", "post.delete")); assert.ok(!roles.can("analyst", "post.create"));
  assert.ok(roles.can("analyst", "analytics.view")); assert.ok(!roles.can("content_creator", "post.delete")); assert.ok(roles.can("seo_specialist", "brand.edit"));
  assert.ok(!roles.can("community_manager", "settings.edit")); assert.ok(roles.can("community_manager", "engage.reply")); assert.ok(!roles.can("pending", "post.create"));
});

// ---- profile rules ----
await ok("profile: locked fields cannot be changed by the admin themself", async () => {
  const db = await import("./src/db.js");
  await db.set("users/u1", { uid: "u1", name: "Sam", email: "s@x.com", empId: "ARAA-0002", role: "analyst", dob: "1990-01-01" });
  await assert.rejects(() => admins.updateSelf("u1", { name: "Other" }), /cannot be changed/);
  await assert.rejects(() => admins.updateSelf("u1", { empId: "ARAA-0009" }), /cannot be changed/);
  const u = await admins.updateSelf("u1", { phone: "5551234", name: "Sam" });
  assert.equal(u.phone, "5551234");
  const cleared = await admins.updateSelf("u1", { photo: "" }); assert.ok(!cleared.photo);
});
await ok("profile: validation helpers", () => {
  assert.ok(admins.validDob("1992-05-20")); assert.ok(!admins.validDob("2020-01-01")); assert.ok(!admins.validDob("nope"));
  assert.ok(admins.strongPassword("abcdef12")); assert.ok(!admins.strongPassword("abcdefgh")); assert.ok(!admins.validPhoto("data:text/html;base64,AAAA"));
});
await ok("forgot password gives the same answer for unknown email and wrong DOB", async () => {
  const a = await admins.forgot({ email: "nobody@x.com", dob: "1990-01-01", ip: "1.1.1.1" });
  const b = await admins.forgot({ email: "s@x.com", dob: "2000-02-02", ip: "1.1.1.2" });
  assert.deepEqual(a, b);
});

// ---- EmailJS: monthly cap + payload ----
await ok("EmailJS: sends payload, counts, and stops at the monthly cap", async () => {
  let sent = 0, last;
  globalThis.fetch = async (u, o) => { sent++; last = JSON.parse(o.body); return new Response("OK", { status: 200 }); };
  store.saveSettings({ ...store.getSettings(), emailMonthlyCap: 2 });
  assert.ok((await notify.sendMail({ to_email: "a@b.com", subject: "s" })).ok);
  assert.equal(last.service_id, "svc"); assert.equal(last.template_params.to_email, "a@b.com");
  assert.ok((await notify.sendMail({ to_email: "a@b.com", subject: "s" })).ok);
  const r = await notify.sendMail({ to_email: "a@b.com", subject: "s" });
  assert.equal(r.capped, true); assert.equal(sent, 2);
  globalThis.fetch = realFetch;
});
await ok("default notify recipients are the two admin addresses", () => assert.deepEqual(store.getSettings().notifyEmails, ["araasoftwares@gmail.com", "sahranrock8@gmail.com"]));

console.log(`\n${pass} passed`);
