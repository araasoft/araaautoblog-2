import Icon from "./Icon";

export default function LockRow({ label, value }) {
  return (
    <div className="opt">
      <div>
        <b>{label}</b>
        <small>{value || "-"}</small>
      </div>
      <span className="pill" title="Only the super admin can change this">
        <Icon name="lock" /> locked
      </span>
    </div>
  );
}
