// Post records: one entry per post made through AraaPosts, kept in the database ("posts/<id>").
// A record remembers where the post went (Facebook, LinkedIn profile, LinkedIn company page),
// who made it, and lets you edit or delete it on one platform or on all of them.
// Images are never stored: only the text, the author and the platform post ids.
import crypto from "crypto";
import * as db from "./db.js";
import * as fb from "./facebook.js";
import * as li from "./linkedin.js";
import * as notify from "./notify.js";

const { httpError } = fb;
export const TARGETS = ["facebook", "linkedin_personal", "linkedin_company"];

const newId = () => String(Date.now()).padStart(13, "0") + "-" + crypto.randomBytes(3).toString("hex");
const checkId = (id) => {
  if (!/^[\w-]{1,40}$/.test(String(id))) throw httpError(400, "Bad post id");
  return String(id);
};

const ops = {
  facebook: {
    edit: (t, text) => fb.updatePost(t.postId, text),
    async del(t) {
      try {
        await fb.deletePost(t.postId);
      } catch (e) {
        if (e.code === 100 && e.subcode === 33) return { alreadyGone: true }; // post no longer exists on Facebook
        throw e;
      }
    },
  },
  linkedin_personal: { edit: (t, text) => li.updatePost(t.postId, text), del: (t) => li.deletePost(t.postId) },
  linkedin_company: { edit: (t, text) => li.updatePost(t.postId, text), del: (t) => li.deletePost(t.postId) },
};

// results: { facebook: {ok, id, post_id}, linkedin_personal: {ok, id, url}, ... } as returned when publishing.
export async function track({ text, author, source, imageUrl, hasImage, results, scheduledAt }) {
  const targets = {};
  for (const [k, r] of Object.entries(results || {})) {
    if (!r?.ok || !TARGETS.includes(k)) continue;
    const postId = k === "facebook" ? r.post_id || r.id : r.id;
    if (!postId) continue;
    targets[k] = {
      postId,
      url: k === "facebook" ? `https://www.facebook.com/${postId}` : r.url,
      ...(k === "facebook" && scheduledAt ? { scheduledAt: new Date(scheduledAt).getTime() } : {}),
    };
  }
  if (!Object.keys(targets).length) return null;
  const rec = {
    text: String(text || ""),
    createdAt: Date.now(),
    author: { uid: author?.uid || "", name: author?.name || "Unknown", email: author?.email || "" },
    source: source || "manual", // manual | automation | ai | approved
    hasImage: Boolean(hasImage),
    ...(imageUrl ? { imageUrl } : {}),
    targets,
  };
  const id = newId();
  await db.set(`posts/${id}`, rec);
  // Tell the admins (in-app + email) and, for posts that are live now, the subscribers.
  const url = Object.values(targets)[0]?.url || "";
  const where = Object.keys(targets).map((t) => t.replace("linkedin_", "LinkedIn ").replace("facebook", "Facebook")).join(", ");
  notify.event("create", { title: scheduledAt ? "Post scheduled" : "New post published", detail: `${where}: ${rec.text.slice(0, 160)}`, by: rec.author.name, url }).catch(() => {});
  if (!scheduledAt && rec.text) notify.mailSubscribers({ text: rec.text, url });
  return { id, ...rec };
}

export async function list(limit = 20) {
  const raw = (await db.get("posts", { limitToLast: limit })) || {};
  return Object.entries(raw)
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([id, r]) => ({ id, ...r }));
}

export const owner = async (id) => (await db.get(`posts/${checkId(id)}/author/uid`)) || "";
const load = async (id) => {
  const rec = await db.get(`posts/${checkId(id)}`);
  if (!rec) throw httpError(404, "Post not found (it may already be deleted)");
  return rec;
};

function pick(rec, wanted) {
  const have = Object.keys(rec.targets || {});
  const list = wanted?.length ? wanted : have;
  if (!list.every((t) => TARGETS.includes(t))) throw httpError(400, "Unknown platform");
  const use = list.filter((t) => have.includes(t));
  if (!use.length) throw httpError(400, "Choose at least one platform this post is on");
  return use;
}

async function each(use, fn) {
  const results = {};
  await Promise.all(
    use.map(async (t) => {
      try {
        results[t] = { ok: true, ...((await fn(t)) || {}) };
      } catch (e) {
        results[t] = { ok: false, error: e.message };
      }
    }),
  );
  return results;
}

export async function edit(id, { text, targets, by }) {
  const rec = await load(id);
  const body = String(text || "").trim();
  if (!body) throw httpError(400, "Text is empty");
  const use = pick(rec, targets);
  const results = await each(use, (t) => ops[t].edit(rec.targets[t], body));
  if (Object.values(results).some((r) => r.ok))
    await db.update(`posts/${id}`, { text: body, updatedAt: Date.now(), editedBy: by?.name || "" });
  if (Object.values(results).some((r) => r.ok))
    notify.event("edit", { title: "Post edited", detail: body.slice(0, 200), by: by?.name || "", url: Object.values(rec.targets)[0]?.url }).catch(() => {});
  return { results };
}

export async function remove(id, { targets, by } = {}) {
  const rec = await load(id);
  const use = pick(rec, targets);
  const results = await each(use, (t) => ops[t].del(rec.targets[t]));
  for (const t of use) if (results[t].ok) await db.remove(`posts/${id}/targets/${t}`);
  if (Object.values(results).some((r) => r.ok))
    notify.event("delete", { title: "Post deleted", detail: String(rec.text || "").slice(0, 200), by: by?.name || "", level: "warning" }).catch(() => {});
  const left = (await db.get(`posts/${id}/targets`)) || {};
  const removed = !Object.keys(left).length;
  if (removed) await db.remove(`posts/${id}`);
  return { results, removed };
}
