import { useRef, useState } from "react";
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import Icon from "../components/Icon";
import Card from "../components/Card";
import Avatar from "../components/Avatar";
import LockRow from "../components/LockRow";
import AsyncButton from "../components/AsyncButton";
import QueryState from "../components/QueryState";
import { useAsync } from "../hooks/useAsync";
import { useAuth } from "../hooks/useAuth";
import { api } from "../services/api";
import { getAuthInstance } from "../lib/firebase";
import { authMessage } from "../context/AuthContext";
import { squareImage } from "../utils/image";
import { notify } from "../utils/notify";

export default function Profile() {
  const { data, loading, error } = useAsync(() => api("GET", "/api/me"), []);
  return (
    <QueryState loading={loading} error={error} data={data}>
      {data && <Form u={data} />}
    </QueryState>
  );
}

function Form({ u }) {
  const { me, patchMe } = useAuth();
  const [phone, setPhone] = useState(u.phone || "");
  const [address, setAddress] = useState(u.address || "");
  const [bio, setBio] = useState(u.bio || "");
  const [photo, setPhoto] = useState(undefined); // undefined = unchanged, "" = use logo
  const [cur, setCur] = useState("");
  const [nw, setNw] = useState("");
  const file = useRef(null);
  const shown = photo === undefined ? u.photo : photo;

  const pick = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      setPhoto(await squareImage(f));
    } catch (x) {
      notify.error(x.message);
    }
  };
  const save = async () => {
    const b = { phone, address, bio };
    if (photo !== undefined) b.photo = photo;
    const r = await api("PUT", "/api/profile", b);
    patchMe(r);
    setPhoto(undefined);
    notify.success("Profile saved");
  };
  const changePass = async () => {
    if (nw.length < 8 || !/\d/.test(nw) || !/[A-Za-z]/.test(nw)) throw new Error("New password needs 8+ characters with letters and numbers");
    const a = getAuthInstance();
    try {
      await reauthenticateWithCredential(a.currentUser, EmailAuthProvider.credential(me.email, cur));
      await updatePassword(a.currentUser, nw);
    } catch (e) {
      throw new Error(e.code ? authMessage(e) : e.message);
    }
    setCur("");
    setNw("");
    notify.success("Password changed");
  };

  return (
    <>
      <Card style={{ textAlign: "center" }}>
        <Avatar u={{ photo: shown }} className="av lg" style={{ margin: "0 auto 10px" }} />
        <h2 style={{ justifyContent: "center", margin: 0 }}>{u.name}</h2>
        <div className="hint">{u.position} · {u.empId}</div>
        <div className="row" style={{ justifyContent: "center", marginTop: 10 }}>
          <button type="button" className="sm" onClick={() => file.current.click()}>
            <Icon name="img" /> Change photo
          </button>
          <input ref={file} type="file" accept="image/*" className="hide" onChange={pick} />
          <button type="button" className="sm" onClick={() => { setPhoto(""); notify.success("Save to apply"); }}>
            Use Araa logo
          </button>
        </div>
      </Card>

      <Card title="Set by Araa Softwares" icon="lock">
        <LockRow label="Employee ID" value={u.empId} />
        <LockRow label="Name" value={u.name} />
        <LockRow label="Position" value={u.position} />
        <LockRow label="Official email" value={u.email} />
        <LockRow label="Date of birth" value={u.dob} />
        <LockRow label="Joined" value={u.joinDate} />
        <div className="hint">To change these, ask the super admin.</div>
      </Card>

      <Card title="You can edit" icon="edit">
        <label className="l" htmlFor="p-ph">Phone</label>
        <input id="p-ph" type="tel" maxLength={25} value={phone} onChange={(e) => setPhone(e.target.value)} />
        <label className="l" htmlFor="p-ad">Address</label>
        <input id="p-ad" maxLength={160} value={address} onChange={(e) => setAddress(e.target.value)} />
        <label className="l" htmlFor="p-bio">About me</label>
        <textarea id="p-bio" style={{ minHeight: 70 }} maxLength={200} value={bio} onChange={(e) => setBio(e.target.value)} />
        <AsyncButton className="pri full" style={{ marginTop: 12 }} onClick={save} loadingText="Saving...">
          <Icon name="ok" /> Save profile
        </AsyncButton>
      </Card>

      <Card title="Change password" icon="shield">
        <label className="l" htmlFor="p-cur">Current password</label>
        <input id="p-cur" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
        <label className="l" htmlFor="p-new">New password</label>
        <input id="p-new" type="password" autoComplete="new-password" placeholder="8+ characters, letters and numbers" value={nw} onChange={(e) => setNw(e.target.value)} />
        <AsyncButton className="full" style={{ marginTop: 12 }} onClick={changePass} loadingText="Changing...">
          <Icon name="lock" /> Change password
        </AsyncButton>
      </Card>
    </>
  );
}
