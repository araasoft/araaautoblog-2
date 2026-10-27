# Phase 4 guide

## 1. Setup checklist (in this order)
1. Redeploy this version. Existing Firebase data is kept. The old role `admin` is now called **Manager**; old `pending` accounts have no access.
2. Set the new variables from `.env.example` (EmailJS, PUBLIC_URL, optional backup AI keys).
3. EmailJS: create a service + a template. Template "To" field = `{{to_email}}`, subject = `{{subject}}`, body uses `{{title}}`, `{{message}}`, `{{post_url}}`, optional `{{unsubscribe_url}}`. Turn on *Account > Security > Allow EmailJS API for non-browser applications* (without it the server calls are refused). Dashboard > Email & alerts > **Send test email**.
4. Dashboard > Marketing AI: switch **Autopilot** on, press **Run cycle now**.
5. Dashboard > Team > **Add admin** to create each staff account.

## 2. Roles
| Position | Can do |
|---|---|
| Super admin | everything, creates/edits staff, exports |
| Manager | post, edit, delete, approve drafts, settings, automation, brand, email, analytics, Marketing AI |
| Content creator | create posts, edit own posts, AI writing, view analytics/news |
| Analyst | analytics (refresh), activity log, AI usage, CSV export, news |
| SEO specialist | AI tools, brand keywords, analytics, Marketing AI (SEO), create posts |
| Community manager | reply/like comments, create posts, view analytics |
Checked on the server for every request. To add a position, add one entry in `src/roles.js`.

## 3. Staff accounts
- The **first** account ever created is the super admin (fills name, date of birth, phone). Nobody else can self-register; a Firebase account without a profile has no access.
- Super admin > Team > Add admin: name, position, official email, password, date of birth, phone, department, joining date, optional photo. Employee ID (`ARAA-0002`...) is automatic. Set `OFFICIAL_EMAIL_DOMAIN` to force the company email domain.
- Passwords live only in Firebase Authentication (hashed). They are never stored in the database or shown.
- Admins can edit only phone, address, about-me and photo, and change their own password. Name, email, Employee ID, position and date of birth are locked (super admin edits name/position/role/department/phone/date of birth; email and ID never change).
- No photo = the Araa Softwares logo (never letters). Photos are shrunk in the browser to a small square and stored in the database; Firebase Storage is not needed.
- **Forgot password**: email + date of birth. If they match, Firebase sends the reset email. The answer is identical for wrong details (no account guessing), limited to 5 tries/hour per email.

## 4. Analytics and learning
Facebook: `post_media_view` (views) and `post_total_media_view_unique` (reach) because Meta retired the old impressions/reach metrics (Nov 2025, June 2026), plus likes/comments/shares. LinkedIn: company-page posts only (needs `r_organization_social`); LinkedIn gives no statistics for personal-profile posts through its API. If a number is unavailable the page shows why instead of zero.
Score = views + 20 x likes + 40 x comments + 60 x shares. The planner posts at the best hours (random minute, 1 hour apart) once 8 posts are measured; before that the normal random spread is used.

## 5. Breaking / urgent / update news
Off by default (Marketing AI > Breaking news). Every scan: fetch headlines from the last 24 h, group the same story, classify (urgent / breaking / update), require N different outlets (default 2), then write a short post from the headlines only and publish immediately, or save a draft. Limits: per day, minimum gap, emergency stop. Stories about harm to people are never auto-posted: admins get a notification. If AI is down or capped, a plain template post is used.
**Risk to know:** automatic news posting can still publish a wrong or badly-timed story. Start in *draft* mode for a week.

## 6. Notifications and email
Events: post created / scheduled / edited / deleted, likes, comments, shares (Facebook counters checked every 8 minutes), breaking news needing review, admin changes, security events. Each one appears in the bell (list + toast, and a phone/desktop alert when the app is open or in the background and permission is granted) and is emailed to the addresses in Email & alerts (default araasoftwares@gmail.com and sahranrock8@gmail.com). Likes/comments/shares are grouped into one email every 15 minutes. EmailJS free = 200 mails/month; the monthly cap (default 180) stops sending, in-app notifications continue. With many subscribers one new post can use the whole month: raise the plan or lower the cap.
This is not a closed-app push service (no service worker / VAPID). Add one later if you need alerts while the app is fully closed.

## 7. AI: how it stays cheap and self-healing
- No AI for analytics, planning, clustering, health checks or notifications.
- Strategy: one call (about 700 tokens) per week or when forced. Posts: one call each (about 1,400 max tokens). Breaking post: about 450.
- Prompts carry a compact memory (purpose + last 5 steps + strategy + best tags, under 1,000 characters).
- Repeated identical requests are cached for 10 minutes. Daily token cap (default 60,000) blocks further AI calls.
- Failure handling: 401/403 -> provider paused 6 h; 429 -> that model waits for the retry time; 404/model gone -> newest similar model from the provider's `/models` list is learned and used; 5xx/timeout -> model paused 5 min; then next provider. Every switch is saved in the workflow history, which the AI reads on the next cycle.

## 8. Limits of this version
- Facebook/LinkedIn/EmailJS/AI live calls are not tested here (tests use mocks). Test each connection once from the dashboard.
- Single server instance only (in-process timers).
- Staff photos are stored in the database (about 10-20 KB each).
- Likes/comments/shares are detected by polling, so alerts can be up to about 8 minutes late.
