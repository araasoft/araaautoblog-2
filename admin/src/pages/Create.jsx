import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Icon from "../components/Icon";
import Card from "../components/Card";
import Segmented from "../components/Segmented";
import AsyncButton from "../components/AsyncButton";
import TargetPicker from "../components/TargetPicker";
import { usePosts } from "../hooks/useAuth";
import { api } from "../services/api";
import { LS } from "../utils/storage";
import { LS_KEYS } from "../utils/constants";
import { notify } from "../utils/notify";
import { resizeImage } from "../utils/image";
import { report } from "../utils/posts";

const readDraft = () => {
  const d = LS.get(LS_KEYS.draft);
  if (d) LS.del(LS_KEYS.draft);
  return d || "";
};

export default function Create() {
  const nav = useNavigate();
  const { invalidate } = usePosts();
  const [type, setType] = useState("text");
  const [src, setSrc] = useState("upload");
  const [message, setMessage] = useState(readDraft);
  const [topic, setTopic] = useState("");
  const [link, setLink] = useState("");
  const [imgData, setImgData] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [keyword, setKeyword] = useState("");
  const [aiImg, setAiImg] = useState("");
  const [credit, setCredit] = useState("");
  const [targets, setTargets] = useState(["facebook"]);
  const [when, setWhen] = useState("");
  const fileRef = useRef(null);

  const preview = src === "upload" ? imgData : src === "url" ? imageUrl.trim() : aiImg;

  const onFile = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      setImgData(await resizeImage(f));
    } catch (err) {
      notify.error(err.message);
    }
  };

  const aiWrite = async () => {
    const d = await api("POST", "/api/ai/draft", { topic });
    setMessage(d.text);
    if (type !== "text" && src === "ai" && !keyword) setKeyword(d.imageKeyword || "");
    notify.success("Draft ready - edit it if you like");
  };

  const aiFind = async () => {
    const d = await api("POST", "/api/ai/image", { keyword });
    setAiImg(d.imageUrl);
    setCredit(d.credit || "");
  };

  const publish = async () => {
    const body = {};
    const msg = message.trim();
    if (type !== "image") {
      if (!msg) throw new Error("Write some text first");
      body.message = msg;
      if (type === "text" && link.trim()) body.link = link.trim();
    }
    if (type !== "text") {
      if (src === "upload") {
        if (!imgData) throw new Error("Choose an image first");
        body.imageData = imgData;
      } else if (src === "url") {
        if (!imageUrl.trim()) throw new Error("Paste an image URL");
        body.imageUrl = imageUrl.trim();
      } else {
        if (!aiImg) throw new Error("Tap Find first");
        body.imageUrl = aiImg;
      }
    }
    if (when) body.scheduleAt = new Date(when).toISOString();
    if (!targets.length) throw new Error("Pick at least one place to post to");
    body.targets = targets;
    const { results } = await api("POST", "/api/publish", body);
    invalidate();
    if (report(results, "published", !!when)) nav("/posts");
  };

  return (
    <>
      <Card>
        <Segmented
          options={[
            ["text", <><Icon name="doc" /> Text</>],
            ["image", <><Icon name="img" /> Image</>],
            ["both", "Both"],
          ]}
          value={type}
          onChange={setType}
        />
        {type !== "image" && (
          <div>
            <label className="l" htmlFor="message">
              Post text{" "}
              <span style={{ float: "right", fontWeight: 400 }}>
                <span>{message.length}</span> chars
              </span>
            </label>
            <textarea id="message" placeholder="Write your post, or let AI write it" value={message} onChange={(e) => setMessage(e.target.value)} />
            <div className="row" style={{ marginTop: 8, flexWrap: "nowrap" }}>
              <input placeholder="AI topic (optional)" value={topic} onChange={(e) => setTopic(e.target.value)} />
              <AsyncButton className="btn sm" style={{ whiteSpace: "nowrap" }} loadingText="Writing…" onClick={aiWrite}>
                <Icon name="ai" /> Write
              </AsyncButton>
            </div>
            {type === "text" && (
              <div>
                <label className="l" htmlFor="link">
                  Link (optional)
                </label>
                <input id="link" type="url" placeholder="https://araasoftwares.com" value={link} onChange={(e) => setLink(e.target.value)} />
              </div>
            )}
          </div>
        )}
        {type !== "text" && (
          <div>
            <label className="l">Image</label>
            <Segmented
              options={[
                ["upload", "Upload"],
                ["url", "URL"],
                ["ai", "AI find"],
              ]}
              value={src}
              onChange={setSrc}
            />
            <div style={{ marginTop: 10 }}>
              {src === "upload" && <input ref={fileRef} type="file" accept="image/*" onChange={onFile} />}
              {src === "url" && <input type="url" placeholder="https://example.com/photo.jpg" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />}
              {src === "ai" && (
                <div className="row" style={{ flexWrap: "nowrap" }}>
                  <input placeholder="e.g. web development" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
                  <AsyncButton className="btn sm" style={{ whiteSpace: "nowrap" }} loadingText="…" onClick={aiFind}>
                    <Icon name="img" /> Find
                  </AsyncButton>
                </div>
              )}
            </div>
            {preview && <img className="img-prev" src={preview} alt="" />}
            <div className="hint">{src === "ai" ? credit : ""}</div>
          </div>
        )}
      </Card>

      <Card title="Post to" icon="send">
        <TargetPicker targets={["facebook", "linkedin_personal", "linkedin_company"]} value={targets} onChange={setTargets} labels={{ linkedin_personal: "Profile", linkedin_company: "Company page" }} />
        <label className="l" htmlFor="when">
          Schedule (Facebook only, optional)
        </label>
        <input id="when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
        <div className="hint">LinkedIn posts publish immediately. Images: JPG, PNG, WEBP or GIF.</div>
      </Card>

      <div className="bar">
        <AsyncButton className="btn pri full" loadingText="Publishing…" onClick={publish}>
          <Icon name="send" /> Publish
        </AsyncButton>
      </div>
    </>
  );
}
