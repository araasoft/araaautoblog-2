import { Link } from "react-router-dom";
import Icon from "../components/Icon";
import AsyncButton from "../components/AsyncButton";
import PostCard from "../components/PostCard";
import QueryState from "../components/QueryState";
import Empty from "../components/Empty";
import { useAsync } from "../hooks/useAsync";
import { useAuth, usePosts } from "../hooks/useAuth";
import { api } from "../services/api";
import { toggleEmergencyStop } from "../services/automation";
import { fmt } from "../utils/format";

export default function Home() {
  const { me } = useAuth();
  const { load } = usePosts();
  const { data, loading, error, reload } = useAsync(async () => {
    const [s, list] = await Promise.all([api("GET", "/api/status"), load().catch(() => [])]);
    return { s, list };
  }, []);

  return (
    <QueryState loading={loading} error={error} data={data}>
      {data && <HomeView s={data.s} list={data.list} me={me} onStop={async () => (await toggleEmergencyStop()) && reload(true)} />}
    </QueryState>
  );
}

function HomeView({ s, list, me, onStop }) {
  const st = s.settings;
  const fbn = list.filter((p) => p.fb).length;
  const lin = list.filter((p) => p.li).length;
  const nextJob = (s.plan?.jobs || []).find((j) => j.status === "pending");
  const first = (me.name || "").split(" ")[0];

  return (
    <>
      {st.paused && (
        <div className="card" style={{ background: "#fdecea", color: "var(--bad)" }}>
          <h2 style={{ color: "var(--bad)" }}>
            <Icon name="stop" /> Emergency stop is ON
          </h2>
          <div className="hint" style={{ color: "inherit" }}>
            Nothing is posted automatically.
          </div>
          <AsyncButton className="btn pri full" style={{ marginTop: 10 }} onClick={onStop}>
            Resume automation
          </AsyncButton>
        </div>
      )}
      <div className="hero">
        <h2>Hi, {first} 👋</h2>
        <p>{st.paused ? "Automation is STOPPED" : st.enabled ? "Automation is ON" : "Automation is OFF"}</p>
        <p style={{ fontSize: 13 }}>
          Next post: {nextJob && st.enabled && !st.paused ? fmt(nextJob.at) : "-"} · Last successful run:{" "}
          {s.plan?.lastOk ? fmt(s.plan.lastOk) : "-"}
        </p>
        <div className="row">
          <Link className="btn pri" to="/create">
            <Icon name="plus" /> New post
          </Link>
          <Link className="btn" to="/auto">
            <Icon name="zap" /> Automation
          </Link>
        </div>
      </div>
      <div className="stats">
        <div className="stat">
          <b>{list.length}</b>
          <span>
            <Icon name="doc" /> Posts
          </span>
        </div>
        <div className="stat">
          <b>{fbn}</b>
          <span className="fbc">
            <Icon name="fb" /> Facebook
          </span>
        </div>
        <div className="stat">
          <b>{lin}</b>
          <span className="lic">
            <Icon name="li" /> LinkedIn
          </span>
        </div>
        <div className="stat">
          <b>{(s.drafts || []).length}</b>
          <span>
            <Icon name="clock" /> Drafts
          </span>
        </div>
      </div>
      <div className="card">
        <h2>
          <Icon name="link" /> Connections
        </h2>
        <div className="row">
          <span className={`pill ${s.facebook && s.facebook.ok ? "ok" : "bad"}`}>
            <Icon name="fb" /> {s.facebook && s.facebook.ok ? s.facebook.name : "Not connected"}
          </span>
          <span className={`pill ${s.linkedin && s.linkedin.connected ? "ok" : "warn"}`}>
            <Icon name="li" /> {s.linkedin && s.linkedin.connected ? s.linkedin.name || "Connected" : "Not connected"}
          </span>
          <span className={`pill ${s.ai ? "ok" : "bad"}`}>
            <Icon name="ai" /> AI
          </span>
          <span className={`pill ${s.unsplash ? "ok" : "warn"}`}>
            <Icon name="img" /> Images
          </span>
        </div>
      </div>
      <div className="row sp" style={{ margin: "6px 2px 10px" }}>
        <b>Recent posts</b>
        <Link to="/posts">See all</Link>
      </div>
      {list.length ? list.slice(0, 4).map((p, i) => <PostCard key={p.key} post={p} index={i} />) : <Empty icon="doc" text="No posts yet" />}
    </>
  );
}
