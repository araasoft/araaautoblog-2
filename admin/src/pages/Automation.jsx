import { useState } from "react";
import Icon from "../components/Icon";
import Card from "../components/Card";
import Switch from "../components/Switch";
import Empty from "../components/Empty";
import AsyncButton from "../components/AsyncButton";
import QueryState from "../components/QueryState";
import { useAsync } from "../hooks/useAsync";
import { usePosts } from "../hooks/useAuth";
import { api } from "../services/api";
import { toggleEmergencyStop } from "../services/automation";
import { JOB_STATUS, POST_TYPE } from "../utils/constants";
import { fmt, fmtTime } from "../utils/format";
import { notify } from "../utils/notify";
import { confirmAlert } from "../utils/alerts";
import { liRes, report } from "../utils/posts";

export default function Automation() {
  const { data, loading, error, reload } = useAsync(() => api("GET", "/api/status"), []);
  return (
    <QueryState loading={loading} error={error} data={data} rows={4}>
      {data && <AutoView s={data} reload={reload} />}
    </QueryState>
  );
}

function Num({ id, label, value, onChange, min, max }) {
  return (
    <div>
      <label className="l" htmlFor={id}>
        {label}
      </label>
      <input id={id} type="number" min={min} max={max} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function AutoView({ s, reload }) {
  const { invalidate } = usePosts();
  const st = s.settings;
  const jobs = s.plan?.jobs || [];
  const drafts = s.drafts || [];
  const [f, setF] = useState({
    enabled: !!st.enabled,
    mode: st.mode,
    postType: st.postType,
    minPerDay: st.minPerDay,
    maxPerDay: st.maxPerDay,
    startHour: st.startHour,
    endHour: st.endHour,
    dailyLimit: st.dailyLimit,
    weeklyLimit: st.weeklyLimit,
    facebookEnabled: st.facebookEnabled !== false,
  });
  const set = (k) => (v) => setF((o) => ({ ...o, [k]: v }));
  const refresh = () => reload(true);

  const save = async () => {
    await api("PUT", "/api/settings", f);
    await api("POST", "/api/auto/replan");
    notify.success("Saved and re-planned");
    await refresh();
  };
  const replan = async () => {
    await api("POST", "/api/auto/replan");
    notify.success("Re-planned");
    await refresh();
  };
  const cancelPending = async () => {
    if (!(await confirmAlert({ title: "Cancel today's pending posts?", text: "All of today's pending automatic posts will be cancelled.", confirmText: "Cancel posts", danger: true, icon: "warning" }))) return;
    const r = await api("POST", "/api/auto/cancel");
    notify.success(`${r.cancelled} cancelled`);
    await refresh();
  };
  const estop = async () => (await toggleEmergencyStop()) && refresh();
  const runNow = (type) => async () => {
    const r = await api("POST", "/api/auto/run-now", { type });
    if (r.queued) notify.success("Draft created - approve it below");
    else report({ facebook: { ok: true }, ...liRes(r.linkedin) }, "published");
    invalidate();
    await refresh();
  };

  return (
    <>
      <Card>
        <div className="opt" style={{ paddingTop: 0 }}>
          <div>
            <b style={{ fontSize: 17 }}>Automatic posting</b>
            <small>{f.enabled ? "ON - posts at random times" : "OFF"}</small>
          </div>
          <Switch checked={f.enabled} onChange={set("enabled")} label="Automatic posting" />
        </div>
        <label className="l" htmlFor="s-mode">
          When a post is ready
        </label>
        <select id="s-mode" value={f.mode} onChange={(e) => set("mode")(e.target.value)}>
          <option value="auto">Publish automatically</option>
          <option value="approval">Save as draft - I approve first</option>
        </select>
        <label className="l" htmlFor="s-type">
          What to post
        </label>
        <select id="s-type" value={f.postType} onChange={(e) => set("postType")(e.target.value)}>
          {[
            ["mixed", "Mixed"],
            ["text", "Text only"],
            ["image", "Image only"],
            ["both", "Text + image"],
          ].map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
        <div className="grid2">
          <Num id="s-min" label="Posts/day min" value={f.minPerDay} onChange={set("minPerDay")} min={1} max={10} />
          <Num id="s-max" label="Posts/day max" value={f.maxPerDay} onChange={set("maxPerDay")} min={1} max={10} />
          <Num id="s-start" label="Earliest hour" value={f.startHour} onChange={set("startHour")} min={0} max={23} />
          <Num id="s-end" label="Latest hour" value={f.endHour} onChange={set("endHour")} min={1} max={24} />
        </div>
        <AsyncButton className="btn pri full" style={{ marginTop: 14 }} onClick={save}>
          <Icon name="ok" /> Save & re-plan
        </AsyncButton>
      </Card>

      <Card title="Safety & limits" icon="stop">
        <AsyncButton className={`btn ${st.paused ? "pri" : "dang"} full`} onClick={estop}>
          <Icon name="stop" /> {st.paused ? "Resume automation" : "Emergency stop"}
        </AsyncButton>
        <div className="opt" style={{ marginTop: 8 }}>
          <div>
            <b>Post to Facebook</b>
            <small>Switch off to pause Facebook only</small>
          </div>
          <Switch checked={f.facebookEnabled} onChange={set("facebookEnabled")} label="Post to Facebook" />
        </div>
        <div className="grid2">
          <Num id="s-dl" label="Daily limit" value={f.dailyLimit} onChange={set("dailyLimit")} min={1} max={20} />
          <Num id="s-wl" label="Weekly limit" value={f.weeklyLimit} onChange={set("weeklyLimit")} min={1} max={140} />
        </div>
        <div className="hint">Limits apply to automatic posts. Save with the button above.</div>
        <AsyncButton className="btn dang full" style={{ marginTop: 10 }} onClick={cancelPending}>
          <Icon name="x" /> Cancel today's pending posts
        </AsyncButton>
      </Card>

      <Card title="Today's plan" icon="clock">
        {jobs.length ? (
          jobs.map((j, i) => {
            const [l, c] = JOB_STATUS[j.status] || [j.status, ""];
            return (
              <div className="plan" key={i}>
                <span className="tm">{fmtTime(j.at)}</span>
                <div style={{ flex: 1 }}>
                  <b>{POST_TYPE[j.type] || j.type}</b>
                  {j.error && <small style={{ color: "var(--bad)" }}>{j.error}</small>}
                </div>
                <span className={`pill ${c}`}>{l}</span>
              </div>
            );
          })
        ) : (
          <Empty icon="clock" text={st.enabled ? "No posts planned for today" : "Automation is off"} />
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <AsyncButton className="btn sm" onClick={replan}>
            <Icon name="ref" /> Re-plan
          </AsyncButton>
        </div>
      </Card>

      <Card title="Post now with AI" icon="zap">
        <div className="row">
          <AsyncButton className="btn sm" loadingText="…" onClick={runNow("text")}>
            <Icon name="doc" /> Text
          </AsyncButton>
          <AsyncButton className="btn sm" loadingText="…" onClick={runNow("image")}>
            <Icon name="img" /> Image
          </AsyncButton>
          <AsyncButton className="btn sm" loadingText="…" onClick={runNow("both")}>
            Text + image
          </AsyncButton>
        </div>
        <div className="hint">Creates one AI post now (published or saved as draft, following the setting above).</div>
      </Card>

      <Card title={`Drafts waiting (${drafts.length})`} icon="ok">
        {drafts.length ? drafts.map((d) => <Draft key={d.id} d={d} onDone={refresh} />) : <div className="hint">No drafts</div>}
      </Card>
    </>
  );
}

function Draft({ d, onDone }) {
  const { invalidate } = usePosts();
  const [text, setText] = useState(d.text || "");
  const approve = async () => {
    const r = await api("POST", `/api/drafts/${encodeURIComponent(d.id)}/approve`, { text: d.type === "image" ? undefined : text });
    report({ facebook: { ok: true }, ...liRes(r.linkedin) }, "published");
    invalidate();
    await onDone();
  };
  const reject = async () => {
    if (!(await confirmAlert({ title: "Reject this draft?", confirmText: "Reject", danger: true, icon: "warning" }))) return;
    await api("DELETE", `/api/drafts/${encodeURIComponent(d.id)}`);
    notify.info("Draft rejected");
    await onDone();
  };
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="hint" style={{ margin: "0 0 6px" }}>
        {fmt(d.createdAt)}
      </div>
      {d.imageUrl && <img className="img-prev" style={{ margin: "0 0 8px" }} src={d.imageUrl} alt="" />}
      {d.type !== "image" && <textarea value={text} onChange={(e) => setText(e.target.value)} />}
      <div className="grid2" style={{ marginTop: 8 }}>
        <AsyncButton className="btn pri" loadingText="Publishing…" onClick={approve}>
          <Icon name="send" /> Approve
        </AsyncButton>
        <AsyncButton className="btn dang" onClick={reject}>
          <Icon name="x" /> Reject
        </AsyncButton>
      </div>
    </div>
  );
}
