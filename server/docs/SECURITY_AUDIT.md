# Security & reliability audit (Phase 3)

Method: read of `server.js`, `src/*.js`, `public/index.html`, `.env.example`, `.gitignore`, `database.rules.json`; baseline `npm test` run before changes (all passed). "Tested" means an automated test with MOCKED services exercises the logic; it is not live proof.

| ID | Sev | Component | Evidence | Impact | Fix | Status |
|----|-----|-----------|----------|--------|-----|--------|
| F-01 | High | `src/facebook.js` `call()` | `fetch(url, opts)` had no timeout/signal | A hung Graph request blocks the scheduler (`busy` flag) indefinitely | `AbortSignal.timeout(FB_TIMEOUT_MS)` | Fixed; not unit-tested |
| F-02 | High | `src/automation.js` tick | Any thrown error set job `pending` and retried (up to 3x) | A timeout after Facebook accepted the post could publish duplicates | Ambiguous errors (timeout/reset/5xx) trigger `reconcile()` against the Page's last 10 posts; unresolved => `needs_review`, never retried | Fixed; reconcile logic tested, the automation.js wiring is NOT exercised end-to-end |
| F-03 | High | publish path | Limits/stop were checked in `tick` earlier, not at the moment of publishing | Stale checks, concurrent paths | `publishGate()` re-evaluated inside `publishContent` immediately before any automatic publish; research items additionally go CLAIMED->PUBLISHING with a persisted marker | Fixed; gate and state machine tested, wiring not end-to-end tested |
| F-04 | Med | `server.js` | No rate limiting on `/api` | Brute force/abuse of publish/settings endpoints | In-memory limiter (300/min general, 30/min sensitive writes) | Fixed; limiter tested, Express wiring not exercised (Express not installable offline) |
| F-05 | Med | `server.js` | No security headers | Clickjacking/sniffing | nosniff, X-Frame-Options DENY, no-referrer, no-store on `/api` | Fixed; untested |
| F-06 | Med | `server.js` error handlers, `log.js` | Raw `e.message` returned/logged | Token/key leakage via upstream errors | `redact()` on responses, log messages, alerts, usage errors | Fixed; tested |
| F-07 | Med | roles | Role changes/exports/integrity were not role-gated at route level | Privilege creep | `requireRole("super")` for role change, export, integrity; `admin` for research run/cancel | Fixed; middleware tested, route wiring untested. (`auth.setRole` has its own checks per the pre-existing role tests; not re-audited line by line) |
| F-08 | Med | research store | No record validation, no unique queue key, free-form status | Duplicate/corrupt queue entries | `validateRecord`, transition table, `researchIdx/<sha(url)>` unique index via `db.claim`, `integrityReport()` | Fixed; tested |
| F-09 | Med | AI cost | One flat `AI_COST_PER_MTOK` over total tokens | No per-model/task cost, failures unseen | Per-request ledger (`usage/ledger`), `pricing.json`, estimate vs reported, unknown/unpriced never zero | Fixed; tested |
| F-10 | Low | `src/ai.js` | `openai` imported at module load | Modules unusable without the package (found when tests ran offline) | Lazy `import("openai")` | Fixed |
| F-11 | Info | settings | Any admin can switch the emergency stop off | By design (Phase 1 policy) | Not changed; alert raised when it is switched ON | Documented |
| F-12 | Info | CORS | No CORS headers configured; API is same-origin + bearer token | Cross-origin browsers are blocked by default | None needed | Documented |
| F-13 | Low | docs | `.env.example` mentions an old `API_KEY` login but `/api` returns 503 without Firebase | Confusing | Not changed | Open |
| F-14 | Info | `.gitignore`/rules | `.env`, `data` ignored; Firebase rules deny all client access | Good | Kept; ZIP excludes `data/` and `.env` | OK |
| F-15 | Med | scaling | Locks, limiter, research loop are in-process | Multi-instance duplicates | Single-instance supported; documented | Open (by design) |
| F-16 | Low | `express.json` limit 15mb | Large bodies accepted on all routes | Memory pressure | Not changed (needed for image upload) | Open |

Not found / not verified: no file-upload validation review beyond the existing 15mb JSON image path; no dependency vulnerability scan (offline); no penetration test.
