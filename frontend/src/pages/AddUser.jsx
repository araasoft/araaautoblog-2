import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Icon from "../components/Icon";
import Card from "../components/Card";
import AsyncButton from "../components/AsyncButton";
import QueryState from "../components/QueryState";
import Gate from "../components/Gate";
import { useAsync } from "../hooks/useAsync";
import { api } from "../services/api";
import { GUEST_ROLE } from "../utils/constants";
import { squareImage } from "../utils/image";
import { notify } from "../utils/notify";

export default function AddUser() {
  return (
    <Gate perm="users.manage">
      <Link className="back" to="/users">
        <Icon name="back" /> Team
      </Link>
      <Loader />
    </Gate>
  );
}

function Loader() {
  const { data, loading, error } = useAsync(() => api("GET", "/api/admins"), []);
  return (
    <QueryState loading={loading} error={error} data={data}>
      {data && <Form roles={data.roles} />}
    </QueryState>
  );
}

function Form({ roles }) {
  const nav = useNavigate();
  const [f, setF] = useState({ name: "", role: "content_creator", position: "", email: "", password: "", dob: "", phone: "", department: "", joinDate: new Date().toISOString().slice(0, 10) });
  const [photo, setPhoto] = useState(null);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const create = async () => {
    const b = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, k === "password" ? v : v.trim()]));
    if (photo) b.photo = await squareImage(photo);
    const u = await api("POST", "/api/admins", b);
    notify.success(`Created ${u.name} (${u.empId})`);
    nav(`/user/${encodeURIComponent(u.uid)}`);
  };

  return (
    <Card title="New admin account" icon="plus">
      <div className="hint">Use the official Araa Softwares details. Employee ID is created automatically.</div>
      <label className="l" htmlFor="a-name">Full name</label>
      <input id="a-name" maxLength={60} value={f.name} onChange={set("name")} />
      <label className="l" htmlFor="a-pos">Position (role and permissions)</label>
      <select id="a-pos" value={f.role} onChange={set("role")}>
        {Object.entries({ ...roles, ...GUEST_ROLE }).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <label className="l" htmlFor="a-title">Job title shown on profile (optional)</label>
      <input id="a-title" maxLength={60} value={f.position} onChange={set("position")} />
      <label className="l" htmlFor="a-mail">Official email</label>
      <input id="a-mail" type="email" autoComplete="off" value={f.email} onChange={set("email")} />
      <label className="l" htmlFor="a-pass">Password</label>
      <input id="a-pass" type="password" autoComplete="new-password" placeholder="8+ characters, letters and numbers" value={f.password} onChange={set("password")} />
      <label className="l" htmlFor="a-dob">Date of birth (for password recovery)</label>
      <input id="a-dob" type="date" value={f.dob} onChange={set("dob")} />
      <div className="grid2">
        <div>
          <label className="l" htmlFor="a-ph">Phone</label>
          <input id="a-ph" type="tel" maxLength={25} value={f.phone} onChange={set("phone")} />
        </div>
        <div>
          <label className="l" htmlFor="a-dep">Department</label>
          <input id="a-dep" maxLength={60} value={f.department} onChange={set("department")} />
        </div>
      </div>
      <label className="l" htmlFor="a-join">Joining date</label>
      <input id="a-join" type="date" value={f.joinDate} onChange={set("joinDate")} />
      <label className="l" htmlFor="a-photo">Profile photo (optional - the Araa logo is used if empty)</label>
      <input id="a-photo" type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files[0] || null)} />
      <AsyncButton className="pri full" style={{ marginTop: 14 }} onClick={create} loadingText="Creating...">
        <Icon name="ok" /> Create account
      </AsyncButton>
    </Card>
  );
}
