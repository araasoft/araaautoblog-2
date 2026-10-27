import { LABEL } from "../utils/constants";
import Icon from "./Icon";

/** Checkbox chips for choosing platforms. `targets` = list of keys, `value` = selected keys. */
export default function TargetPicker({ targets, value, onChange, labels = {} }) {
  const toggle = (t) => onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t]);
  return (
    <div className="chips">
      {targets.map((t) => (
        <label className="chip" key={t}>
          <input type="checkbox" checked={value.includes(t)} onChange={() => toggle(t)} />
          <span className={t === "facebook" ? "fbc" : "lic"}>
            <Icon name={t === "facebook" ? "fb" : "li"} />
          </span>
          {labels[t] || LABEL[t]}
        </label>
      ))}
    </div>
  );
}
