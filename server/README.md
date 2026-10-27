# AraaPosts - Facebook + LinkedIn auto-poster

Modes (all in one dashboard):
- **Full automation** - AI writes + finds image, posts 2-3 times a day at random times.
- **Automation + manual** - same, but posts wait as drafts until you approve/edit them.
- **AI-assisted manual** - "Write with AI" / "Find with AI" buttons, you press Publish.
- **Full manual** - type your own text, upload a photo or paste an image URL.
Post types everywhere: text only, image only, text + image. Manual posts can be scheduled.

## Environment variables
See `.env.example`. Required: FB_PAGE_ID, FB_PAGE_TOKEN, GROQ_API_KEY, UNSPLASH_ACCESS_KEY, plus the FIREBASE_* values (sign-in is Firebase only).
Facebook token needs `pages_manage_posts` + `pages_read_engagement` (use a long-lived Page token).

## Accounts, admins and the database (Firebase, free plan)
Sign-in uses **Firebase Authentication** (email + password). Settings, the daily plan, drafts, the LinkedIn connection and every post you make are saved in **Firebase Realtime Database**, so nothing is lost when Railway redeploys and you do not need a Railway volume. Firebase Storage is not used: images are never stored (only text, author and post ids).

Setup (once, about 5 minutes, all on the free Spark plan):
1. console.firebase.google.com > Add project (any name, Analytics off).
2. **Build > Authentication > Get started > Email/Password > Enable**.
3. **Build > Realtime Database > Create database** (any location, start in **locked mode**). Open the **Rules** tab, paste the contents of `database.rules.json` and Publish. This blocks all direct browser access: only this server can read or write the data.
4. **Project settings > General**: copy the **Web API key** into `FIREBASE_WEB_API_KEY`. Copy the database URL from the Realtime Database page into `FIREBASE_DATABASE_URL`.
5. **Project settings > Service accounts > Generate new private key**. Open the downloaded `.json` file and paste its whole contents into `FIREBASE_SERVICE_ACCOUNT`. Keep this file secret; never put it in GitHub.
6. Redeploy, open the dashboard and press **Create account**.

Roles:
- **Super admin**: exactly one. It is the very first account created, so create yours right after deploying. Only the super admin approves or removes admins. It cannot be changed or transferred from the dashboard.
- **Admin**: an account the super admin approved. Can post, edit, delete and use Automation.
- **Waiting**: anyone else who signs up. They see a waiting screen and cannot post until approved. (Anyone who knows your site address can create a Firebase account, which is why approval is required.)
- The **Admins** tab lists everyone; the super admin sees Approve / Remove access buttons.

Every post made by hand shows its **author name**. Automatic posts show "Automation".

Posts tab: each post made here shows where it was published (Facebook, LinkedIn profile, LinkedIn company page). **Edit** and **Delete** let you tick Facebook only, LinkedIn only, or everything. A toast tells you the result per platform, for example `Facebook: post deleted` and `LinkedIn profile: post deleted`. LinkedIn edits change the text only. Posts made before this version are listed under "Older Facebook posts" (Facebook only). Existing settings in `data/*.json` are imported into Firebase automatically the first time the server starts.

Sign-in uses Firebase accounts only (no shared API key).

## LinkedIn (profile + company page)
On the **Post** tab, tick *Facebook Page*, *LinkedIn profile* and/or *LinkedIn company page* before publishing. In **Automation**, tick the LinkedIn boxes (and Save settings) to have automatic posts go there too. LinkedIn is best-effort: if it fails, the Facebook post still goes out and the error is logged. LinkedIn posts publish immediately; scheduling is Facebook only.

One-time setup:
1. developers.linkedin.com > Create app (link it to your company page). On the **Products** tab request **Share on LinkedIn** and **Sign In with LinkedIn using OpenID Connect** (profile posting). For the company page also request **Community Management API** (LinkedIn must approve it; until then remove `w_organization_social` from `LI_SCOPES`).
2. **Auth** tab > Authorized redirect URLs: add `https://YOUR-APP-URL/linkedin/callback` (same value as `LI_REDIRECT_URI`).
3. Set `LI_CLIENT_ID`, `LI_CLIENT_SECRET`, `LI_REDIRECT_URI`, and `LI_ORG_ID` (the number in your company admin URL) on the server.
4. Dashboard > Automation > **Connect LinkedIn**, approve, done. You must be an admin of the company page.

LinkedIn tokens last about 60 days and cannot be refreshed automatically for normal apps. The Automation tab shows the end date; press **Reconnect LinkedIn** before then. The connection is saved in the database (Firebase when configured, otherwise `DATA_DIR`, which then needs a persistent disk on Railway/Render or it is erased on every redeploy).

## Deploy (phone friendly)
1. Put this folder in a GitHub repo (github.com > New repository > Add file > Upload files).
2. Railway or Render: New > Deploy from GitHub repo. Build `npm install`, start `npm start`.
3. Add the environment variables above.
4. Keep it always on. With Firebase configured you do not need a disk. (Without Firebase, add a disk mounted at `/data` and set `DATA_DIR=/data`, or a restart forgets today's plan and may post extra. Free plans that sleep will miss posts.)
5. Open your app URL, sign in, open **Settings** and check Facebook shows Connected. Then go to **Automation** and check the status pills are green.

Local: `npm install`, copy `.env.example` to `.env`, `npm start`. `npm test` checks the scheduler offline.
# araaautoblog


## Comments, likes, replies
The full post view shows Facebook likes, shares and comments and lets you reply or like comments. The Page token needs `pages_read_engagement` and `pages_manage_engagement`. LinkedIn does not share likes/comments with this app, so use the **View on LinkedIn** button.

## Phase 2: research agent, themes (added)

- **Research** (`src/research.js`, `src/research-run.js`): Settings `researchEnabled`, `researchInAuto`, `researchIntervalMin`, `researchBatch`, `researchMinQuality`. Candidates come from the existing news module, are stored under `research/<id>` with source metadata and a short evidence extract, de-duplicated (canonical URL, text hash, title/content similarity), claims matched against the stored evidence, quality-checked, then queued. The worker never publishes; `automation.js` takes queue items via `claimNext()`, which re-checks emergency stop, Facebook pause, verification and quality immediately before use. Failed publishes are never auto-retried for research items.
- **Theme**: Light / Dark / System selector in the side menu, stored per browser (localStorage), applied before first paint.
- **Run on a host with a persistent process** (Railway/Render/VPS). The loop is in-process and single-instance; run only one instance.
- Tests: `npm test` (mocked services only; no live Facebook/AI/news calls are tested).

### Known limitations
Verification is deterministic text matching against a short extract of the source page (not full article reading), so it errs toward NEEDS_REVIEW. Google News links are redirects; sources that block fetching are marked SOURCE_UNAVAILABLE. Locking is in-process only. Theme is per browser, not per account. Per-provider pricing, alerts, data export, CSV/log pagination and an authorization audit beyond the existing role system were not implemented.


## Phase 3
See `docs/SECURITY_AUDIT.md` (findings) and `docs/OPERATIONS.md` (architecture, queue, pricing, alerts, deploy, backup, live testing, limitations). `npm test` runs mocked tests only. `npm run backup` exports data without credentials.


## Phase 4 - Marketing AI, analytics, breaking news, email, staff roles
Full guide: `docs/PHASE4.md`. Run `npm test` (all offline, mocked).

- **Analytics** (`src/analytics.js`): views, reach, likes, comments, shares for every post made here; learns the best hours, days, hashtags and keywords with plain maths (no AI tokens). Posts are then planned at the best hours and new posts reuse the best hashtags/keywords. Needs 8 measured posts before it changes anything.
- **Marketing AI** (dashboard > Marketing AI): autopilot cycle every 6 hours, strategy, workflow history ("what the AI did"), provider health. The AI always receives its purpose and its last steps.
- **AI failover** (`src/aiclient.js`): any OpenAI-compatible provider; on error switches model, then provider; a removed model is replaced by the newest similar one; daily token cap.
- **Breaking / urgent / update news** (`src/breaking.js`): scans every 10 min, posts immediately when several outlets confirm. Off by default.
- **EmailJS + notifications** (`src/notify.js`): post created / edited / deleted, likes, comments, shares go to araasoftwares@gmail.com and sahranrock8@gmail.com and to the in-app bell. New posts are emailed to subscribers.
- **Staff roles** (`src/roles.js`, `src/admins.js`): Super admin, Manager, Content creator, Analyst, SEO specialist, Community manager. Created by the super admin with Employee ID, name, position, official email, password, photo. Forgot password = email + date of birth.


## Guest accounts, CORS and security
- **Guest (view only)**: a role in `src/roles.js` with only `analytics.view` and `news.view`. The server (not the page) refuses every write and every read except `/me /status /records /posts /scheduled /analytics /news /engagement/:id` with `403 guest_readonly`; `/status` is trimmed (no settings, drafts or plan jobs) and guests get a stricter rate limit (60/min). Create one with Add admin -> position "Guest (view only)".
- **CORS**: set `ORIGINS=http://localhost:5173,http://localhost:4173,https://araaposts.web.app` in `.env` (`ORGINS` also works). Same-origin always works; any other origin gets `403 cors`; preflight is answered before auth; `*` is rejected at start-up. Websites that post to `/subscribe` must be listed too.
- **Headers**: nosniff, frame deny, no-referrer, locked CSP (API: `default-src 'none'`), HSTS over https, no `X-Powered-By`, `no-store` on `/api`.
- Run `node test-guest-cors.js` (also part of `npm test`).
