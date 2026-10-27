import { useState } from "react";
import Icon from "../components/Icon";
import Card from "../components/Card";
import Switch from "../components/Switch";
import AsyncButton from "../components/AsyncButton";
import QueryState from "../components/QueryState";
import { useAsync } from "../hooks/useAsync";
import { useAuth } from "../hooks/useAuth";
import { api } from "../services/api";
import { ROLE_NAME, TIME_ZONES } from "../utils/constants";
import { initial } from "../utils/format";
import { notify } from "../utils/notify";
import { confirmAlert } from "../utils/alerts";

export default function Settings() {
  const { data, loading, error, reload } = useAsync(() => api("GET", "/api/status"), []);
  return (
    <QueryState loading={loading} error={error} data={data}>
      {data && <SettingsView s={data} reload={reload} />}
    </QueryState>
  );
}

function SettingsView({ s, reload }) {
  const { me, logout } = useAuth();
  const st = s.settings;
  const l = s.linkedin || {};
  const f = s.facebook || {};
  const [lip, setLip] = useState(!!st.linkedinPersonal);
  const [lic, setLic] = useState(!!st.linkedinCompany);
  const [news, setNews] = useState(!!st.newsInAuto);
  const [off, setOff] = useState(String(st.utcOffsetMinutes));
  const zones = TIME_ZONES.some((t) => t[0] === st.utcOffsetMinutes) ? TIME_ZONES : [...TIME_ZONES, [st.utcOffsetMinutes, `UTC offset ${st.utcOffsetMinutes} min`]];

  const save = async () => {
    await api("PUT", "/api/settings", { linkedinPersonal: lip, linkedinCompany: lic, newsInAuto: news, utcOffsetMinutes: off });
    await api("POST", "/api/auto/replan");
    notify.success("Saved");
  };
  const connect = async () => {
    const { url } = await api("POST", "/api/linkedin/connect");
    window.open(url, "_blank", "noopener") || (window.location.href = url);
    notify.success("Approve on LinkedIn, then come back and refresh");
  };
  const disconnect = async () => {
    if (!(await confirmAlert({ title: "Disconnect LinkedIn?", confirmText: "Disconnect", danger: true, icon: "warning" }))) return;
    await api("POST", "/api/linkedin/disconnect");
    await reload(true);
  };
  const signOut = async () => {
    if (await confirmAlert({ title: "Sign out?", confirmText: "Sign out" })) logout();
  };

  return (
    <>
      <Card title="Connections" icon="link">
        <div className="conn">
          <span className="pl fb">
            <Icon name="fb" />
          </span>
          <div>
            <b>Facebook Page</b>
            <small>{f.ok ? f.name : f.error || "Not connected"}</small>
          </div>
          <span className={`pill ${f.ok ? "ok" : "bad"}`}>{f.ok ? "Connected" : "Off"}</span>
        </div>
        <div className="conn">
          <span className="pl li">
            <Icon name="li" />
          </span>
          <div>
            <b>LinkedIn</b>
            <small>
              {l.connected
                ? (l.name || "Connected") + (l.expiresAt ? " · token ends " + new Date(l.expiresAt).toLocaleDateString() : "")
                : l.configured
                  ? "Not connected"
                  : "Set LI_CLIENT_ID, LI_CLIENT_SECRET, LI_REDIRECT_URI on the server"}
            </small>
            {l.error && <small style={{ color: "var(--bad)" }}>{l.error}</small>}
          </div>
          <span className={`pill ${l.connected ? "ok" : "warn"}`}>{l.connected ? "Connected" : "Off"}</span>
        </div>
        {l.configured && (
          <div className="row" style={{ marginTop: 10 }}>
            <AsyncButton className="btn pri sm" onClick={connect}>
              <Icon name="li" /> {l.connected ? "Reconnect" : "Connect"} LinkedIn
            </AsyncButton>
            {l.connected && (
              <AsyncButton className="btn dang sm" onClick={disconnect}>
                Disconnect
              </AsyncButton>
            )}
          </div>
        )}
        <div className="conn" style={{ marginTop: 6 }}>
          <span className="pl" style={{ background: "var(--pri)" }}>
            <Icon name="ai" />
          </span>
          <div>
            <b>AI writing</b>
            <small>{s.ai ? "Key set" : "GROQ key missing"}</small>
          </div>
          <span className={`pill ${s.ai ? "ok" : "bad"}`}>{s.ai ? "Ready" : "Missing"}</span>
        </div>
        <div className="conn">
          <span className="pl" style={{ background: "var(--pri)" }}>
            <Icon name="img" />
          </span>
          <div>
            <b>Image search</b>
            <small>{s.unsplash ? "Key set" : "Unsplash key missing"}</small>
          </div>
          <span className={`pill ${s.unsplash ? "ok" : "warn"}`}>{s.unsplash ? "Ready" : "Missing"}</span>
        </div>
      </Card>

      <Card title="Automation posts to" icon="zap">
        <div className="opt">
          <div>
            <b>LinkedIn profile</b>
            <small>Also post automatic posts there</small>
          </div>
          <Switch checked={lip} onChange={setLip} label="LinkedIn profile" />
        </div>
        <div className="opt">
          <div>
            <b>LinkedIn company page</b>
            <small>Also post automatic posts there</small>
          </div>
          <Switch checked={lic} onChange={setLic} label="LinkedIn company page" />
        </div>
        <div className="opt">
          <div>
            <b>Use news in automatic posts</b>
            <small>About half of text posts react to today's headlines</small>
          </div>
          <Switch checked={news} onChange={setNews} label="Use news" />
        </div>
        <label className="l" htmlFor="s-off">
          Time zone
        </label>
        <select id="s-off" value={off} onChange={(e) => setOff(e.target.value)}>
          {zones.map(([v, t]) => (
            <option key={v} value={String(v)}>
              {t}
            </option>
          ))}
        </select>
        <AsyncButton className="btn pri full" style={{ marginTop: 14 }} onClick={save}>
          <Icon name="ok" /> Save settings
        </AsyncButton>
      </Card>

      <Card title="Account" icon="user">
        <div className="conn">
          <div className="av">{initial(me.name)}</div>
          <div>
            <b>{me.name}</b>
            <small>
              {me.email || ""} · {ROLE_NAME[me.role] || me.role}
            </small>
          </div>
        </div>
        <button className="btn dang full" onClick={signOut}>
          <Icon name="out" /> Sign out
        </button>
      </Card>
    </>
  );
}
