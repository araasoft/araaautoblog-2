import { motion } from "framer-motion";
import { useId } from "react";

/** options: [[value, label(node)], ...] */
export default function Segmented({ options, value, onChange, className = "", style }) {
  const id = useId();
  return (
    <div className={`seg ${className}`} style={style} role="tablist">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={v === value}
          className={v === value ? "on" : ""}
          onClick={() => onChange(v)}
        >
          {v === value && (
            <motion.span
              layoutId={`seg-${id}`}
              transition={{ type: "spring", stiffness: 500, damping: 36 }}
              style={{
                position: "absolute",
                inset: 0,
                borderRadius: 12,
                background: "var(--card)",
                boxShadow: "var(--sh)",
                zIndex: 0,
              }}
            />
          )}
          <span style={{ position: "relative", zIndex: 1, display: "inline-flex", alignItems: "center", gap: 8 }}>
            {label}
          </span>
        </button>
      ))}
    </div>
  );
}
