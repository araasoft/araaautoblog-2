import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon";
import Card from "../components/Card";
import Empty from "../components/Empty";
import AsyncButton from "../components/AsyncButton";
import QueryState from "../components/QueryState";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";
import { ago, fmt, safeUrl } from "../utils/format";
import { LS } from "../utils/storage";
import { LS_KEYS } from "../utils/constants";
import { notify } from "../utils/notify";

export default function News() {
  const force = useRef(false);
  const { data, loading, error, reload } = useAsync(() => {
    const q = force.current ? "?refresh=1" : "";
    force.current = false;
    return api("GET", "/api/news" + q);
  }, []);
  const refresh = () => {
    force.current = true;
    return reload();
  };

  return (
    <QueryState loading={loading} error={error} data={data} rows={4}>
      {data && <NewsView d={data} refresh={refresh} reload={reload} />}
    </QueryState>
  );
}

function NewsView({ d, refresh, reload }) {
  const nav = useNavigate();
  const [topics, setTopics] = useState([...d.topics]);
  const [input, setInput] = useState("");

  useEffect(() => setTopics([...d.topics]), [d]);

  // mark new headlines as seen once shown
  useEffect(() => {
    const ids = d.items.filter((n) => n.isNew).map((n) => n.id);
    if (ids.length) api("POST", "/api/news/seen", { ids }).catch(() => {});
  }, [d]);

  const add = () => {
    const v = input.trim();
    if (!v) return;
    if (topics.length >= 8) return notify.error("Up to 8 topics");
    if (!topics.some((t) => t.toLowerCase() === v.toLowerCase())) setTopics([...topics, v]);
    setInput("");
  };
  const saveTopics = async () => {
    await api("PUT", "/api/settings", { newsTopics: topics });
    await refresh();
  };
  const analyze = async () => {
    await api("POST", "/api/news/brief");
    await reload(true);
  };
  const draftFrom = async (topic) => {
    const r = await api("POST", "/api/ai/draft", { topic });
    LS.set(LS_KEYS.draft, r.text);
    nav("/create");
  };
  const b = d.brief;

  return (
    <>
      <Card title="Tracked topics" icon="news">
        <div className="row">
          {topics.length ? (
            topics.map((t, i) => (
              <span key={t} className="pill" style={{ fontSize: 13, padding: "6px 8px 6px 12px" }}>
                {t}
                <button
                  aria-label={`Remove ${t}`}
                  onClick={() => setTopics(topics.filter((_, j) => j !== i))}
                  style={{ background: "none", padding: "0 4px", minHeight: 0, color: "inherit" }}
                >
                  <Icon name="x" />
                </button>
              </span>
            ))
          ) : (
            <span className="hint">No topics yet</span>
          )}
        </div>
        <div className="row" style={{ marginTop: 10, flexWrap: "nowrap" }}>
          <input
            placeholder="Add a topic, e.g. AI in Qatar"
            maxLength={60}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <button className="btn sm" aria-label="Add topic" onClick={add}>
            <Icon name="plus" />
          </button>
        </div>
        <AsyncButton className="btn pri full" style={{ marginTop: 10 }} onClick={saveTopics}>
          <Icon name="ok" /> Save & refresh
        </AsyncButton>
      </Card>

      <Card title="Daily news analysis" icon="ai">
        {b ? (
          <>
            <p style={{ margin: "0 0 10px" }}>{b.summary}</p>
            {[
              ["Trends", "trends"],
              ["Opportunities for us", "opportunities"],
              ["Risks to watch", "risks"],
            ].map(
              ([l, k]) =>
                b[k] &&
                b[k].length > 0 && (
                  <div key={k}>
                    <b>{l}</b>
                    <ul className="bul" style={{ margin: "4px 0 10px", paddingLeft: 20 }}>
                      {b[k].map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  </div>
                ),
            )}
            {b.postIdeas && b.postIdeas.length > 0 && (
              <>
                <b>Post ideas</b>
                {b.postIdeas.map((x, i) => (
                  <div className="opt" key={i}>
                    <div>{x}</div>
                    <AsyncButton className="btn sm" loadingText="Writing…" onClick={() => draftFrom(x)}>
                      <Icon name="ai" /> Write
                    </AsyncButton>
                  </div>
                ))}
              </>
            )}
            <div className="hint">Updated {fmt(b.at)}</div>
          </>
        ) : (
          <div className="hint">No analysis yet - it is prepared automatically once a day, or tap the button.</div>
        )}
        <AsyncButton className="btn full" style={{ marginTop: 10 }} loadingText="Analyzing…" onClick={analyze}>
          <Icon name="ref" /> {b ? "Re-analyze" : "Analyze today's news"}
        </AsyncButton>
      </Card>

      <div className="row sp" style={{ margin: "6px 2px 10px" }}>
        <b>Latest headlines ({d.items.length})</b>
        <AsyncButton className="btn sm" aria-label="Refresh headlines" onClick={refresh}>
          <Icon name="ref" />
        </AsyncButton>
      </div>
      {d.items.length ? (
        d.items.map((n) => (
          <Card key={n.id || n.link} className="nw" style={{ padding: 12 }}>
            <div style={{ fontWeight: 600 }}>{n.title}</div>
            <div className="bm" style={{ margin: "6px 0 8px" }}>
              <span>{n.source}</span>
              <span>· {ago(n.at)}</span>
              <span className="pill">{n.topic}</span>
              {n.isNew && <span className="pill ok">NEW</span>}
            </div>
            <div className="row">
              <a className="btn sm" href={safeUrl(n.link)} target="_blank" rel="noopener noreferrer">
                <Icon name="ext" /> Read
              </a>
              <AsyncButton
                className="btn sm"
                loadingText="Writing…"
                onClick={() =>
                  draftFrom(
                    `our short take for business owners on this news: "${n.title}" (${n.source}). Use only facts in the headline, invent no details, and mention the source by name`,
                  )
                }
              >
                <Icon name="ai" /> Post about it
              </AsyncButton>
            </div>
          </Card>
        ))
      ) : (
        <Empty icon="news" text="No headlines. Add topics above." />
      )}
    </>
  );
}
