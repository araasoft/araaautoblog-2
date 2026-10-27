import { LABEL } from "./constants";
import { notify } from "./notify";

/** Normalises a stored record (multi-platform post) for the UI. */
export function normRec(r) {
  const t = r.targets || {};
  const lp = t.linkedin_personal;
  const lc = t.linkedin_company;
  const f = t.facebook;
  const lis = [];
  if (lp && lp.url) lis.push(["LinkedIn profile", lp.url]);
  if (lc && lc.url) lis.push(["LinkedIn page", lc.url]);
  return {
    key: "r" + r.id,
    rec: r,
    id: r.id,
    text: r.text || "",
    img: r.imageUrl || "",
    hasImg: r.hasImage,
    at: r.createdAt,
    fb: !!f,
    li: !!(lp || lc),
    fbId: f && f.postId,
    fbUrl: f && f.url,
    lis,
    author: r.author && r.author.name,
    source: r.source,
    sched: !!(f && f.scheduledAt && f.scheduledAt > Date.now()),
    schedAt: f && f.scheduledAt,
    edited: r.updatedAt,
  };
}

/** Normalises a raw Facebook Graph post. */
export const normFb = (p, scheduled) => ({
  key: "f" + p.id,
  id: p.id,
  old: true,
  text: p.message || "",
  img: p.full_picture || "",
  at: scheduled ? p.scheduled_publish_time * 1000 : Date.parse(p.created_time),
  fb: true,
  li: false,
  fbId: p.id,
  fbUrl: p.permalink_url || "",
  lis: [],
  sched: scheduled,
  schedAt: scheduled ? p.scheduled_publish_time * 1000 : 0,
});

export const liRes = (x) =>
  Object.fromEntries(Object.entries(x || {}).map(([k, v]) => ["linkedin_" + k, v]));

/** Shows one toast summarising per-platform results. Returns true when nothing failed. */
export function report(res, verb, scheduled) {
  const lines = [];
  let bad = false;
  for (const k in LABEL) {
    const r = res[k];
    if (!r) continue;
    if (r.ok) lines.push(LABEL[k] + ": " + (scheduled && k === "facebook" ? "scheduled" : verb));
    else {
      bad = true;
      lines.push(LABEL[k] + ": failed - " + r.error);
    }
  }
  if (lines.length) (bad ? notify.error : notify.success)(lines.join("\n"));
  return !bad;
}
