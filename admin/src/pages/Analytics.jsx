import Icon from "../components/Icon";
import Card from "../components/Card";
import AsyncButton from "../components/AsyncButton";
import QueryState from "../components/QueryState";
import { Bars, Chips } from "../components/Insights";
import { useAsync } from "../hooks/useAsync";
import { useAuth } from "../hooks/useAuth";
import { api } from "../services/api";
import { DAYS } from "../utils/constants";
import { ago, fmt, hh, num } from "../utils/format";
import { notify } from "../utils/notify";

function Totals({ k, name, t }) {
  const cell = (v, l) => (
    <div>
      <b>{v}</b>
      <span>{l}</span>
    </div>
  );
  return (
    <Card title={name} icon={k}>
      <div className="es">
        {cell(num(t.views), "Views")}
        {cell(num(t.reach), "Reach")}
        {cell(num(t.likes), "Likes")}
      </div>
      <div className="es" style={{ marginTop: 8 }}>
        {cell(num(t.comments), "Comments")}
        {cell(num(t.shares), "Shares")}
        {cell(t.posts, "Posts")}
      </div>
    </Card>
  );
}

export default function Analytics() {
  const { can } = useAuth();
  const { data, loading, error, reload } = useAsync(() => api("GET", "/api/analytics"), []);

  const refresh = async () => {
    const r = await api("POST", "/api/analytics/refresh");
    notify.success(`Updated ${r.updated} post(s)`);
    await reload(true);
  };

  return (
    <QueryState loading={loading} error={error} data={data}>
      {data && (() => {
        const i = data.insights || {};
        const st = data.status || {};
        const t = data.totals;
        const notes = [
          st.fbError && "Facebook: " + st.fbError + " (the Page token needs pages_read_engagement)",
          st.liError && "LinkedIn: " + st.liError + " (company page posts only; add r_organization_social to LI_SCOPES and reconnect)",
        ].filter(Boolean);
        const top = (data.top || []).filter((p) => p.score > 0);
        return (
          <>
            <Card>
              <div className="row sp">
                <div>
                  <b>{i.ready ? "Posting times follow your best hours" : "Collecting data"}</b>
                  <div className="hint">
                    {i.ready ? "The planner now posts at the hours below." : `${i.measured || 0} of 8 measured posts needed before posting times change.`}{" "}
                    {st.lastRun ? "Updated " + ago(st.lastRun) + " ago." : ""}
                  </div>
                </div>
                {can("analytics.refresh") && (
                  <AsyncButton className="pri sm" onClick={refresh} loadingText="Refreshing...">
                    <Icon name="ref" /> Refresh
                  </AsyncButton>
                )}
              </div>
            </Card>
            {notes.length > 0 && (
              <Card style={{ background: "#fff3dc", color: "#7a5200" }}>
                {notes.map((n) => (
                  <div key={n} className="hint" style={{ color: "inherit" }}>
                    {n}
                  </div>
                ))}
              </Card>
            )}
            <Totals k="fb" name="Facebook" t={t.fb} />
            <Totals k="li" name="LinkedIn company page" t={t.li} />
            <Card title="Best hours to post" icon="clock">
              <Bars rows={i.bestHours || []} label={(r) => hh(r.hour)} val={(r) => r.avg} />
            </Card>
            <Card title="Best days" icon="clock">
              <Bars rows={i.bestDays || []} label={(r) => DAYS[r.day]} val={(r) => r.avg} />
            </Card>
            <Card title="Hashtags that perform" icon="star">
              <Chips rows={i.topHashtags || []} k="tag" />
              <h2 style={{ marginTop: 16 }}>
                <Icon name="doc" /> Keywords that perform
              </h2>
              <Chips rows={i.topKeywords || []} k="word" />
              <div className="hint">Score = views + 20 x likes + 40 x comments + 60 x shares. The AI reuses these in new posts.</div>
            </Card>
            <Card title="Top posts" icon="like">
              {top.length ? (
                top.map((p, n) => (
                  <div key={n} className="plan">
                    <div className="tm">{num(p.score)}</div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{(p.text || "").split("\n")[0]}</div>
                      <small>
                        {fmt(p.at)} · {hh(p.hour)} · {num(p.fb && p.fb.views)} views · {num(p.fb && p.fb.likes)} likes
                      </small>
                    </div>
                  </div>
                ))
              ) : (
                <div className="hint">No measured posts yet</div>
              )}
            </Card>
          </>
        );
      })()}
    </QueryState>
  );
}
