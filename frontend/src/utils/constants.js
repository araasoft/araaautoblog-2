export const LOGO = "/logo.png";

export const LABEL = {
  facebook: "Facebook",
  linkedin_personal: "LinkedIn profile",
  linkedin_company: "LinkedIn page",
};

export const ROLE_NAME = {
  super: "Super admin",
  manager: "Manager",
  admin: "Manager",
  content_creator: "Content creator",
  analyst: "Analyst",
  seo_specialist: "SEO specialist",
  community_manager: "Community manager",
  guest: "Guest (view only)",
  pending: "No access",
};

/** Pages a guest can open, and the only permissions they hold. Everything else is disabled. */
export const GUEST_ROUTES = ["home", "posts", "post", "analytics", "news"];
export const GUEST_PERMS = ["analytics.view", "news.view"];
export const GUEST_ROLE = { guest: "Guest (view only)" };

/** [route, label, icon, permission needed ("" = everyone)] */
export const MENU = [
  ["home", "Home", "home", ""],
  ["create", "Create post", "plus", "post.create"],
  ["posts", "Posts", "list", ""],
  ["analytics", "Analytics", "chart", "analytics.view"],
  ["news", "News", "news", "news.view"],
  ["ai", "Marketing AI", "ai", "analytics.view"],
  ["agent", "AI tools", "star", "ai.use"],
  ["brand", "Brand", "star", "brand.edit"],
  ["mail", "Email & alerts", "send", "mail.manage"],
  ["activity", "Activity", "clock", "activity.view"],
  ["users", "Team", "users", "users.view"],
  ["profile", "My profile", "shield", ""],
  ["settings", "Settings", "set", "settings.edit"],
  ["auto", "Automation", "zap", "automation.control"],
];

export const TITLES = {
  analytics: "Analytics",
  ai: "Marketing AI",
  mail: "Email & alerts",
  profile: "My profile",
  notifications: "Notifications",
  adduser: "Add admin",
  home: "Home",
  create: "Create post",
  posts: "Posts",
  post: "Post",
  news: "News",
  agent: "AI tools",
  brand: "Brand",
  activity: "Activity",
  users: "Team",
  user: "Team member",
  settings: "Settings",
  auto: "Automation",
};

export const NAV_GROUP = { post: "posts", user: "users", adduser: "users", notifications: "home" };

export const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const NOTE_ICON = { create: "send", edit: "edit", delete: "del", like: "like", comment: "cmt", share: "share", breaking: "zap", security: "shield", admin: "users", ai: "ai", system: "bell" };

export const TIME_ZONES = [
  [180, "Qatar (UTC+3)"],
  [330, "Sri Lanka / India (UTC+5:30)"],
  [0, "UTC"],
  [240, "UAE (UTC+4)"],
  [300, "Pakistan (UTC+5)"],
];

export const JOB_STATUS = {
  pending: ["Waiting", ""],
  running: ["Running", "warn"],
  done: ["Posted", "ok"],
  awaiting_approval: ["Needs approval", "warn"],
  failed: ["Failed", "bad"],
  missed: ["Missed", "bad"],
  skipped: ["Skipped", "warn"],
  cancelled: ["Cancelled", ""],
};

export const POST_TYPE = { text: "Text", image: "Image only", both: "Text + image" };

export const AGENT_TASKS = [
  ["calendar", "7-day plan", "Focus or topic (optional), e.g. promote our mobile app service"],
  ["ideas", "Ideas", "What should the ideas be about? (optional)"],
  ["caption", "Caption", "Paste your draft post here"],
  ["seo", "SEO & tags", "Topic or page, e.g. web development in Qatar"],
  ["strategy", "Strategy", "Your goal, e.g. get 10 new leads this month"],
  ["ads", "Ad copy", "What are we advertising?"],
  ["chat", "Ask", "Ask any marketing question"],
];

export const DEFAULT_BRAND = {
  name: "Araa Softwares",
  motto: "Empowering the world through intelligent software.",
  website: "https://araasoftwares.com",
  services: "web development, mobile apps, AI automation and startup solutions",
  audience: "small and medium businesses and startups in Qatar and Sri Lanka",
  tone: "friendly professional",
  avoid: "",
  mix: { educational: 50, informational: 30, promotional: 20 },
};

export const LOG_CLASS = { error: "bad", stop: "bad", skipped: "warn", publish: "ok" };

export const LS_KEYS = { theme: "araaTheme", draft: "araa_draft" };
