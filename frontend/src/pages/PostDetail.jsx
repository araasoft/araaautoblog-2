import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Icon from "../components/Icon";
import Card from "../components/Card";
import Empty from "../components/Empty";
import Skeleton from "../components/Skeleton";
import AsyncButton from "../components/AsyncButton";
import PlatformBadges from "../components/PlatformBadges";
import TargetPicker from "../components/TargetPicker";
import QueryState from "../components/QueryState";
import { useAsync } from "../hooks/useAsync";
import { usePosts } from "../hooks/useAuth";
import { api } from "../services/api";
import { ago, fmt, initial, safeUrl } from "../utils/format";
import { notify } from "../utils/notify";
import { confirmDanger } from "../utils/alerts";
import { report } from "../utils/posts";

export default function PostDetail() {
  const { key } = useParams();
  const { load } = usePosts();
  const { data, loading, error, reload } = useAsync(() => load(), [key]);
  const p = data && data.find((x) => x.key === key);

  return (
    <>
      <Link className="back" to="/posts">
        <Icon name="back" /> Posts
      </Link>
      <QueryState loading={loading} error={error} data={data}>
        {p ? <PostView p={p} reload={reload} /> : <Empty icon="doc" text="Post not found (it may have been deleted)" />}
      </QueryState>
    </>
  );
}

function PostView({ p, reload }) {
  const nav = useNavigate();
  const { invalidate } = usePosts();
  const [mode, setMode] = useState("view");
  const [text, setText] = useState(p.text);
  const keys = p.rec ? Object.keys(p.rec.targets || {}) : ["facebook"];
  const [sel, setSel] = useState(keys);

  const open = (m) => {
    setText(p.text);
    setSel(keys);
    setMode(m);
  };

  const save = async () => {
    if (!text.trim()) throw new Error("Text cannot be empty");
    if (p.rec) {
      if (!sel.length) throw new Error("Choose where to save");
      const r = await api("PUT", `/api/records/${encodeURIComponent(p.id)}`, { message: text, targets: sel });
      report(r.results, "edited");
    } else {
      await api("PUT", `/api/posts/${encodeURIComponent(p.id)}`, { message: text });
      report({ facebook: { ok: true } }, "edited");
    }
    invalidate();
    setMode("view");
    await reload(true);
  };

  const remove = async () => {
    if (p.rec && !sel.length) throw new Error("Choose where to delete");
    const ok = await confirmDanger({ title: "Delete this post?", text: "This cannot be undone." });
    if (!ok) return;
    if (p.rec) {
      const r = await api("DELETE", `/api/records/${encodeURIComponent(p.id)}?targets=${encodeURIComponent(sel.join(","))}`);
      report(r.results, "deleted");
      invalidate();
      if (r.removed) nav("/posts");
      else {
        setMode("view");
        await reload(true);
      }
    } else {
      await api("DELETE", `/api/posts/${encodeURIComponent(p.id)}`);
      report({ facebook: { ok: true } }, "deleted");
      invalidate();
      nav("/posts");
    }
  };

  return (
    <>
      <Card className="blog">
        {p.img && <img className="hero-i" src={p.img} alt="" />}
        <div className="bm">
          <PlatformBadges fb={p.fb} li={p.li} />
          <span>{fmt(p.at)}</span>
          {p.author && <span>· {p.author}</span>}
          {p.sched && (
            <span className="pill warn">
              <Icon name="clock" /> Scheduled {fmt(p.schedAt)}
            </span>
          )}
          {p.edited && <span>· edited</span>}
        </div>
        <div className="bt">{p.text || <i>(image only)</i>}</div>
        <Links p={p} />
      </Card>

      <Engagement p={p} />

      <Card>
        {mode === "view" && (
          <div className="row">
            <button className="btn" style={{ flex: 1 }} onClick={() => open("edit")}>
              <Icon name="edit" /> Edit
            </button>
            <button className="btn dang" style={{ flex: 1 }} onClick={() => open("del")}>
              <Icon name="del" /> Delete
            </button>
          </div>
        )}
        {mode === "edit" && (
          <>
            <h2>
              <Icon name="edit" /> Edit text
            </h2>
            <textarea value={text} onChange={(e) => setText(e.target.value)} />
            {p.rec && keys.length > 1 && (
              <>
                <label className="l">Save on</label>
                <TargetPicker targets={keys} value={sel} onChange={setSel} />
              </>
            )}
            {p.li && <div className="hint">LinkedIn only changes the text; the image stays.</div>}
            <div className="row" style={{ marginTop: 12 }}>
              <AsyncButton className="btn pri" style={{ flex: 1 }} onClick={save}>
                <Icon name="ok" /> Save
              </AsyncButton>
              <button className="btn" onClick={() => setMode("view")}>
                Cancel
              </button>
            </div>
          </>
        )}
        {mode === "del" && (
          <>
            <h2>
              <Icon name="del" /> Delete post
            </h2>
            {p.rec && keys.length > 1 && (
              <>
                <label className="l">Delete from</label>
                <TargetPicker targets={keys} value={sel} onChange={setSel} />
              </>
            )}
            <div className="hint">This cannot be undone.</div>
            <div className="row" style={{ marginTop: 12 }}>
              <AsyncButton className="btn dang" style={{ flex: 1 }} onClick={remove}>
                <Icon name="del" /> Delete
              </AsyncButton>
              <button className="btn" onClick={() => setMode("view")}>
                Cancel
              </button>
            </div>
          </>
        )}
      </Card>
    </>
  );
}

function Links({ p }) {
  const items = [];
  if (p.fbUrl)
    items.push(
      <a key="fb" className="btn fb" href={safeUrl(p.fbUrl)} target="_blank" rel="noopener noreferrer">
        <Icon name="fb" /> View on Facebook <Icon name="ext" />
      </a>,
    );
  p.lis.forEach(([l, u]) =>
    items.push(
      <a key={u} className="btn li" href={safeUrl(u)} target="_blank" rel="noopener noreferrer">
        <Icon name="li" /> View on {l === "LinkedIn page" ? "LinkedIn page" : "LinkedIn"} <Icon name="ext" />
      </a>,
    ),
  );
  if (p.li && !p.lis.length)
    items.push(
      <a key="lf" className="btn li" href="https://www.linkedin.com/feed/" target="_blank" rel="noopener noreferrer">
        <Icon name="li" /> Open LinkedIn <Icon name="ext" />
      </a>,
    );
  return items.length ? <div className="btns">{items}</div> : null;
}

function Engagement({ p }) {
  const canFb = p.fbId && !p.sched;
  const { data, loading, error, reload } = useAsync(
    () => (canFb ? api("GET", `/api/engagement/${encodeURIComponent(p.fbId)}`) : Promise.resolve(null)),
    [p.fbId, p.sched],
  );

  return (
    <Card title="Engagement" icon="cmt">
      {canFb && loading && !data && <Skeleton n={1} />}
      {canFb && error && (
        <div className="hint">
          Facebook comments are not available: {error.message}
          <br />
          The Page token needs the <b>pages_read_engagement</b> permission (and <b>pages_manage_engagement</b> to reply).
        </div>
      )}
      {canFb && data && (
        <>
          <div className="es">
            <div>
              <b>{data.likes}</b>
              <span className="fbc">
                <Icon name="like" /> Likes
              </span>
            </div>
            <div>
              <b>{data.commentsTotal}</b>
              <span>
                <Icon name="cmt" /> Comments
              </span>
            </div>
            <div>
              <b>{data.shares}</b>
              <span>
                <Icon name="share" /> Shares
              </span>
            </div>
          </div>
          {data.comments.length ? (
            data.comments.map((c) => <Comment key={c.id} c={c} onChange={() => reload(true)} />)
          ) : (
            <div className="hint" style={{ textAlign: "center", marginTop: 12 }}>
              No comments yet
            </div>
          )}
        </>
      )}
      {p.li && (
        <div className="hint" style={{ marginTop: 12 }}>
          <Icon name="li" /> LinkedIn does not share likes or comments with this app. Use <b>View on LinkedIn</b> to see and reply there.
        </div>
      )}
      {!p.fb && !p.li && <Empty icon="cmt" text="Nothing to show" />}
    </Card>
  );
}

function Comment({ c, sub, onChange }) {
  const f = c.from || {};
  const pic = f.picture && f.picture.data && f.picture.data.url;
  const [replying, setReplying] = useState(false);
  const [msg, setMsg] = useState("");
  const enc = encodeURIComponent(c.id);

  const like = async () => {
    await api("POST", `/api/comments/${enc}/like`);
    notify.success("Liked");
    onChange();
  };
  const send = async () => {
    if (!msg.trim()) return;
    await api("POST", `/api/comments/${enc}/reply`, { message: msg });
    notify.success("Reply sent");
    setMsg("");
    setReplying(false);
    onChange();
  };

  return (
    <div className={`cm ${sub ? "sub" : ""}`}>
      <div className="av">{pic ? <img src={pic} alt="" /> : initial(f.name)}</div>
      <div className="cb">
        <b>{f.name || "Facebook user"}</b> <small>{ago(Date.parse(c.created_time))}</small>
        <p>{c.message}</p>
        <div className="ca">
          <AsyncButton onClick={like}>
            <Icon name="like" /> Like{c.like_count ? " · " + c.like_count : ""}
          </AsyncButton>
          {!sub && (
            <button onClick={() => setReplying((v) => !v)}>
              <Icon name="cmt" /> Reply
            </button>
          )}
        </div>
        {replying && (
          <div className="rb">
            <input
              autoFocus
              placeholder="Write a reply…"
              maxLength={2000}
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && document.getElementById("send-" + c.id)?.click()}
            />
            <AsyncButton id={"send-" + c.id} className="btn pri sm" onClick={send} aria-label="Send reply">
              <Icon name="send" />
            </AsyncButton>
          </div>
        )}
        {((c.comments && c.comments.data) || []).map((r) => (
          <Comment key={r.id} c={r} sub onChange={onChange} />
        ))}
      </div>
    </div>
  );
}
