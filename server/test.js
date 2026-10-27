// Offline self-test of the scheduling logic. Run: npm test
import assert from "node:assert/strict";
import { planDay, dayKey, pickType } from "./src/planner.js";
import { cleanSettings } from "./src/store.js";

const settings = cleanSettings({ minPerDay: 2, maxPerDay: 3, startHour: 9, endHour: 21, utcOffsetMinutes: 180, postType: "mixed" });
const MIN = 60000;
let ok = 0;

for (let i = 0; i < 2000; i++) {
  const now = Date.UTC(2026, 9, 24, 0, 0) + Math.floor(Math.random() * 24 * 60) * MIN;
  const jobs = planDay({ now, settings });
  assert.ok(jobs.length <= 3, "never more than 3");
  const day = dayKey(now, 180);
  let prev = 0;
  for (const j of jobs) {
    assert.ok(j.at > now, "in the future");
    assert.equal(dayKey(j.at, 180), day, "same local day");
    const h = new Date(j.at + 180 * MIN).getUTCHours();
    assert.ok(h >= 9 && h < 21, "inside 09:00-21:00 window");
    assert.ok(j.at > prev, "sorted");
    assert.ok(["text", "image", "both"].includes(j.type));
    prev = j.at;
  }
  ok++;
}
// Full day from midnight should give 2 or 3 posts
const fullDay = planDay({ now: Date.UTC(2026, 9, 24, 0, 0), settings });
assert.ok(fullDay.length >= 2 && fullDay.length <= 3);
assert.equal(pickType("text"), "text");
console.log(`planner OK (${ok} random days checked)`);

// ---- LinkedIn (stubbed network) ----
process.env.DATA_DIR = "./data/_test";
process.env.LI_ORG_ID = "12345";
process.env.LI_ACCESS_TOKEN = "tok";
process.env.LI_PERSON_URN = "urn:li:person:abc";
const li = await import("./src/linkedin.js");
assert.equal(li.escapeText("Hi (team) #AI_x @you #"), "Hi \\(team\\) #AI\\_x \\@you \\#");

const calls = [];
globalThis.fetch = async (url, o) => {
  calls.push({ url: String(url), method: o.method, body: o.body });
  if (String(url).includes("initializeUpload"))
    return new Response(JSON.stringify({ value: { uploadUrl: "https://up.example/x", image: "urn:li:image:1" } }), { status: 200 });
  if (String(url).includes("up.example")) return new Response("", { status: 201 });
  return new Response("", { status: 201, headers: { "x-restli-id": "urn:li:share:99" } });
};
const r = await li.postMany(["personal", "company"], { text: "Launch (beta)", imageBuffer: Buffer.from([0xff, 0xd8, 0xff]) });
assert.ok(r.personal.ok && r.company.ok);
assert.equal(r.company.id, "urn:li:share:99");
const posts = calls.filter((c) => c.url.endsWith("/rest/posts")).map((c) => JSON.parse(c.body));
assert.deepEqual(posts.map((p) => p.author).sort(), ["urn:li:organization:12345", "urn:li:person:abc"]);
assert.equal(posts[0].content.media.id, "urn:li:image:1");
assert.equal(posts[0].commentary, "Launch \\(beta\\)");
console.log("linkedin OK");

// LinkedIn retired-version fallback
{
  const seen = [];
  globalThis.fetch = async (url, o) => {
    const v = o.headers["Linkedin-Version"];
    seen.push(v);
    if (Number(v) < 202610) return new Response(JSON.stringify({ message: `Requested version ${v}01 is not active` }), { status: 426 });
    return new Response("", { status: 201, headers: { "x-restli-id": "urn:li:share:7" } });
  };
  const r2 = await li.postMany(["personal"], { text: "hello" });
  assert.ok(r2.personal.ok, JSON.stringify(r2));
  assert.ok(seen.length >= 2 && Number(seen.at(-1)) >= 202610);
  console.log("linkedin version fallback OK");
}

// Member id recovered from the token when it is not saved
{
  delete process.env.LI_PERSON_URN;
  const seen = [];
  globalThis.fetch = async (url, o) => {
    seen.push(String(url));
    if (String(url).includes("/v2/userinfo")) return new Response(JSON.stringify({ sub: "zzz", name: "Test" }), { status: 200 });
    return new Response("", { status: 201, headers: { "x-restli-id": "urn:li:share:5" } });
  };
  const r3 = await li.postMany(["personal"], { text: "hi" });
  assert.ok(r3.personal.ok, JSON.stringify(r3));
  assert.ok(seen.some((u) => u.includes("/v2/userinfo")));
  console.log("linkedin member id recovery OK");
}
