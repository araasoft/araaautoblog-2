# AraaBlogs (Vite + React + Tailwind + Firebase)
npm i && npm run dev
- /blogs  -> Firebase `posts` (cards: image fades out at the bottom)
- /news   -> Firebase `analytics/posts` (image joined from `posts/<same id>`)
- /admin -> private subscriber manager (login required, only VITE_ADMIN_EMAILS). Not linked in the public nav. Public forms on Home + article only write/remove, never read. Writes `subscribers/<id>` {name,email,notify,active,at,source,token}
Put your logo at public/logo.png. Optional: copy .env.example to .env.
Secure RTDB rules before production: subscribers read must be admin-only.

Deploy `database.rules.json` (Firebase console > Realtime Database > Rules) and enable Email/Password sign-in, then create your admin user. Change the email in the rules and in VITE_ADMIN_EMAILS.

Readers: Login/Signup (email + Google) from the nav. Logged-in readers can like, save (Saved chip on /blogs) and comment. Enable Google in Firebase Auth. Data: blog_likes/<post>/<uid>, blog_favs/<uid>/<post>, blog_comments/<post>/<id>. Admin account only has extra access to /admin.

Auto images: posts/news without an image get one automatically (cached per post in localStorage): Unsplash (if VITE_UNSPLASH_KEY) -> Wikimedia Commons CC0/Public-Domain photos -> Picsum. All free to use with no attribution required.

## SEO
- Runtime (useSeo): per-route title, description, canonical, robots, Open Graph, Twitter, JSON-LD (Organization, WebSite+SearchAction, Blog, BlogPosting, BreadcrumbList, CollectionPage/ItemList).
- Build (`npm run build`): scripts/prerender.mjs pulls posts from Firebase and writes static HTML for /, /blogs and every /blogs/<id> (crawlers see real content without JS), plus sitemap.xml (images + lastmod), feed.xml (RSS), robots.txt.
- Set VITE_SITE_URL, deploy with `firebase deploy` (firebase.json adds SPA rewrites, caching, security headers), then submit /sitemap.xml in Google Search Console and Bing Webmaster.
- Rebuild/redeploy on a schedule (e.g. daily GitHub Action) so new posts get static pages and sitemap entries.
- /news, /admin, saved and search views are noindex (duplicate/private).
