import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import Icon from "../components/Icon";
import Card from "../components/Card";
import Switch from "../components/Switch";
import AsyncButton from "../components/AsyncButton";
import { api } from "../services/api";
import { AGENT_TASKS, LS_KEYS } from "../utils/constants";
import { LS } from "../utils/storage";
import { notify } from "../utils/notify";

// kept at module level so the last result survives navigating away and back
const saved = { task: "calendar", out: "" };

export default function Agent() {
  const nav = useNavigate();
  const [task, setTaskState] = useState(saved.task);
  const [out, setOutState] = useState(saved.out);
  const [input, setInput] = useState("");
  const [follow, setFollow] = useState("");
  const [useNews, setUseNews] = useState(false);
  const outRef = useRef(null);

  const setTask = (t) => {
    saved.task = t;
    setTaskState(t);
  };
  const setOut = (o) => {
    saved.out = o;
    setOutState(o);
  };

  const call = async (body) => {
    const r = await api("POST", "/api/agent", { ...body, useNews });
    setOut(r.text);
    setTimeout(() => outRef.current && outRef.current.scrollIntoView({ behavior: "smooth" }), 50);
  };
  const run = () => call({ task, input });
  const followUp = async () => {
    const v = follow.trim();
    if (!v) return;
    await call({ task: "chat", input: v, prev: out });
    setFollow("");
  };
  const copy = () =>
    navigator.clipboard.writeText(out).then(
      () => notify.success("Copied"),
      () => notify.error("Could not copy"),
    );
  const use = () => {
    LS.set(LS_KEYS.draft, out);
    nav("/create");
  };

  return (
    <>
      <div className="hero">
        <h2>Marketing AI</h2>
        <p>Content plans, captions, SEO, ads and strategy for your business.</p>
      </div>
      <Card>
        <div className="chips">
          {AGENT_TASKS.map(([k, t]) => (
            <label className="chip" key={k}>
              <input type="radio" name="tk" value={k} checked={k === task} onChange={() => setTask(k)} />
              {t}
            </label>
          ))}
        </div>
        <textarea
          style={{ minHeight: 90, marginTop: 12 }}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={AGENT_TASKS.find((t) => t[0] === task)[2]}
        />
        <div className="opt">
          <div>
            <b>Use today's news</b>
            <small>Adds the daily news analysis as context</small>
          </div>
          <Switch checked={useNews} onChange={setUseNews} label="Use today's news" />
        </div>
        <AsyncButton className="btn pri full" loadingText="Thinking…" onClick={run}>
          <Icon name="ai" /> Run
        </AsyncButton>
      </Card>

      <div ref={outRef}>
        <AnimatePresence>
          {out && (
            <motion.div key="res" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <Card title="Result" icon="ai" animate={false}>
                <div className="bt" style={{ fontSize: 15 }}>
                  {out}
                </div>
                <div className="row" style={{ marginTop: 12 }}>
                  <button className="btn sm" onClick={copy}>
                    <Icon name="doc" /> Copy
                  </button>
                  <button className="btn sm pri" onClick={use}>
                    <Icon name="plus" /> Use as post
                  </button>
                </div>
                <div className="row" style={{ marginTop: 12, flexWrap: "nowrap" }}>
                  <input
                    placeholder="Follow-up question…"
                    value={follow}
                    onChange={(e) => setFollow(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && document.getElementById("afup")?.click()}
                  />
                  <AsyncButton id="afup" className="btn sm" loadingText="…" aria-label="Send follow-up" onClick={followUp}>
                    <Icon name="send" />
                  </AsyncButton>
                </div>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
