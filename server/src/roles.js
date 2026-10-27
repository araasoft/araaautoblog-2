// Roles and permissions. Checked on the SERVER for every request (the dashboard only hides buttons).
// "admin" is the old role name: it now means Manager.
export const ROLES = {
  super:             { label: "Super admin",       perms: ["*"] },
  manager:           { label: "Manager",           perms: ["post.create", "post.edit", "post.delete", "ai.use", "draft.approve", "engage.reply", "analytics.view", "analytics.refresh", "news.view", "settings.edit", "automation.control", "marketing.run", "brand.edit", "activity.view", "mail.manage", "users.view"] },
  content_creator:   { label: "Content creator",   perms: ["post.create", "post.edit.own", "ai.use", "analytics.view", "news.view", "users.view"] },
  analyst:           { label: "Analyst",           perms: ["analytics.view", "analytics.refresh", "news.view", "activity.view", "export", "users.view"] },
  seo_specialist:    { label: "SEO specialist",    perms: ["ai.use", "analytics.view", "analytics.refresh", "news.view", "brand.edit", "marketing.run.seo", "post.create", "post.edit.own", "users.view"] },
  guest:             { label: "Guest (view only)", perms: ["analytics.view", "news.view"], readOnly: true },
  community_manager: { label: "Community manager", perms: ["engage.reply", "analytics.view", "news.view", "post.create", "post.edit.own", "users.view"] },
};
export const POSITIONS = Object.fromEntries(Object.entries(ROLES).map(([k, v]) => [k, v.label]));
export const normRole = (r) => (r === "admin" ? "manager" : r);
export const isStaff = (r) => Boolean(ROLES[normRole(r)]);
export function can(role, perm) {
  const p = ROLES[normRole(role)]?.perms || [];
  return p.includes("*") || p.includes(perm);
}
// need("post.delete") -> Express middleware. A route may accept several permissions: need("a", "b") = a OR b.
export const need = (...perms) => (req, res, next) =>
  perms.some((p) => can(req.user?.role, p)) ? next() : res.status(403).json({ error: "Your role does not allow this", code: "forbidden", need: perms[0] });
export const permList = (role) => (can(role, "x") && ROLES[normRole(role)]?.perms.includes("*") ? ["*"] : ROLES[normRole(role)]?.perms || []);

// ---- Guest (view-only) accounts: may only READ these endpoints. Every other request is refused, whatever the permission list says.
export const isReadOnly = (r) => Boolean(ROLES[normRole(r)]?.readOnly);
const GUEST_READ = [/^\/(me|status|records|posts|scheduled|analytics|news)$/, /^\/engagement\/[^/]+$/];
export const guestAllowed = (method, path) => method === "GET" && GUEST_READ.some((r) => r.test(path));
export const guestGuard = (req, res, next) =>
  !isReadOnly(req.user?.role) || guestAllowed(req.method, req.path)
    ? next()
    : res.status(403).json({ error: "Guest accounts are view-only", code: "guest_readonly" });
