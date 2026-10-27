import { api } from "./api";
import { notify } from "../utils/notify";
import { confirmAlert } from "../utils/alerts";

/** Toggles the emergency stop. Returns true when the state changed. */
export async function toggleEmergencyStop() {
  const s = await api("GET", "/api/status");
  const on = !s.settings.paused;
  if (on) {
    const ok = await confirmAlert({
      title: "Stop all automatic posting?",
      text: "Nothing will be posted automatically until you resume.",
      confirmText: "Emergency stop",
      danger: true,
      icon: "warning",
    });
    if (!ok) return false;
  }
  await api("PUT", "/api/settings", { paused: on });
  (on ? notify.error : notify.success)(on ? "Emergency stop ON" : "Automation resumed");
  return true;
}
