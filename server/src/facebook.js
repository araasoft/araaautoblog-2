// Facebook Page client (Node 18+, no dependencies)
export const httpError = (status, message, extra = {}) =>
  Object.assign(new Error(message), { status, ...extra });

function cfg() {
  const id = process.env.FB_PAGE_ID;
  const token = process.env.FB_PAGE_TOKEN;
  if (!id || !token) throw httpError(500, "Set FB_PAGE_ID and FB_PAGE_TOKEN in the server environment");
  return { id, token, graph: `https://graph.facebook.com/${process.env.FB_API_VERSION || "v21.0"}` };
}

async function call(method, path, params = {}, file) {
  const { token, graph } = cfg();
  const url = new URL(`${graph}/${path}`);
  const opts = { method, signal: AbortSignal.timeout(90_000) };
  const clean = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");

  if (method === "POST") {
    if (file) {
      const form = new FormData();
      form.set("access_token", token);
      for (const [k, v] of clean) form.set(k, String(v));
      form.set("source", new Blob([file.buffer], { type: file.mime || "image/jpeg" }), "photo.jpg");
      opts.body = form;
    } else {
      const body = new URLSearchParams({ access_token: token });
      for (const [k, v] of clean) body.set(k, String(v));
      opts.body = body;
    }
  } else {
    url.searchParams.set("access_token", token);
    for (const [k, v] of clean) url.searchParams.set(k, String(v));
  }

  opts.signal = AbortSignal.timeout(Number(process.env.FB_TIMEOUT_MS || 30000)); // no request may hang forever
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const e = data.error || {};
    let msg = e.message || `Facebook request failed (${res.status})`;
    if (e.code === 190) msg = `Facebook token is invalid or expired - create a new Page access token. (${msg})`;
    throw httpError(res.ok ? 400 : res.status, msg, { code: e.code, subcode: e.error_subcode, fbtrace_id: e.fbtrace_id });
  }
  return data;
}

// Facebook accepts scheduled posts 10 minutes to 30 days ahead.
function schedule(scheduleAt) {
  if (!scheduleAt) return {};
  const ts = Math.floor(new Date(scheduleAt).getTime() / 1000);
  if (!ts) throw httpError(400, "Invalid schedule time");
  const now = Date.now() / 1000;
  if (ts < now + 630) throw httpError(400, "Schedule time must be at least 10 minutes from now");
  if (ts > now + 30 * 86400) throw httpError(400, "Schedule time must be within 30 days");
  return { published: false, scheduled_publish_time: ts };
}

// Text (and/or link) post
export function createPost({ message, link, scheduleAt }) {
  const { id } = cfg();
  return call("POST", `${id}/feed`, { message, link, ...schedule(scheduleAt) });
}

// Photo post from a public URL or an uploaded buffer. Empty caption = image only.
export function createPhotoPost({ imageUrl, imageBuffer, mime, caption, scheduleAt }) {
  const { id } = cfg();
  const params = { caption, ...schedule(scheduleAt) };
  if (imageBuffer) return call("POST", `${id}/photos`, params, { buffer: imageBuffer, mime });
  return call("POST", `${id}/photos`, { ...params, url: imageUrl });
}

export const updatePost = (postId, message) => call("POST", postId, { message });
export const deletePost = (postId) => call("DELETE", postId);
export const getPost = (postId) =>
  call("GET", postId, { fields: "id,message,created_time,is_published,permalink_url" });

export function listPosts(limit = 10) {
  const { id } = cfg();
  return call("GET", `${id}/published_posts`, {
    fields: "id,message,created_time,permalink_url,full_picture",
    limit,
  });
}

export function listScheduled(limit = 10) {
  const { id } = cfg();
  return call("GET", `${id}/scheduled_posts`, {
    fields: "id,message,scheduled_publish_time,full_picture",
    limit,
  });
}

export async function checkConnection() {
  try {
    const { id } = cfg();
    const d = await call("GET", id, { fields: "name" });
    return { ok: true, name: d.name };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ---- Engagement: reactions, shares, comments (needs pages_read_engagement; replying needs pages_manage_engagement) ----
const cm = "id,message,created_time,like_count,from{name,picture{url}}";
export async function getEngagement(postId, limit = 30) {
  const d = await call("GET", postId, {
    fields:
      `reactions.summary(total_count).limit(0),shares,` +
      `comments.summary(total_count).order(reverse_chronological).limit(${limit}){${cm},comments.limit(10){${cm}}}`,
  });
  return {
    likes: d.reactions?.summary?.total_count || 0,
    shares: d.shares?.count || 0,
    commentsTotal: d.comments?.summary?.total_count || 0,
    comments: d.comments?.data || [],
  };
}
export const replyToComment = (commentId, message) => call("POST", `${commentId}/comments`, { message });
export const likeComment = (commentId) => call("POST", `${commentId}/likes`);

// ---- Insights (Meta replaced post_impressions* with post_media_view* in Nov 2025 / June 2026) ----
// views = post_media_view (what used to be "impressions"), reach = post_total_media_view_unique. Each metric is asked
// separately so one invalid metric never loses the other.
export async function getInsights(postId) {
  const out = { views: null, reach: null };
  for (const [key, metric] of [["views", "post_media_view"], ["reach", "post_total_media_view_unique"]]) {
    try {
      const d = await call("GET", `${postId}/insights`, { metric, period: "lifetime" });
      const v = d.data?.[0]?.values?.[0]?.value;
      out[key] = typeof v === "number" ? v : null;
    } catch (e) {
      out[key + "Error"] = e.message;
    }
  }
  return out;
}
// Cheap counters only (no comment bodies): likes, comments, shares.
export async function getCounts(postId) {
  const d = await call("GET", postId, { fields: "reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0),shares" });
  return { likes: d.reactions?.summary?.total_count || 0, comments: d.comments?.summary?.total_count || 0, shares: d.shares?.count || 0 };
}
export async function latestComment(postId) {
  const d = await call("GET", postId, { fields: "comments.order(reverse_chronological).limit(1){message,from{name}}" });
  const c = d.comments?.data?.[0];
  return c ? { by: c.from?.name || "Someone", text: String(c.message || "").slice(0, 160) } : null;
}
