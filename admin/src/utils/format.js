export const fmt = (ms) =>
  new Date(ms).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export const fmtTime = (ms) =>
  new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export const ago = (ms) => {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return Math.floor(s / 60) + "m";
  if (s < 86400) return Math.floor(s / 3600) + "h";
  if (s < 604800) return Math.floor(s / 86400) + "d";
  return new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
};

export const initial = (n) => (n || "?").trim().charAt(0).toUpperCase();

export const safeUrl = (u) => (/^https?:\/\//i.test(u) ? u : "#");

export const money = (x) => (x == null ? "n/a" : "$" + Number(x).toFixed(4));

export const num = (n) => Number(n || 0).toLocaleString();
export const hh = (h) => String(h).padStart(2, "0") + ":00";
