import assert from "assert";
import fs from "fs";
process.env.DATA_DIR = "./data/_test_research"; delete process.env.FIREBASE_SERVICE_ACCOUNT; delete process.env.FIREBASE_DATABASE_URL;
fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
const R = await import("./src/research.js");
const store = await import("./src/store.js"); await store.init?.();
const S = { ...store.DEFAULT_SETTINGS, newsTopics: ["artificial intelligence"], paused: false, facebookEnabled: true };

// URLs
assert.equal(R.canonicalUrl("https://www.Example.com/a/?utm_source=x&b=1#frag"), "https://example.com/a?b=1");
for (const bad of ["javascript:alert(1)", "http://localhost/x", "http://127.0.0.1/", "not a url", "https://u:p@x.com/"]) assert.equal(R.canonicalUrl(bad), null, bad);
// duplicates
const ex = [{ id: "1", url: "https://a.com/x", title: "OpenAI releases new model for developers", text: "Released with 3 tiers" }];
assert.ok(R.checkDuplicate({ url: "https://www.a.com/x?utm_source=z", title: "t" }, ex).duplicate);
assert.ok(R.checkDuplicate({ url: "https://b.com/y", title: "OpenAI releases a new model for developers" }, ex).duplicate);
assert.ok(!R.checkDuplicate({ url: "https://b.com/y", title: "Kubernetes security patch" }, ex).duplicate);
assert.ok(!R.checkDuplicate({ url: "https://b.com/y", title: "OpenAI releases new model for developers", text: "now 5 tiers and 40% cheaper" }, ex).duplicate, "new development allowed");
// verification
const ev = [{ url: "https://a.com/x", publisher: "A", primary: true, text: "Acme released version 4 of its framework on Monday with faster builds" }];
assert.equal(R.verifyClaims([{ text: "Acme released version 4 of its framework", important: true }], ev).status, "VERIFIED");
assert.equal(R.verifyClaims([{ text: "Acme grew revenue 250%", important: true }], ev).status, "REJECTED");
assert.equal(R.verifyClaims([{ text: "Developers love it everywhere", important: true }], ev).status, "NEEDS_REVIEW");
const now = Date.now(), nb = { url: "https://z.com", publisher: "Z", primary: false, text: ev[0].text };
assert.equal(R.verifyClaims([{ text: "Acme released version 4 of its framework", important: true }], [nb], { now, publishedAt: now - 3600e3 }).status, "NEEDS_REVIEW", "breaking news, single non-primary source");
// quality: mandatory failure overrides score
const good = "Acme shipped version 4 of its framework with faster builds. Teams can upgrade this week. Want help planning it? Message us.";
const vOk = R.verifyClaims([{ text: "Acme shipped version 4 of its framework", important: true }], [{ ...ev[0], text: "Acme shipped version 4 of its framework with faster builds" }]);
assert.ok(R.qualityReport({ text: good + " ".repeat(120) + "More detail for the reader to use today." }, { verification: vOk, minQuality: 60 }).mandatoryFailures.length === 0);
const q = R.qualityReport({ text: good }, { verification: { status: "NEEDS_REVIEW", claims: [] } });
assert.ok(!q.passed && q.mandatoryFailures.some((m) => m.startsWith("facts")));
assert.ok(R.qualityReport({ text: good + " crypto" }, { brand: { avoid: "crypto" }, verification: vOk }).mandatoryFailures.some((m) => m.startsWith("brand")));
// final gate: emergency stop, facebook pause, state
const rec = { processingStatus: "QUEUED", verification: { status: "VERIFIED" }, quality: { passed: true }, draft: { text: "x" } };
assert.equal(R.finalCheck(rec, S), "");
assert.match(R.finalCheck(rec, { ...S, paused: true }), /emergency/);
assert.match(R.finalCheck(rec, { ...S, facebookEnabled: false }), /Facebook/);
assert.match(R.finalCheck({ ...rec, processingStatus: "CLAIMED" }, S), /status/);
// pipeline with mocked deps (NOT live)
const base = { fetchEvidence: async () => ({ url: "https://a.com/x", publisher: "A", text: "Acme shipped version 4 of its framework with faster builds for teams" }),
  existing: async () => [], history: async () => [], writeDraft: async () => ({ text: good + " ".repeat(1) + "Teams get faster builds and a simpler upgrade path, so planning the move this week is realistic." }),
  extractClaims: async () => [{ text: "Acme shipped version 4 of its framework", important: true }] };
const cand = { title: "Acme artificial intelligence framework", url: "https://a.com/x?utm_x=1", publisher: "A", publishedAt: Date.now() - 20 * 3600e3 };
const ok = await R.processCandidate(cand, base, S);
assert.equal(ok.processingStatus, "QUEUED", ok.error);
const stopped = await R.processCandidate({ ...cand, url: "https://a.com/other" }, base, { ...S, paused: true });
assert.equal(stopped.processingStatus, "BLOCKED", "research may finish but must not queue while stopped");
assert.equal((await R.processCandidate({ ...cand, url: "ftp://x" }, base, S)).processingStatus, "REJECTED");
assert.equal((await R.processCandidate({ ...cand, url: "https://c.com/1" }, { ...base, fetchEvidence: async () => { throw new Error("404"); } }, S)).processingStatus, "SOURCE_UNAVAILABLE");
assert.equal((await R.processCandidate({ ...cand, url: "https://c.com/2" }, { ...base, extractClaims: async () => [{ text: "Acme grew 300%", important: true }] }, S)).processingStatus, "NEEDS_REVIEW");
// queue: concurrent claims cannot take the same item; stop blocks claiming
const [a, b] = await Promise.all([R.claimNext(S), R.claimNext(S)]);
assert.ok(a && !b, "only one claimant gets the item");
const again = await R.processCandidate({ ...cand, title: "Acme artificial intelligence framework two", url: "https://d.com/9" }, { ...base, fetchEvidence: async () => ({ url: "https://d.com/9", text: "Acme shipped version 4 of its framework with faster builds for teams today" }) }, S);
assert.equal(again.processingStatus, "QUEUED", again.error);
assert.equal(await R.claimNext({ ...S, paused: true }), null, "stop blocks queued item");
assert.equal((await R.listRecords()).filter((r) => r.processingStatus === "QUEUED").length, 1, "item stays queued while stopped");
assert.ok(await R.claimNext(S), "claimable again after resume");
fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
console.log("research OK");
