import { useState } from "react";
import Icon from "../components/Icon";
import Card from "../components/Card";
import Switch from "../components/Switch";
import AsyncButton from "../components/AsyncButton";
import QueryState from "../components/QueryState";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";
import { notify } from "../utils/notify";
import { confirmAlert } from "../utils/alerts";

export default function Mail() {
  const { data, loading, error, reload } = useAsync(async () => {
    const [m, sub, s] = await Promise.all([api("GET", "/api/mail/status"), api("GET", "/api/mail/subscribers"), api("GET", "/api/status")]);
    return { m, items: sub.items, st: s.settings };
  }, []);
  return (
    <QueryState loading={loading} error={error} data={data} rows={4}>
      {data && <View {...data} reload={reload} />}
    </QueryState>
  );
}

function View({ m, items, st, reload }) {
  const [to, setTo] = useState((st.notifyEmails || []).join("\n"));
  const [eng, setEng] = useState(!!st.notifyOnEngagement);
  const [sub, setSub] = useState(!!st.mailSubscribers);
  const [cap, setCap] = useState(st.emailMonthlyCap);
  const [add, setAdd] = useState("");

  const test = async () => {
    await api("POST", "/api/mail/test");
    notify.success("Test email sent");
  };
  const save = async () => {
    await api("PUT", "/api/settings", {
      notifyEmails: to.split(/[\s,;]+/).filter(Boolean),
      notifyOnEngagement: eng,
      mailSubscribers: sub,
      emailMonthlyCap: +cap,
    });
    notify.success("Saved");
  };
  const addSubs = async () => {
    const r = await api("POST", "/api/mail/subscribers", { emails: add });
    notify.success(`${r.added} added${r.invalid ? ", " + r.invalid + " invalid" : ""}`);
    setAdd("");
    await reload(true);
  };
  const del = async (key) => {
    if (!(await confirmAlert({ title: "Remove this subscriber?", confirmText: "Remove", danger: true, icon: "warning" }))) return;
    await api("DELETE", "/api/mail/subscribers/" + encodeURIComponent(key));
    await reload(true);
  };

  return (
    <>
      <Card title="EmailJS" icon="send">
        <div className="row">
          <span className={`pill ${m.configured ? "ok" : "bad"}`}>{m.configured ? "Connected" : "Not set up"}</span>
          <span className="pill">{m.month} of {m.cap || "no cap"} sent this month</span>
          <span className="pill">{m.subscribers} subscribers</span>
        </div>
        {!m.configured && (
          <div className="hint">
            Set EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PUBLIC_KEY and EMAILJS_PRIVATE_KEY on the server. In EmailJS turn on Account &gt; Security &gt; "Allow EmailJS API for non-browser applications". Template fields: to_email, subject, title, message, post_url.
          </div>
        )}
        <AsyncButton className="pri full" style={{ marginTop: 12 }} disabled={!m.configured} onClick={test} loadingText="Sending...">
          <Icon name="send" /> Send test email
        </AsyncButton>
      </Card>

      <Card title="Who gets alerts" icon="bell">
        <label className="l" htmlFor="ml-to">Alert emails (post created, edited, deleted, likes, comments, shares)</label>
        <textarea id="ml-to" style={{ minHeight: 70 }} value={to} onChange={(e) => setTo(e.target.value)} />
        <div className="opt">
          <div>
            <b>Likes, comments and shares</b>
            <small>Grouped into one email every 15 minutes</small>
          </div>
          <Switch checked={eng} onChange={setEng} label="Likes, comments and shares" />
        </div>
        <div className="opt">
          <div>
            <b>Email subscribers on new posts</b>
            <small>Sent one by one in the background</small>
          </div>
          <Switch checked={sub} onChange={setSub} label="Email subscribers on new posts" />
        </div>
        <label className="l" htmlFor="ml-cap">Monthly email cap (EmailJS free plan = 200)</label>
        <input id="ml-cap" type="number" min="0" value={cap} onChange={(e) => setCap(e.target.value)} />
        <AsyncButton className="pri full" style={{ marginTop: 12 }} onClick={save} loadingText="Saving...">
          <Icon name="ok" /> Save
        </AsyncButton>
      </Card>

      <Card title={`Subscribers (${items.filter((x) => x.active).length})`} icon="users">
        <label className="l" htmlFor="ml-add">Add emails (comma, space or new line)</label>
        <textarea id="ml-add" style={{ minHeight: 60 }} value={add} onChange={(e) => setAdd(e.target.value)} />
        <AsyncButton className="sm" style={{ marginTop: 8 }} onClick={addSubs} disabled={!add.trim()}>
          <Icon name="plus" /> Add
        </AsyncButton>
        <div style={{ marginTop: 12 }}>
          {items.length ? (
            items.slice(0, 100).map((x) => (
              <div key={x.key} className="row sp" style={{ padding: "6px 0", borderBottom: "1px solid var(--line)" }}>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {x.email} {!x.active && <span className="pill warn">unsubscribed</span>}
                </span>
                <AsyncButton className="sm dang" onClick={() => del(x.key)} aria-label="Remove subscriber">
                  <Icon name="del" />
                </AsyncButton>
              </div>
            ))
          ) : (
            <div className="hint">No subscribers yet</div>
          )}
        </div>
        <div className="hint">
          Website sign-up: send <code>POST {location.origin}/subscribe</code> with JSON <code>{'{"email":"..."}'}</code>. Every email has an unsubscribe link (set PUBLIC_URL on the server).
        </div>
      </Card>
    </>
  );
}
