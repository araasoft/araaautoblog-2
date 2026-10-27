import { useState } from "react";
import Icon from "../components/Icon";
import Card from "../components/Card";
import Empty from "../components/Empty";
import AsyncButton from "../components/AsyncButton";
import QueryState from "../components/QueryState";
import { useAsync } from "../hooks/useAsync";
import { api, downloadCsv } from "../services/api";
import { LOG_CLASS } from "../utils/constants";
import { fmt, money } from "../utils/format";

const EMPTY = { q: "", level: "", from: "", to: "" };
const qs = (o) => {
  const p = new URLSearchParams();
  for (const k of Object.keys(o)) if (o[k]) p.set(k, o[k]);
  return p;
};

export default function Activity() {
  const [applied, setApplied] = useState(EMPTY);
  const [draft, setDraft] = useState(EMPTY);
  const [page, setPage] = useState(1);

  const { data, loading, error, reload } = useAsync(async () => {
    const lq = qs(applied);
    lq.set("page", page);
    lq.set("pageSize", 20);
    const aq = qs({ from: applied.from, to: applied.to });
    const [d, lp, ac, al] = await Promise.all([
      api("GET", "/api/activity"),
      api("GET", "/api/activity/logs?" + lq),
      api("GET", "/api/ai-usage?" + aq).catch(() => null),
      api("GET", "/api/alerts").catch(() => []),
    ]);
    return { d, lp, ac, al };
  }, [applied, page]);

  const apply = () => {
    setApplied(draft);
    setPage(1);
  };
  const exp = (kind) => () => downloadCsv(kind, qs(applied));
  const ack = (id) => async () => {
    await api("POST", `/api/alerts/${id}/ack`);
    await reload(true);
  };
  const set = (k) => (e) => setDraft((o) => ({ ...o, [k]: e.target.value }));

  return (
    <QueryState loading={loading} error={error} data={data} rows={4}>
      {data && (
        <>
          <Summary d={data.d} />
          <Alerts al={data.al} ack={ack} />
          <AiCost ac={data.ac} />
          <Card role="search" aria-label="Filter activity log">
            <div className="grid2">
              <div>
                <label className="l" htmlFor="af-q">
                  Search
                </label>
                <input id="af-q" type="search" maxLength={80} value={draft.q} onChange={set("q")} onKeyDown={(e) => e.key === "Enter" && apply()} />
              </div>
              <div>
                <label className="l" htmlFor="af-lv">
                  Level
                </label>
                <select id="af-lv" value={draft.level} onChange={set("level")}>
                  <option value="">All</option>
                  {["info", "warning", "error"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="l" htmlFor="af-f">
                  From
                </label>
                <input id="af-f" type="date" value={draft.from} onChange={set("from")} />
              </div>
              <div>
                <label className="l" htmlFor="af-t">
                  To
                </label>
                <input id="af-t" type="date" value={draft.to} onChange={set("to")} />
              </div>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn pri sm" type="button" onClick={apply}>
                Apply
              </button>
              <AsyncButton className="btn sm" onClick={exp("activity")}>
                Export log CSV
              </AsyncButton>
              <AsyncButton className="btn sm" onClick={exp("ai-usage")}>
                Export AI usage CSV
              </AsyncButton>
            </div>
            <div className="hint">Exports need the super admin role.</div>
          </Card>

          <div className="row sp" style={{ margin: "6px 2px 10px" }}>
            <b>Activity log</b>
            <button className="btn sm" aria-label="Refresh" onClick={() => reload()}>
              <Icon name="ref" />
            </button>
          </div>
          {data.lp.rows.length ? (
            data.lp.rows.map((l, i) => (
              <Card key={i} style={{ padding: 12, marginBottom: 8 }}>
                <div className="row sp">
                  <span className={`pill ${LOG_CLASS[l.type] || ""}`}>{l.type}</span>
                  <small className="hint" style={{ margin: 0 }}>
                    {fmt(l.at)}
                  </small>
                </div>
                <div style={{ marginTop: 6 }}>{l.message}</div>
                <small className="hint">
                  {l.by}
                  {l.status ? " · " + l.status : ""}
                  {l.code ? " · " + l.code : ""}
                </small>
              </Card>
            ))
          ) : (
            <Empty icon="clock" text="No matching activity" />
          )}
          <div className="row sp" style={{ margin: "8px 2px" }}>
            <button className="btn sm" disabled={data.lp.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Previous
            </button>
            <span className="hint">
              Page {data.lp.page} of {data.lp.pages} · {data.lp.total} entries
            </span>
            <button className="btn sm" disabled={data.lp.page >= data.lp.pages} onClick={() => setPage((p) => p + 1)}>
              Next
            </button>
          </div>
        </>
      )}
    </QueryState>
  );
}

function Summary({ d }) {
  const u = d.usage;
  const uc = (l, x) => (
    <div className="stat">
      <b>{x.ai}</b>
      <span>{l}</span>
      <span style={{ marginTop: 2 }}>
        {x.tokens.toLocaleString()} tokens · ~${x.estCost}
      </span>
    </div>
  );
  const r = d.research;
  return (
    <>
      <div className="stats">
        <div className="stat">
          <b>
            {d.counts.today}/{d.limits.daily}
          </b>
          <span>
            <Icon name="send" /> Posts today
          </span>
        </div>
        <div className="stat">
          <b>
            {d.counts.week}/{d.limits.weekly}
          </b>
          <span>
            <Icon name="send" /> This week
          </span>
        </div>
        {uc("AI calls today", u.today)}
        {uc("AI calls · 7 days", u.week)}
      </div>
      <div className="hint" style={{ margin: "-6px 2px 14px" }}>
        Last 30 days: {u.month.ai} AI calls, {u.month.image} image searches, ~${u.month.estCost} (estimate at ${u.rate} per 1M tokens - not a bill).
      </div>
      <Card title="Status" icon="news">
        <span className={`pill ${d.paused ? "bad" : "ok"}`}>Emergency stop: {d.paused ? "ON" : "off"}</span>{" "}
        <span className={`pill ${d.facebookEnabled ? "ok" : "warn"}`}>Facebook automation: {d.facebookEnabled ? "on" : "paused"}</span>
      </Card>
      {r && (
        <Card title="Research" icon="ai">
          <div className="stats" style={{ margin: 0 }}>
            {[
              ["Topics discovered", r.discovered],
              ["Sources stored", r.stored],
              ["Sources rejected", r.rejected],
              ["Claims verified", r.claimsVerified],
              ["Claims need review", r.claimsNeedReview],
              ["Duplicates rejected", r.duplicates],
              ["Drafts generated", r.drafts],
              ["Rejected by quality", r.qualityRejected],
              ["Queued for scheduler", r.queued],
              ["Published", r.published],
            ].map(([l, v]) => (
              <div className="stat" key={l}>
                <b>{v}</b>
                <span>{l}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

function Alerts({ al, ack }) {
  const open = (al || []).filter((a) => !a.acknowledged).slice(0, 5);
  if (!open.length) return null;
  return (
    <Card title="Alerts" icon="news" role="alert">
      {open.map((a) => (
        <div className="row sp" style={{ marginBottom: 6 }} key={a.id}>
          <span>
            <span className={`pill ${a.severity === "critical" ? "bad" : a.severity === "warning" ? "warn" : ""}`}>{a.severity}</span> {a.message}{" "}
            <small className="hint">{fmt(a.at)}</small>
          </span>
          <AsyncButton className="btn sm" onClick={ack(a.id)}>
            Dismiss
          </AsyncButton>
        </div>
      ))}
    </Card>
  );
}

function UsageRows({ o }) {
  const rows = Object.entries(o || {});
  if (!rows.length)
    return (
      <tbody>
        <tr>
          <td colSpan={4}>No data in this range</td>
        </tr>
      </tbody>
    );
  return (
    <tbody>
      {rows.map(([k, v]) => (
        <tr key={k}>
          <td>{k}</td>
          <td>
            {v.calls} ({v.failed} failed)
          </td>
          <td>
            {v.inputTokens.toLocaleString()} / {v.outputTokens.toLocaleString()}
          </td>
          <td>
            {money(v.cost)}
            {v.unpricedCalls ? <small> +{v.unpricedCalls} unpriced</small> : null}
          </td>
        </tr>
      ))}
    </tbody>
  );
}

function AiCost({ ac }) {
  if (!ac) return null;
  const th = { textAlign: "left" };
  return (
    <Card title="AI cost (estimates)" icon="ai">
      <div className="stats" style={{ margin: "0 0 8px" }}>
        <div className="stat">
          <b>{money(ac.periods.today)}</b>
          <span>Today</span>
        </div>
        <div className="stat">
          <b>{money(ac.periods.week)}</b>
          <span>7 days</span>
        </div>
        <div className="stat">
          <b>{money(ac.periods.month)}</b>
          <span>30 days</span>
        </div>
        <div className="stat">
          <b>{money(ac.estimatedCost + ac.reportedCost)}</b>
          <span>Selected range</span>
        </div>
      </div>
      <div className="hint">
        Estimated {money(ac.estimatedCost)} · provider-reported {money(ac.reportedCost)} · requests {ac.total.calls || 0} ({ac.total.failed || 0} failed) · tokens in/out{" "}
        {(ac.total.inputTokens || 0).toLocaleString()} / {(ac.total.outputTokens || 0).toLocaleString()}. Avg per draft {money(ac.avgCostPerDraft)}, per published{" "}
        {money(ac.avgCostPerPublished)}, per eligible research item {money(ac.costPerEligibleResearchItem)}, research→published{" "}
        {ac.researchToPublicationRate == null ? "n/a" : (ac.researchToPublicationRate * 100).toFixed(1) + "%"}. Rates: pricing.json v{ac.pricingVersion}. Not an invoice.
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
          <caption className="hint" style={th}>
            By task
          </caption>
          <thead>
            <tr>
              <th style={th}>Task</th>
              <th style={th}>Requests</th>
              <th style={th}>In / Out tokens</th>
              <th style={th}>Cost</th>
            </tr>
          </thead>
          <UsageRows o={ac.byTask} />
        </table>
        <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse", marginTop: 8 }}>
          <caption className="hint" style={th}>
            By provider:model
          </caption>
          <UsageRows o={ac.byModel} />
        </table>
      </div>
    </Card>
  );
}
