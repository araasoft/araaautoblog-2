import { useState } from "react";
import Icon from "../components/Icon";
import Card from "../components/Card";
import AsyncButton from "../components/AsyncButton";
import QueryState from "../components/QueryState";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";
import { DEFAULT_BRAND } from "../utils/constants";
import { notify } from "../utils/notify";

export default function Brand() {
  const { data, loading, error } = useAsync(() => api("GET", "/api/status"), []);
  return (
    <QueryState loading={loading} error={error} data={data}>
      {data && <BrandForm initial={{ ...DEFAULT_BRAND, ...(data.settings.brand || {}) }} />}
    </QueryState>
  );
}

function BrandForm({ initial }) {
  const [b, setB] = useState({ ...initial, mix: { ...DEFAULT_BRAND.mix, ...initial.mix } });
  const set = (k) => (e) => setB((o) => ({ ...o, [k]: e.target.value }));
  const setMix = (k) => (e) => setB((o) => ({ ...o, mix: { ...o.mix, [k]: e.target.value } }));

  const save = async () => {
    await api("PUT", "/api/settings", { brand: b });
    notify.success("Brand saved");
  };

  const field = (id, label, key, area) => (
    <>
      <label className="l" htmlFor={id}>
        {label}
      </label>
      {area ? <textarea id={id} style={{ minHeight: 80 }} value={b[key]} onChange={set(key)} /> : <input id={id} value={b[key]} onChange={set(key)} />}
    </>
  );
  const mix = (k, label) => (
    <div>
      <label className="l" htmlFor={`m-${k}`}>
        {label} %
      </label>
      <input id={`m-${k}`} type="number" min="0" max="100" value={b.mix[k]} onChange={setMix(k)} />
    </div>
  );

  return (
    <>
      <Card title="Brand identity" icon="star">
        {field("b-name", "Brand name", "name")}
        {field("b-motto", "Motto", "motto")}
        {field("b-web", "Website", "website")}
        {field("b-serv", "Real services (AI only promotes these)", "services", true)}
        {field("b-aud", "Target audience", "audience", true)}
        {field("b-tone", "Tone of voice", "tone")}
        {field("b-avoid", "Never claim or mention", "avoid", true)}
        <div className="hint">The AI never invents customers, testimonials, awards or statistics.</div>
      </Card>
      <Card title="Content mix" icon="list">
        <div className="grid2" style={{ gridTemplateColumns: "repeat(3,1fr)" }}>
          {mix("educational", "Educational")}
          {mix("informational", "News")}
          {mix("promotional", "Promo")}
        </div>
        <div className="hint">How often automatic posts teach, inform or promote. They are used as weights.</div>
      </Card>
      <div className="bar">
        <AsyncButton className="btn pri full" onClick={save}>
          <Icon name="ok" /> Save brand
        </AsyncButton>
      </div>
    </>
  );
}
