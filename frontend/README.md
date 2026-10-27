# AraaPosts (React + Vite)

Same UI as the single-file dashboard, split into components, pages, hooks, context and utils.

## Stack
React 18 · Vite 5 · React Router 6 · Tailwind CSS 3 · Firebase Auth (SDK) · SweetAlert2 (confirmations) · Notyf (toasts) · Framer Motion (animation)

## Run
```bash
npm install
cp .env.example .env      # fill in Firebase web config (optional, see below)
npm run dev               # http://localhost:5173, /api and /auth-config proxied to VITE_DEV_PROXY
npm run build             # output in dist/
```

## Firebase
Set the `VITE_FIREBASE_*` values in `.env`. If `VITE_FIREBASE_API_KEY` is empty, the app falls back to
the key served by your backend at `/auth-config` (exactly like the original page), so the existing
server keeps working unchanged.

## Routing
`BrowserRouter` is used by default (clean URLs such as `/posts`). Your server must return `index.html`
for unknown paths. If it cannot, set `VITE_ROUTER=hash` to keep the original `#/posts` style URLs.

## Structure
```
src/
  components/  Layout, Icon, Card, PostCard, Segmented, Switch, AsyncButton, TargetPicker, ...
  pages/       Login, Pending, Home, Create, Posts, PostDetail, News, Agent, Brand,
               Activity, Users, UserDetail, Settings, Automation,
               Analytics, Ai (Marketing AI), Mail, Profile, AddUser, Notifications
  hooks/       useAsync, useAsyncAction, useDocumentTitle, useAuth (re-exports)
  context/     AuthContext, ThemeContext, PostsContext
  services/    api.js (authenticated fetch, CSV download), automation.js
  utils/       constants, format, notify (Notyf), alerts (SweetAlert2), image, posts, storage
  lib/         firebase.js
```

## Logo
`public/logo.svg` is a placeholder. Put your real `logo.png` in `public/` and change `LOGO` in
`src/utils/constants.js` (and the favicon link in `index.html`).

## Permissions
A `guest` role is view-only: it can open Home, Posts, Analytics and News only; every other page is hidden and disabled, and `api()` refuses any non-GET request (edit `GUEST_ROUTES` / `GUEST_PERMS` in `utils/constants.js`). Create guests via Add admin, choosing "Guest (view only)". Enforce the same rule on the server.
The menu and routes follow `me.perms` returned by `/api/session` (same as the single-file page); `Gate` blocks pages the position does not include. The header bell polls `/api/notifications` every 25s.

## Talking to the backend
Hosted on a different origin (e.g. Firebase Hosting)? Set `VITE_API_BASE` to the server URL and add this site to the server's `ORIGINS`. Guests are `role: "guest"`: the page hides disabled pages and the server enforces the same view-only rule.
