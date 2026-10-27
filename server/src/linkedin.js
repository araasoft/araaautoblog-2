// LinkedIn client (Node 18+, no dependencies).
// Posts to your personal profile (urn:li:person) and/or your company page (urn:li:organization).
import crypto from "crypto";
import { httpError } from "./facebook.js";
import { getLinkedIn, saveLinkedIn } from "./store.js";

const API = "https://api.linkedin.com";
const MAX_TEXT = 3000;

const env = () => ({
  clientId: process.env.LI_CLIENT_ID,
  clientSecret: process.env.LI_CLIENT_SECRET,
  redirectUri: process.env.LI_REDIRECT_URI,
  orgId: String(process.env.LI_ORG_ID || "").replace(/\D/g, ""),
  version: process.env.LI_API_VERSION || "202609",
  scopes: process.env.LI_SCOPES || "openid profile w_member_social w_organization_social",
});

// A token pasted into LI_ACCESS_TOKEN works too; OAuth-connected token (saved in DATA_DIR) wins.
function auth() {
  const saved = getLinkedIn();
  const token = saved.accessToken || process.env.LI_ACCESS_TOKEN;
  if (!token) throw httpError(400, "LinkedIn is not connected. Open Automation > LinkedIn and press Connect.");
  if (saved.accessToken && saved.expiresAt && Date.now() > saved.expiresAt)
    throw httpError(401, "LinkedIn token expired - press Connect LinkedIn again (tokens last about 60 days).");
  return { token, saved };
}

// LinkedIn retires API versions after ~12 months ("Requested version X is not active").
// When that happens, walk back from the current month and remember the first version that works.
let workingVersion;
function versionCandidates() {
  const list = [];
  const d = new Date();
  for (let i = 0; i < 14; i++) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    list.push(`${x.getUTCFullYear()}${String(x.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return list;
}

async function li(method, path, opts = {}) {
  if (opts.raw) return li1(method, path, opts, undefined);
  const tried = new Set();
  const queue = [workingVersion || env().version, ...versionCandidates()];
  let last;
  for (const v of queue) {
    if (tried.has(v)) continue;
    tried.add(v);
    try {
      const r = await li1(method, path, opts, v);
      workingVersion = v;
      return r;
    } catch (e) {
      last = e;
      if (!/not active|version/i.test(e.message) || ![400, 426].includes(e.status)) throw e;
    }
  }
  throw last;
}

async function li1(method, path, { body, headers = {}, raw } = {}, version) {
  const { token } = auth();
  const res = await fetch(raw || `${API}${path}`, {
    method,
    signal: AbortSignal.timeout(90_000),
    headers: {
      Authorization: `Bearer ${token}`,
      ...(raw ? {} : { "Linkedin-Version": version, "X-Restli-Protocol-Version": "2.0.0" }),
      ...(body && !Buffer.isBuffer(body) ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body ? (Buffer.isBuffer(body) ? body : JSON.stringify(body)) : undefined,
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { /* empty or non-JSON body */ }
  if (!res.ok) {
    let msg = data.message || `LinkedIn request failed (${res.status})`;
    if (res.status === 401) msg = `LinkedIn token is invalid or expired - press Connect LinkedIn again. (${msg})`;
    if (res.status === 403) msg = `LinkedIn refused this action - check the app products/scopes and that you are admin of the page. (${msg})`;
    throw httpError(res.status, msg, { code: data.code });
  }
  return { data, headers: res.headers };
}

/* ---------------- OAuth (connect once from the dashboard) ---------------- */
const pending = new Map(); // state -> expiry

export function connectUrl() {
  const e = env();
  if (!e.clientId || !e.clientSecret || !e.redirectUri)
    throw httpError(500, "Set LI_CLIENT_ID, LI_CLIENT_SECRET and LI_REDIRECT_URI on the server");
  const state = crypto.randomBytes(24).toString("hex");
  pending.set(state, Date.now() + 10 * 60_000);
  for (const [k, t] of pending) if (t < Date.now()) pending.delete(k);
  const p = new URLSearchParams({
    response_type: "code",
    client_id: e.clientId,
    redirect_uri: e.redirectUri,
    state,
    scope: e.scopes,
  });
  return { url: `https://www.linkedin.com/oauth/v2/authorization?${p}` };
}

export async function handleCallback({ code, state }) {
  const exp = pending.get(state);
  pending.delete(state);
  if (!code || !exp || exp < Date.now()) throw httpError(400, "Connection link expired or invalid - start again from the dashboard");
  const e = env();
  const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    signal: AbortSignal.timeout(30_000),
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: e.redirectUri,
      client_id: e.clientId,
      client_secret: e.clientSecret,
    }),
  });
  const t = await res.json().catch(() => ({}));
  if (!res.ok || !t.access_token) throw httpError(400, t.error_description || "LinkedIn did not return a token");

  const prev = getLinkedIn();
  saveLinkedIn({ ...prev, accessToken: t.access_token, expiresAt: Date.now() + (t.expires_in || 5_184_000) * 1000 });
  // Look up the member id (needed for the personal-profile author URN)
  const { data: me } = await li("GET", "/v2/userinfo");
  saveLinkedIn({
    ...getLinkedIn(),
    personUrn: `urn:li:person:${me.sub}`,
    name: me.name || [me.given_name, me.family_name].filter(Boolean).join(" "),
    connectedAt: Date.now(),
  });
}

export function disconnect() {
  saveLinkedIn({});
  return { success: true };
}

/* ---------------- Status ---------------- */
export async function checkConnection() {
  const e = env();
  const s = getLinkedIn();
  const hasToken = Boolean(s.accessToken || process.env.LI_ACCESS_TOKEN);
  const out = {
    configured: Boolean(e.clientId && e.clientSecret && e.redirectUri) || Boolean(process.env.LI_ACCESS_TOKEN),
    connected: hasToken && !(s.expiresAt && Date.now() > s.expiresAt),
    name: s.name,
    personal: Boolean(s.personUrn || process.env.LI_PERSON_URN),
    company: Boolean(e.orgId),
    expiresAt: s.expiresAt,
  };
  if (hasToken && !out.connected) out.error = "Token expired - connect again";
  return out;
}

/* ---------------- Posting ---------------- */
// LinkedIn "little text" format: these characters must be escaped or the post is cut short.
// "#word" is left alone so hashtags still work.
export const escapeText = (t) =>
  String(t || "")
    .replace(/[\\|{}@[\]()<>*_~]/g, "\\$&")
    .replace(/#(?!\w)/g, "\\#");

async function authorUrn(target) {
  if (target === "company") {
    const { orgId } = env();
    if (!orgId) throw httpError(400, "Set LI_ORG_ID (numeric company page id) to post to the company page");
    return `urn:li:organization:${orgId}`;
  }
  const saved = getLinkedIn();
  const urn = saved.personUrn || process.env.LI_PERSON_URN;
  if (urn) return urn;
  // Token known but member id missing (e.g. saved file lost or lookup failed earlier): fetch it now.
  const { data: me } = await li("GET", "/v2/userinfo");
  if (!me.sub) throw httpError(400, "Personal profile id unknown - press Connect LinkedIn, or set LI_PERSON_URN");
  saveLinkedIn({ ...saved, personUrn: `urn:li:person:${me.sub}`, name: saved.name || me.name });
  return `urn:li:person:${me.sub}`;
}

async function uploadImage(owner, buffer) {
  const { data } = await li("POST", "/rest/images?action=initializeUpload", {
    body: { initializeUploadRequest: { owner } },
  });
  const { uploadUrl, image } = data.value || {};
  if (!uploadUrl || !image) throw httpError(502, "LinkedIn did not return an upload URL");
  await li("PUT", "", { raw: uploadUrl, body: buffer, headers: { "Content-Type": "application/octet-stream" } });
  return image;
}

// target: "personal" | "company". Needs text, or an image, or a link.
export async function createPost({ target, text, imageBuffer, mime, link }) {
  const body = (text || "").trim();
  if (!body && !imageBuffer && !link) throw httpError(400, "Add some text or an image");
  if (body.length > MAX_TEXT) throw httpError(400, `LinkedIn posts are limited to ${MAX_TEXT} characters`);
  if (imageBuffer && !/^image\/(jpeg|png|gif)$/.test(mime || "image/jpeg"))
    throw httpError(400, "LinkedIn accepts JPG, PNG or GIF images only");

  const author = await authorUrn(target);
  const post = {
    author,
    commentary: escapeText(body),
    visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED",
    isReshareDisabledByAuthor: false,
  };
  if (imageBuffer) post.content = { media: { id: await uploadImage(author, imageBuffer) } };
  else if (link) {
    let title = link;
    try { title = new URL(link).hostname; } catch { throw httpError(400, "Invalid link"); }
    post.content = { article: { source: link, title } };
  }

  const { headers } = await li("POST", "/rest/posts", { body: post });
  const id = headers.get("x-restli-id");
  return { id, url: id ? `https://www.linkedin.com/feed/update/${id}/` : undefined };
}

const sniffMime = (b) =>
  b[0] === 0x89 && b[1] === 0x50 ? "image/png" : b[0] === 0x47 && b[1] === 0x49 ? "image/gif" : b[0] === 0x52 && b[1] === 0x49 ? "image/webp" : "image/jpeg";

// Post the same content to several targets ("personal", "company"). One failing never stops the other.
// Returns { personal: {ok, id, url} | {ok:false, error}, company: {...} }
export async function postMany(targets, { text, imageBuffer, link }) {
  const mime = imageBuffer ? sniffMime(imageBuffer) : undefined;
  const out = {};
  const list = [...new Set(targets)].filter((t) => t === "personal" || t === "company");
  await Promise.all(
    list.map(async (target) => {
      try {
        out[target] = { ok: true, ...(await createPost({ target, text, imageBuffer, mime, link })) };
      } catch (e) {
        out[target] = { ok: false, error: e.message };
      }
    }),
  );
  return out;
}

/* ---------------- Edit / delete ---------------- */
const enc = encodeURIComponent;

// LinkedIn only lets you change the text (commentary) of a published post.
export async function updatePost(urn, text) {
  const body = String(text || "").trim();
  if (!body) throw httpError(400, "Text is empty");
  if (body.length > MAX_TEXT) throw httpError(400, `LinkedIn posts are limited to ${MAX_TEXT} characters`);
  await li("POST", `/rest/posts/${enc(urn)}`, {
    body: { patch: { $set: { commentary: escapeText(body) } } },
    headers: { "X-RestLi-Method": "PARTIAL_UPDATE" },
  });
  return { success: true };
}

export async function deletePost(urn) {
  try {
    await li("DELETE", `/rest/posts/${enc(urn)}`, { headers: { "X-RestLi-Method": "DELETE" } });
  } catch (e) {
    if (e.status === 404) return { success: true, alreadyGone: true }; // deleted on LinkedIn already
    throw e;
  }
  return { success: true };
}

// ---- Analytics (company page posts only; LinkedIn gives no statistics for personal profile posts through the API) ----
// Needs the r_organization_social scope (add it to LI_SCOPES and reconnect). Returns { [postUrn]: {views, reach, likes, comments, shares, clicks} }.
export async function shareStats(urns) {
  const org = env().orgId;
  if (!org) throw httpError(400, "LI_ORG_ID is not set");
  const list = [...new Set(urns)].filter(Boolean).slice(0, 20);
  if (!list.length) return {};
  const shares = list.filter((u) => u.includes(":share:")), ugc = list.filter((u) => u.includes(":ugcPost:"));
  const q = [`q=organizationalEntity`, `organizationalEntity=${enc(`urn:li:organization:${org}`)}`];
  if (shares.length) q.push(`shares=List(${shares.map(enc).join(",")})`);
  if (ugc.length) q.push(`ugcPosts=List(${ugc.map(enc).join(",")})`);
  const { data } = await li("GET", `/rest/organizationalEntityShareStatistics?${q.join("&")}`, { headers: { "X-RestLi-Method": "FINDER" } });
  const out = {};
  for (const el of data?.elements || []) {
    const k = el.share || el.ugcPost, t = el.totalShareStatistics || {};
    if (k) out[k] = { views: t.impressionCount ?? null, reach: t.uniqueImpressionsCount ?? null, likes: t.likeCount || 0, comments: t.commentCount || 0, shares: t.shareCount || 0, clicks: t.clickCount || 0 };
  }
  return out;
}
