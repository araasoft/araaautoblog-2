import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import Icon from "../components/Icon";
import Card from "../components/Card";
import Empty from "../components/Empty";
import Avatar from "../components/Avatar";
import LockRow from "../components/LockRow";
import AsyncButton from "../components/AsyncButton";
import QueryState from "../components/QueryState";
import { rolePill } from "./Users";
import { useAsync } from "../hooks/useAsync";
import { useAuth } from "../hooks/useAuth";
import { api } from "../services/api";
import { GUEST_ROLE, ROLE_NAME } from "../utils/constants";
import { notify } from "../utils/notify";
import { confirmAlert } from "../utils/alerts";

export default function UserDetail() {
  const { uid } = useParams();
  const { data, loading, error, reload } = useAsync(() => api("GET", "/api/admins"), [uid]);
  const u = data && data.users.find((x) => x.uid === uid);

  return (
    <>
      <Link className="back" to="/users">
        <Icon name="back" /> Team
      </Link>
      <QueryState loading={loading} error={error} data={data}>
        {!u ? <Empty icon="users" text="Not found" /> : <Detail key={u.uid + (u.updatedAt || "")} u={u} d={data} reload={reload} />}
      </QueryState>
    </>
  );
}

function Detail({ u, d, reload }) {
  const { can } = useAuth();
  const sup = can("users.manage");
  const own = u.uid === d.me;
  const editable = sup && u.role !== "super";
  const [f, setF] = useState({ name: u.name || "", role: u.role, position: u.position || "", department: u.department || "", phone: u.phone || "", dob: u.dob || "" });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const save = async () => {
    const b = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim()]));
    if (!b.dob) delete b.dob;
    await api("PUT", `/api/admins/${encodeURIComponent(u.uid)}`, b);
    notify.success("Saved");
    await reload(true);
  };
  const noAccess = async () => {
    const ok = await confirmAlert({ title: "Remove access?", text: "Their sign-in stops working in the dashboard.", confirmText: "Remove", danger: true, icon: "warning" });
    if (!ok) return;
    await api("PUT", `/api/admins/${encodeURIComponent(u.uid)}`, { role: "pending" });
    notify.success("Access removed");
    await reload(true);
  };

  return (
    <>
      <Card style={{ textAlign: "center" }}>
        <Avatar u={u} className="av lg" style={{ margin: "0 auto 10px" }} />
        <h2 style={{ justifyContent: "center", margin: 0 }}>{u.name}</h2>
        <div className="hint">{u.position || ""} · {u.empId || ""}</div>
        <div style={{ marginTop: 8 }}>
          <span className={`pill ${rolePill(u.role)}`}>
            <Icon name="shield" /> {ROLE_NAME[u.role] || u.role}
          </span>
        </div>
      </Card>

      <Card title="Details" icon="doc">
        <LockRow label="Official email" value={u.email} />
        <LockRow label="Department" value={u.department} />
        {(sup || own) && <LockRow label="Phone" value={u.phone} />}
        {(sup || own) && <LockRow label="Date of birth" value={u.dob} />}
        <LockRow label="Joined" value={u.joinDate || (u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "")} />
        {own && (
          <Link to="/profile" className="btn full" style={{ marginTop: 10 }}>
            Edit my profile
          </Link>
        )}
      </Card>

      {editable ? (
        <Card title="Edit (super admin)" icon="edit">
          <label className="l" htmlFor="e-name">Name</label>
          <input id="e-name" value={f.name} onChange={set("name")} />
          <label className="l" htmlFor="e-pos">Position / permissions</label>
          <select id="e-pos" value={f.role} onChange={set("role")}>
            {u.role === "pending" && <option value="pending">No access</option>}
            {Object.entries({ ...d.roles, ...GUEST_ROLE }).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <label className="l" htmlFor="e-title">Job title</label>
          <input id="e-title" value={f.position} onChange={set("position")} />
          <div className="grid2">
            <div>
              <label className="l" htmlFor="e-dep">Department</label>
              <input id="e-dep" value={f.department} onChange={set("department")} />
            </div>
            <div>
              <label className="l" htmlFor="e-ph">Phone</label>
              <input id="e-ph" value={f.phone} onChange={set("phone")} />
            </div>
          </div>
          <label className="l" htmlFor="e-dob">Date of birth</label>
          <input id="e-dob" type="date" value={f.dob} onChange={set("dob")} />
          <div className="grid2" style={{ marginTop: 12 }}>
            <AsyncButton className="pri" onClick={save} loadingText="Saving...">
              <Icon name="ok" /> Save
            </AsyncButton>
            <AsyncButton className="dang" disabled={u.role === "pending"} onClick={noAccess}>
              <Icon name="x" /> Remove access
            </AsyncButton>
          </div>
          <div className="hint">Employee ID and email never change.</div>
        </Card>
      ) : (
        <div className="hint">{u.role === "super" ? "The super admin cannot be changed." : "Only the super admin can edit accounts."}</div>
      )}
    </>
  );
}
