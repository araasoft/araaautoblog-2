import Swal from "sweetalert2";

const base = {
  customClass: { popup: "araa-swal" },
  showClass: { popup: "swal2-show" },
  reverseButtons: true,
  focusCancel: true,
  buttonsStyling: true,
};

/** Returns true when the user confirms. */
export async function confirmAlert({
  title = "Are you sure?",
  text = "",
  confirmText = "Yes",
  cancelText = "Cancel",
  danger = false,
  icon = "question",
} = {}) {
  const r = await Swal.fire({
    ...base,
    title,
    text,
    icon,
    showCancelButton: true,
    confirmButtonText: confirmText,
    cancelButtonText: cancelText,
    confirmButtonColor: danger ? "#c0392b" : undefined,
  });
  return r.isConfirmed;
}

export const confirmDanger = (opts) =>
  confirmAlert({ icon: "warning", danger: true, confirmText: "Delete", ...opts });

export function infoAlert(title, text, icon = "info") {
  return Swal.fire({ ...base, title, text, icon, confirmButtonText: "OK" });
}
