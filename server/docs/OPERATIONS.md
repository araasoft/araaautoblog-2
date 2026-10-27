# Operations guide (Phase 3)

## Architecture
Single Node process (Express). `server.js` -> `store` (settings/plan/drafts, cached, written through to Firebase RTDB or `data/*.json` fallback) -> `automation.js` (scheduler tick every 30s) and `research-run.js` (loop every 5 min, runs when `researchIntervalMin` elapsed since the persisted last run). Research never publishes; the scheduler takes queue items with `claimNext()` and `publishContent()` runs `publishGate()` right before sending.

## Supported operating model
ONE long-lived instance (Railway/Render/VPS/container with restart policy). Locks are in-process; the unique-URL index uses `db.claim` (atomic on Firebase) but queue claiming is not distributed. Do NOT run two instances. On SIGTERM/SIGINT the app stops claiming new work, waits up to 10s for in-flight work, then exits. Host sleeping/serverless platforms cannot run the schedulers.

## Queue lifecycle (`src/research.js`)
`NEW -> QUEUED -> CLAIMED -> PUBLISHING -> PUBLISHED`. Terminal/review: `REJECTED DUPLICATE SOURCE_UNAVAILABLE FAILED NEEDS_REVIEW QUALITY_REJECTED BLOCKED CANCELLED SUPERSEDED`. Illegal transitions throw. Pause/stop leave `QUEUED` items untouched. A `CLAIMED/PUBLISHING` item older than 15 minutes (worker died) moves to `NEEDS_REVIEW` and is never republished automatically (it may already be live; check the Page). Items waiting for human approval are exempt. A failed publish is never auto-retried. Only source-fetch failures that look transient are retried (max 3 attempts, exponential backoff with jitter, new record supersedes the old one).

## Publishing gate (every automatic publish, server-side)
Emergency stop off; automation enabled; daily/weekly limits; Facebook credentials present; item CLAIMED (not cancelled/published); verification `VERIFIED`; quality passed and >= `researchMinQuality`. Manual publishing keeps the Phase 1 policy (blocked only by emergency stop). Facebook has no idempotency key: on ambiguous errors the app compares the Page's last 10 posts by normalized text prefix; if the list call also fails the job goes to `needs_review`. Residual risk: edited/duplicate-text posts or >10 newer posts can defeat the match.

## Verification
Claims (AI-extracted) are matched to stored evidence by token overlap and numbers must appear in evidence. Several sources about the same story are compared by quantity+unit: different values at similar dates => `CONFLICTING_EVIDENCE` (human review, blocks publishing); 7+ days apart => noted as change over time. Text matching shows mention, not truth. Retrieval: robots.txt honored, 2s per-host gap, 6h page cache, 15s timeout, no redirects to private hosts. Google News links are resolved only when the token embeds the URL; otherwise the item is `SOURCE_UNAVAILABLE` (not resolved via Google's servers).

## AI usage & pricing
Every provider request writes `usage/ledger/<id>`: provider, model, task (`research|draft|verification|quality|rewrite|other`; quality/rewrite are reserved, no AI call emits them yet), tokens, cached tokens, duration, status, error class, `costKind` (`reported|estimated|unpriced|unknown|none`), pricing version and rates. Missing usage is never recorded as 0. Failed calls cost nothing unless usage is reported. Edit `pricing.json` (the shipped rates are EXAMPLES). Unsplash image searches are only in the legacy counters.

## Alerts
In-app (Activity page) with dedupe + cooldown: stop on, Facebook paused, missing credentials, research failure, >=5 AI failures/hour, source failures, backlog, needs-review items, AI budget 80%/100%. Optional `ALERT_WEBHOOK_URL` is UNTESTED against a real endpoint.

## Activity & export
`GET /api/activity/logs?page&pageSize&q&level&from&to&sort` (server-side filter; scans the newest 2000 entries), `GET /api/ai-usage`, `GET /api/export/{activity|ai-usage}.csv` (super only, max 5000 rows, formula-safe CSV, secrets redacted).

## Deploy
`npm install && npm start` (Node >= 18). Copy `.env.example` to `.env`. Startup validates config (exits on invalid values; warns on missing credentials). Migrations run at startup (`src/migrate.js`, repeatable; writes `data/backups/backup-*.json` first, credentials excluded). Rollback: stop the app, restore the backup JSON values you need with the Firebase console/REST (`app/*`, `research/*`), delete `app/schemaVersion`. Migration 7 only adds `attempts`/`history` fields.

## Backup / recovery
`npm run backup` (also automatic before migrations). Back up Firebase separately via its export for full DR. Restore is manual. After a crash: restart; abandoned items go to `NEEDS_REVIEW`; check the Page before touching them.

## Credential rotation
Facebook: create a new long-lived Page token, update `FB_PAGE_TOKEN`, restart, revoke the old token in Meta. Groq/Unsplash/LinkedIn: rotate in provider console, update env, restart. Firebase service account: generate new key, update, delete the old key in Google Cloud. Never commit `.env`.

## Tests
`npm test` = unit + MOCKED integration tests (`test.js`, `test-firebase.js`, `test-research.js`, `test-phase3.js`). No test calls Facebook, Groq, Unsplash, Google News or any website. Live smoke tests (do manually, with a dedicated test Page): set test credentials, run `node -e` against `fb.checkConnection()`, `ai.generateText`, `news.getNews()`, and `research-run.fetchEvidence(url)`; publish only to a test Page.

## Troubleshooting
503 on /api: Firebase env incomplete. 423 on publish: emergency stop/limits/gate (see Activity log, type `skipped`). Items in NEEDS_REVIEW: check conflict reasons or abandoned lock. `unpriced` costs: add the model to `pricing.json`. 429 from the app: rate limiter (per process).

## Known limitations
Not live-tested: Facebook, AI, news, source pages, webhook. Express routes, rate-limit wiring, security headers and the frontend (filters, theme, contrast) were checked by syntax/static tests only, not in a browser. Theme is per browser. Single-instance only. Verification is heuristic. Locks and rate limits are in-memory.
