import { Notyf } from "notyf";
import "notyf/notyf.min.css";

let instance;
function get() {
  if (!instance) {
    instance = new Notyf({
      position: { x: "center", y: "bottom" },
      dismissible: true,
      ripple: false,
      types: [
        { type: "success", background: "var(--ok)", duration: 3200, icon: false },
        { type: "error", background: "var(--bad)", duration: 5200, icon: false },
        { type: "info", background: "#14124a", duration: 3000, icon: false },
      ],
    });
  }
  return instance;
}

const html = (m) =>
  String(m ?? "")
    .replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])
    .replace(/\n/g, "<br>");

export const notify = {
  success: (m) => get().open({ type: "success", message: html(m) }),
  error: (m) => get().open({ type: "error", message: html(m) }),
  info: (m) => get().open({ type: "info", message: html(m) }),
};
