export default function Switch({ checked, onChange, id, label }) {
  return (
    <label className="sw">
      <input
        type="checkbox"
        id={id}
        aria-label={label}
        checked={!!checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <i />
    </label>
  );
}
