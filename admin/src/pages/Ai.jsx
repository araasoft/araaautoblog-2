import { useState } from "react";
import { Link } from "react-router-dom";
import Icon from "../components/Icon";
import Card from "../components/Card";
import Switch from "../components/Switch";
import AsyncButton from "../components/AsyncButton";
import QueryState from "../components/QueryState";
import { Chips } from "../components/Insights";
import { useAsync } from "../hooks/useAsync";
import { useAuth } from "../hooks/useAuth";
import { api } from "../services/api";
import { ago, fmt, hh, num } from "../utils/format";
import { notify } from "../utils/notify";

const STATUS = { ok: "ok", warn: "warn", error: "bad" };

export default function Ai() {
  const { data, loading, error, reload } = useAsync(async () => {
    const [o, s] = await Promise.all([api("GET", "/api/ai/overview"), api("GET", "/api/status")]);
    return { o, st: s.settings };
  }, []);
  return (
    <QueryState loading={loading} error={error} data={data} rows={4}>
      {data && <View o={data.o} st={data.st} reload={reload} />}
    </QueryState>
  );
}

function View({ o, st, reload }) {
  const { can } = useAuth();
  const ro = !can("settings.edit");
  const canRun = can("marketing.run") || can("marketing.run.seo");
  const i = o.insights || {};
  const S = o.strategy;
  const cap = o.tokens.cap;
  const pct = cap ? Math.min(100, (o.tokens.today / cap) * 100) : 0;

  const [auto, setAuto] = useState(!!st.aiAutopilot);
  const [f, setF] = useState({
    breakingEnabled: !!st.breakingEnabled,
    breakingMode: st.breakingMode,
    breakingDailyLimit: st.breakingDailyLimit,
    breakingMinSources: st.breakingMinSources,
    breakingMinGapMin: st.breakingMinGapMin,
    breakingScanMin: st.breakingScanMin,
    breakingQueries: (st.breakingQueries || []).join("\n"),
    useBestTimes: !!st.useBestTimes,
    aiDailyTokenCap: cap,
    analyticsIntervalMin: st.analyticsIntervalMin,
  });
  const [scan, setScan] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target ? e.target.value : e }));

  const toggleAuto = async (v) => {
    setAuto(v);
    try {
      await api("PUT", "/api/settings", { aiAutopilot: v });
      notify.success(v ? "Autopilot ON" : "Autopilot OFF");
    } catch (e) {
      setAuto(!v);
      notify.error(e.message);
    }
  };
  const cycle = async () => {
    notify.info("Running cycle...");
    const r = await api("POST", "/api/ai/cycle", {});
    if (r.busy) notify.info("Already running");
    else if (r.error) notify.error("Cycle failed: " + r.error);
    else notify.success("Done: " + ((r.steps || []).join(", ") || "nothing to do"));
    await reload(true);
  };
  const strategy = async () => {
    const r = await api("POST", "/api/ai/cycle", { strategy: true });
    r.strategyError ? notify.error("Strategy not written: " + r.strategyError) : notify.success("New strategy written");
    await reload(true);
  };
  const reset = async () => {
    await api("POST", "/api/ai/health/reset");
    notify.success("All providers will be tried again");
    await reload(true);
  };
  const save = async () => {
    await api("PUT", "/api/settings", {
      aiAutopilot: auto,
      breakingEnabled: f.breakingEnabled,
      breakingMode: f.breakingMode,
      breakingDailyLimit: +f.breakingDailyLimit,
      breakingMinSources: +f.breakingMinSources,
      breakingMinGapMin: +f.breakingMinGapMin,
      breakingScanMin: +f.breakingScanMin,
      breakingQueries: f.breakingQueries.split("\n").map((x) => x.trim()).filter(Boolean),
      useBestTimes: f.useBestTimes,
      aiDailyTokenCap: +f.aiDailyTokenCap,
      analyticsIntervalMin: +f.analyticsIntervalMin,
    });
    notify.success("Saved");
    await reload(true);
  };
  const testScan = async () => setScan(await api("POST", "/api/breaking/scan", { dryRun: true }));

  const num_ = (id, label, k, min, max) => (
    <div>
      <label className="l" htmlFor={id}>{label}</label>
      <input id={id} type="number" min={min} max={max} value={f[k]} onChange={set(k)} disabled={ro} />
    </div>
  );

  return (
    <>
      <div className="hero">
        <h2>
          <Icon name="ai" /> AraaBot
        </h2>
        <p>{o.purpose}</p>
        <div className="row">
          <span className={`pill ${o.state.status === "error" ? "bad" : o.state.status === "running" ? "warn" : "ok"}`}>{o.state.status || "idle"}</span>
          <span className="pill">{o.state.lastCycleAt ? "Last cycle " + ago(o.state.lastCycleAt) + " ago" : "No cycle yet"}</span>
        </div>
        {canRun && (
          <div className="row">
            <AsyncButton className="pri" onClick={cycle} loadingText="Running...">
              <Icon name="zap" /> Run cycle now
            </AsyncButton>
            <AsyncButton onClick={strategy} loadingText="Writing...">
              <Icon name="ai" /> New strategy
            </AsyncButton>
          </div>
        )}
      </div>

      <Card>
        <div className="opt" style={{ paddingTop: 0 }}>
          <div>
            <b style={{ fontSize: 17 }}>Autopilot</b>
            <small>Every 6 hours: analytics, learn, strategy, re-plan posts. Uses at most one small AI call.</small>
          </div>
          <Switch checked={auto} onChange={ro ? () => {} : toggleAuto} label="Autopilot" />
        </div>
        {o.state.lastError && <div className="hint" style={{ color: "var(--bad)" }}>Last error: {o.state.lastError}</div>}
      </Card>

      <Card title="Current strategy" icon="star">
        {S ? (
          <>
            <p style={{ margin: "0 0 8px" }}>{S.summary}</p>
            <div className="hint">Topics</div>
            <div className="row">{(S.topics || []).map((t) => <span key={t} className="pill">{t}</span>)}</div>
            {S.avoid && <div className="hint">Avoid: {S.avoid}</div>}
            {S.nextCheck && <div className="hint">Next I will check: {S.nextCheck}</div>}
            <div className="hint">Written {ago(S.at)} ago</div>
          </>
        ) : (
          <div className="hint">No strategy yet. Press "New strategy" or switch Autopilot on.</div>
        )}
      </Card>

      <Card title="What it learned" icon="chart">
        <div className="hint">Best hours</div>
        <Chips rows={(i.bestHours || []).map((h) => ({ ...h, label: hh(h.hour) }))} k="label" />
        <div className="hint" style={{ marginTop: 10 }}>Hashtags</div>
        <Chips rows={(i.topHashtags || []).slice(0, 8)} k="tag" />
        <div className="hint" style={{ marginTop: 10 }}>Keywords</div>
        <Chips rows={(i.topKeywords || []).slice(0, 10)} k="word" />
        <Link to="/analytics" style={{ display: "block", marginTop: 10 }}>Full analytics</Link>
      </Card>

      <Card title="Breaking, urgent and update news" icon="zap">
        <div className="opt">
          <div>
            <b>Post news immediately</b>
            <small>Scans fresh headlines; posts only when {st.breakingMinSources} outlets agree. Harm-related stories go to you, never auto-posted.</small>
          </div>
          <Switch checked={f.breakingEnabled} onChange={ro ? () => {} : set("breakingEnabled")} label="Post news immediately" />
        </div>
        <label className="l" htmlFor="m-bmode">When ready</label>
        <select id="m-bmode" value={f.breakingMode} onChange={set("breakingMode")} disabled={ro}>
          <option value="auto">Publish immediately</option>
          <option value="approval">Save as draft - I approve</option>
        </select>
        <div className="grid2">
          {num_("m-bdl", "Max per day", "breakingDailyLimit", 1, 10)}
          {num_("m-bms", "Outlets needed", "breakingMinSources", 1, 5)}
          {num_("m-bgap", "Min gap (min)", "breakingMinGapMin", 5, 720)}
          {num_("m-bscan", "Scan every (min)", "breakingScanMin", 5, 120)}
        </div>
        <label className="l" htmlFor="m-bq">News searches (one per line)</label>
        <textarea id="m-bq" style={{ minHeight: 90 }} value={f.breakingQueries} onChange={set("breakingQueries")} disabled={ro} />
        {can("automation.control") && (
          <>
            <AsyncButton className="sm" style={{ marginTop: 10 }} onClick={testScan} loadingText="Scanning...">
              <Icon name="news" /> Test scan (posts nothing)
            </AsyncButton>
            {scan && (
              <div>
                <div className="hint">{scan.found} confirmed stor{scan.found === 1 ? "y" : "ies"} found right now</div>
                {(scan.top || []).map((t, n) => (
                  <div key={n} className="plan">
                    <div className="tm"><span className={`pill ${t.tragedy ? "warn" : "ok"}`}>{t.kind}</span></div>
                    <div style={{ minWidth: 0 }}>
                      {t.title}
                      <small>{t.sources.join(", ")}{t.tragedy ? " · needs human review" : ""}</small>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Card>

      <Card title="Limits and timing" icon="shield">
        <div className="opt">
          <div>
            <b>Post at best hours</b>
            <small>Needs 8 measured posts</small>
          </div>
          <Switch checked={f.useBestTimes} onChange={ro ? () => {} : set("useBestTimes")} label="Post at best hours" />
        </div>
        <label className="l" htmlFor="m-cap">
          Daily AI token cap (0 = off) - today {num(o.tokens.today)}{cap ? " of " + num(cap) : ""}
        </label>
        <input id="m-cap" type="number" min="0" value={f.aiDailyTokenCap} onChange={set("aiDailyTokenCap")} disabled={ro} />
        {cap > 0 && (
          <div style={{ background: "var(--pale)", borderRadius: 99, height: 8, marginTop: 8, overflow: "hidden" }}>
            <div style={{ width: pct + "%", height: "100%", background: pct > 85 ? "var(--bad)" : "var(--pri2)" }} />
          </div>
        )}
        <label className="l" htmlFor="m-aint">Analytics refresh (minutes)</label>
        <input id="m-aint" type="number" min="15" max="1440" value={f.analyticsIntervalMin} onChange={set("analyticsIntervalMin")} disabled={ro} />
        {!ro && (
          <AsyncButton className="pri full" style={{ marginTop: 12 }} onClick={save} loadingText="Saving...">
            <Icon name="ok" /> Save
          </AsyncButton>
        )}
      </Card>

      <Card title="AI providers (switches by itself)" icon="link">
        {o.providers.length ? (
          <>
            {o.providers.map((p) => (
              <div key={p.id} style={{ marginBottom: 10 }}>
                <b>{p.id}</b> <span className={`pill ${p.state === "ready" ? "ok" : "bad"}`}>{p.state}</span>
                {p.models.map((m) => (
                  <div key={m.model} className="hint" style={{ margin: "2px 0" }}>
                    {m.ok ? "✔" : "⏸"} {m.model}{m.ok ? "" : ` - ${m.why}, retry in ${m.retryInMin} min`}
                  </div>
                ))}
              </div>
            ))}
            {can("settings.edit") && (
              <AsyncButton className="sm" onClick={reset}>
                <Icon name="ref" /> Retry all now
              </AsyncButton>
            )}
          </>
        ) : (
          <div className="hint">No AI key is set on the server.</div>
        )}
        <div className="hint">If a key, model or provider fails, the next one is used automatically and a model that no longer exists is replaced by its newest version.</div>
      </Card>

      <Card title="What the AI did (workflow history)" icon="doc">
        {o.history.length ? (
          o.history.map((h, n) => (
            <div key={n} className="plan">
              <div className="tm" style={{ minWidth: 64 }}><span className={`pill ${STATUS[h.status] || ""}`}>{h.step}</span></div>
              <div style={{ minWidth: 0 }}>
                <div>{h.detail}</div>
                <small>{fmt(h.at)}</small>
              </div>
            </div>
          ))
        ) : (
          <div className="hint">Nothing yet</div>
        )}
      </Card>
    </>
  );
}
