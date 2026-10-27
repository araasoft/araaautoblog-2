import { num } from "../utils/format";

export function Bars({ rows, label, val }) {
  if (!rows.length) return <div className="hint">Not enough data yet</div>;
  const mx = Math.max(1, ...rows.map(val));
  return rows.map((r, i) => (
    <div key={i} className="row" style={{ flexWrap: "nowrap", margin: "6px 0" }}>
      <span style={{ minWidth: 62, fontWeight: 700 }}>{label(r)}</span>
      <div style={{ flex: 1, background: "var(--pale)", borderRadius: 99, height: 12, overflow: "hidden" }}>
        <div style={{ width: Math.max(4, (val(r) / mx) * 100) + "%", height: "100%", background: "linear-gradient(90deg,var(--pri),var(--pri2))" }} />
      </div>
      <small className="hint" style={{ margin: 0, minWidth: 92, textAlign: "right" }}>
        avg {num(r.avg)} · {r.n} post{r.n > 1 ? "s" : ""}
      </small>
    </div>
  ));
}

export function Chips({ rows, k }) {
  if (!rows.length) return <div className="hint">Not enough data yet</div>;
  return (
    <div className="row">
      {rows.map((r, i) => (
        <span key={i} className="pill" title={`average score ${num(r.avg)} over ${r.n} post(s)`}>
          {r[k]} · {num(r.avg)}
        </span>
      ))}
    </div>
  );
}
