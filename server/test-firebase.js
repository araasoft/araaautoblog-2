// Offline test of the Firebase layer, roles and post records. Network calls are faked. Run: npm test
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "araa-test-"));
const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
Object.assign(process.env, {
  FIREBASE_SERVICE_ACCOUNT: JSON.stringify({
    client_email: "svc@proj.iam.gserviceaccount.com",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
    project_id: "proj",
  }),
  FIREBASE_DATABASE_URL: "https://proj-default-rtdb.firebaseio.com/",
  FIREBASE_WEB_API_KEY: "webkey",
  DATA_DIR: tmp,
  FB_PAGE_ID: "123",
  FB_PAGE_TOKEN: "fbtok",
  LI_ACCESS_TOKEN: "litok",
  LI_PERSON_URN: "urn:li:person:me",
  LI_ORG_ID: "999",
});

/* ---------- fake network: Google OAuth, Realtime Database, Facebook, LinkedIn ---------- */
let dbTree = {};
const sent = []; // every outgoing request, for assertions
const etagOf = (v) => (v === null || v === undefined ? "null_etag" : crypto.createHash("md5").update(JSON.stringify(v)).digest("hex"));
const walk = (parts) => parts.reduce((n, s) => (n && typeof n === "object" && s in n ? n[s] : null), dbTree);
function put(parts, v) {
  if (!parts.length) { dbTree = v ?? {}; return; }
  let n = dbTree;
  for (const s of parts.slice(0, -1)) { if (typeof n[s] !== "object" || n[s] === null) n[s] = {}; n = n[s]; }
  if (v === null) delete n[parts.at(-1)]; else n[parts.at(-1)] = v;
}
const json = (status, data, headers = {}) =>
  new Response(data === undefined ? null : JSON.stringify(data), { status, headers });

globalThis.fetch = async (url, o = {}) => {
  const u = new URL(String(url));
  sent.push({ method: o.method || "GET", url: String(url), body: o.body, headers: o.headers });
  if (u.host === "oauth2.googleapis.com") return json(200, { access_token: "gtok", expires_in: 3600 });
  if (u.host === "proj-default-rtdb.firebaseio.com") {
    assert.equal(o.headers.Authorization, "Bearer gtok");
    const parts = u.pathname.replace(/\.json$/, "").split("/").filter(Boolean).map(decodeURIComponent);
    const cur = walk(parts);
    const m = o.method || "GET";
    if (m === "GET") {
      let v = cur;
      if (u.searchParams.get("limitToLast") && v) {
        assert.equal(u.searchParams.get("orderBy"), '"$key"');
        const keys = Object.keys(v).sort().slice(-Number(u.searchParams.get("limitToLast")));
        v = Object.fromEntries(keys.map((k) => [k, v[k]]));
      }
      return json(200, v, o.headers["X-Firebase-ETag"] ? { etag: etagOf(cur) } : {});
    }
    if (m === "PUT") {
      const im = o.headers["if-match"];
      if (im && im !== etagOf(cur)) return json(412, { error: "Precondition failed" });
      put(parts, JSON.parse(o.body));
      return json(200, JSON.parse(o.body));
    }
    if (m === "PATCH") {
      for (const [k, v] of Object.entries(JSON.parse(o.body))) put([...parts, k], v);
      return json(200, JSON.parse(o.body));
    }
    if (m === "DELETE") { put(parts, null); return json(200, null); }
  }
  if (u.host === "graph.facebook.com") {
    if (globalThis.__fbError) return json(400, { error: globalThis.__fbError });
    return json(200, { success: true });
  }
  if (u.host === "api.linkedin.com") return json(204, undefined);
  throw new Error("unexpected request " + url);
};

const db = await import("./src/db.js");
const store = await import("./src/store.js");
const auth = await import("./src/auth.js");
const records = await import("./src/records.js");

/* ---------- database layer ---------- */
assert.ok(db.remote());
assert.equal(db.projectId(), "proj");
await db.set("a/b", { x: 1 });
assert.deepEqual(await db.get("a/b"), { x: 1 });
await db.update("a/b", { y: 2 });
assert.deepEqual(await db.get("a/b"), { x: 1, y: 2 });
await db.remove("a/b/x");
assert.deepEqual(await db.get("a/b"), { y: 2 });
assert.equal(await db.get("nothing/here"), null);
assert.equal(await db.claim("meta/flag", "one"), true);
assert.equal(await db.claim("meta/flag", "two"), false);
assert.equal(await db.get("meta/flag"), "one");
for (const k of ["c", "a", "b"]) await db.set(`list/${k}`, { k });
assert.deepEqual(Object.keys(await db.get("list", { limitToLast: 2 })), ["b", "c"]);
console.log("database layer OK");

/* ---------- settings saved in the database ---------- */
await store.init();
store.saveSettings({ ...store.getSettings(), minPerDay: 4, maxPerDay: 5, linkedinCompany: true });
store.saveLinkedIn({ accessToken: "t", name: "Me" });
await store.flush();
assert.equal(dbTree.app.settings.minPerDay, 4);
assert.equal(dbTree.app.linkedin.name, "Me");
// a "restart": a fresh read of the database restores the same settings
await store.init();
assert.equal(store.getSettings().minPerDay, 4);
assert.equal(store.getSettings().linkedinCompany, true);
assert.deepEqual(store.getDrafts(), []); // empty arrays are not stored by Firebase: must still read as []
console.log("settings in database OK");

/* ---------- Firebase ID token check ---------- */
let certPem;
const certKeyFile = path.join(tmp, "k.pem"), certFile = path.join(tmp, "c.pem");
let haveOpenssl = true;
try {
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", certKeyFile, "-out", certFile, "-subj", "/CN=test", "-days", "2"], { stdio: "ignore" });
  certPem = fs.readFileSync(certFile, "utf8");
} catch { haveOpenssl = false; }

if (haveOpenssl) {
  const signingKey = crypto.createPrivateKey(fs.readFileSync(certKeyFile));
  const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const mk = (claims, kid = "kid1") => {
    const head = b({ alg: "RS256", kid, typ: "JWT" });
    const now = Math.floor(Date.now() / 1000);
    const body = b({ aud: "proj", iss: "https://securetoken.google.com/proj", sub: "u1", email: "a@x.com", iat: now - 5, exp: now + 3600, ...claims });
    return `${head}.${body}.${crypto.sign("RSA-SHA256", Buffer.from(`${head}.${body}`), signingKey).toString("base64url")}`;
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, o) =>
    String(url).includes("securetoken@system.gserviceaccount.com")
      ? json(200, { kid1: certPem }, { "cache-control": "public, max-age=3600" })
      : realFetch(url, o);

  const ok = await auth.verifyIdToken(mk({}));
  assert.deepEqual(ok, { uid: "u1", email: "a@x.com", name: "" });
  const rejects = async (t) => { await assert.rejects(() => auth.verifyIdToken(t), (e) => e.status === 401); };
  await rejects(mk({ aud: "other-project" }));
  await rejects(mk({ iss: "https://securetoken.google.com/other" }));
  await rejects(mk({ exp: Math.floor(Date.now() / 1000) - 10 }));
  await rejects(mk({ sub: "" }));
  await rejects(mk({}, "unknown-kid"));
  const good = mk({});
  const [h1, p1, s1] = good.split(".");
  await rejects(`${h1}.${b({ aud: "proj", iss: "https://securetoken.google.com/proj", sub: "admin", exp: 9999999999, iat: 1 })}.${s1}`); // tampered body
  await rejects("not.a.token");
  await rejects("");
  console.log("ID token verification OK");
} else console.log("openssl not found: skipped ID token verification test");

/* ---------- roles ---------- */
auth._resetCache();
const first = await auth.ensureUser({ uid: "u1", email: "boss@x.com", name: "" }, "  Mohammed   Sahran ");
assert.equal(first.role, "super");
assert.equal(first.name, "Mohammed Sahran");
// Only the very first account can register itself; every other staff account is created by the super admin.
await assert.rejects(() => auth.ensureUser({ uid: "u2", email: "sam@x.com", name: "" }, "Sam"), /Ask the super admin/);
assert.equal((await auth.ensureUser({ uid: "u1", email: "boss@x.com" }, "Other")).name, "Mohammed Sahran"); // existing profile is kept
assert.ok(first.empId && /^ARAA-\d{4}$/.test(first.empId), "super admin gets an employee id");
assert.equal(await auth.superExists(), true);
// exactly one super: simultaneous first sign-ups cannot both win, the others get no profile
await db.set("meta/superAdminUid", null);
await db.set("users", null);
auth._resetCache();
const races = await Promise.allSettled(["r1", "r2", "r3"].map((uid) => auth.ensureUser({ uid, email: uid + "@x.com" }, uid)));
assert.equal(races.filter((r) => r.status === "fulfilled" && r.value.role === "super").length, 1);
const su = races.find((r) => r.status === "fulfilled").value;
await db.set("users/o1", { uid: "o1", name: "Oli", email: "o@x.com", role: "pending", createdAt: 1 });
const other = await db.get("users/o1");
assert.equal((await auth.setRole(su, other.uid, "admin")).role, "admin");
assert.equal((await auth.setRole(su, other.uid, "analyst")).role, "analyst");
assert.equal((await db.get(`users/${other.uid}`)).role, "analyst");
await assert.rejects(() => auth.setRole({ ...other, role: "admin" }, su.uid, "pending"), /Only the super admin/);
await assert.rejects(() => auth.setRole(su, su.uid, "pending"), /cannot be changed/);
await assert.rejects(() => auth.setRole(su, other.uid, "super"), /Invalid position/);
const users = await auth.listUsers();
assert.equal(users[0].role, "super");
console.log("roles OK (one super admin, approvals)");

/* ---------- post records: add / edit / delete per platform ---------- */
const me = { uid: "u1", name: "Mohammed", email: "boss@x.com" };
const rec = await records.track({
  text: "Hello world", author: me, source: "manual", hasImage: false, imageUrl: "https://img/x.jpg",
  results: {
    facebook: { ok: true, id: "123_456" },
    linkedin_personal: { ok: true, id: "urn:li:share:111", url: "https://www.linkedin.com/feed/update/urn:li:share:111/" },
    linkedin_company: { ok: true, id: "urn:li:share:222", url: "x" },
  },
});
assert.ok(rec.id);
assert.equal((await records.track({ text: "x", author: me, results: { facebook: { ok: false, error: "no" } } })), null);
let rows = await records.list(10);
assert.equal(rows.length, 1);
assert.equal(rows[0].author.name, "Mohammed");
assert.equal(rows[0].targets.facebook.postId, "123_456");

sent.length = 0;
const ed = await records.edit(rec.id, { text: "Edited (v2)", targets: ["facebook", "linkedin_company"], by: me });
assert.deepEqual(Object.keys(ed.results).sort(), ["facebook", "linkedin_company"]);
assert.ok(ed.results.facebook.ok && ed.results.linkedin_company.ok);
const liEdit = sent.find((r) => r.url.includes("api.linkedin.com/rest/posts/"));
assert.ok(liEdit.url.endsWith(encodeURIComponent("urn:li:share:222")));
assert.equal(liEdit.headers["X-RestLi-Method"], "PARTIAL_UPDATE");
assert.equal(JSON.parse(liEdit.body).patch.$set.commentary, "Edited \\(v2\\)");
assert.equal(sent.some((r) => r.url.includes(encodeURIComponent("urn:li:share:111"))), false); // personal not touched
assert.equal((await records.list(1))[0].text, "Edited (v2)");

// delete only Facebook: LinkedIn copies stay
sent.length = 0;
let del = await records.remove(rec.id, { targets: ["facebook"] });
assert.ok(del.results.facebook.ok);
assert.equal(del.removed, false);
assert.ok(sent.some((r) => r.method === "DELETE" && r.url.includes("graph.facebook.com/")));
assert.ok(!sent.some((r) => r.url.includes("api.linkedin.com")));
assert.deepEqual(Object.keys((await records.list(1))[0].targets).sort(), ["linkedin_company", "linkedin_personal"]);
await assert.rejects(() => records.remove(rec.id, { targets: ["facebook"] }), /at least one platform/);

// delete rest: record disappears
sent.length = 0;
del = await records.remove(rec.id, { targets: ["linkedin_personal", "linkedin_company"] });
assert.ok(del.results.linkedin_personal.ok && del.results.linkedin_company.ok);
assert.equal(del.removed, true);
assert.equal((await records.list(5)).length, 0);
assert.equal(sent.filter((r) => r.method === "DELETE" && r.headers["X-RestLi-Method"] === "DELETE").length, 2);

// failures are reported per platform and keep the record; "already deleted on Facebook" counts as deleted
const rec2 = await records.track({ text: "T", author: me, results: { facebook: { ok: true, id: "9_9" }, linkedin_personal: { ok: true, id: "urn:li:share:5", url: "u" } } });
globalThis.__fbError = { message: "boom", code: 200 };
let r2 = await records.remove(rec2.id, { targets: ["facebook", "linkedin_personal"] });
assert.equal(r2.results.facebook.ok, false);
assert.match(r2.results.facebook.error, /boom/);
assert.ok(r2.results.linkedin_personal.ok);
assert.equal(r2.removed, false);
globalThis.__fbError = { message: "Unsupported delete request", code: 100, error_subcode: 33 };
r2 = await records.remove(rec2.id, { targets: ["facebook"] });
assert.ok(r2.results.facebook.ok);
assert.equal(r2.removed, true);
await assert.rejects(() => records.edit("../../users", { text: "x" }), /Bad post id/);
await assert.rejects(() => records.edit("0000000000000-aaaaaa", { text: "x" }), /not found/);
console.log("post records OK (edit/delete per platform)");

fs.rmSync(tmp, { recursive: true, force: true });
console.log("firebase tests OK");
