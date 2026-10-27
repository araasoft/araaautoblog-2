import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import Empty from "../components/Empty";
import Icon from "../components/Icon";
import Avatar from "../components/Avatar";
import QueryState from "../components/QueryState";
import { useAsync } from "../hooks/useAsync";
import { useAuth } from "../hooks/useAuth";
import { api } from "../services/api";
import { ROLE_NAME } from "../utils/constants";

const ORDER = { super: 0, pending: 9 };
export const rolePill = (r) => (r === "super" ? "ok" : r === "pending" ? "warn" : "");

export default function Users() {
  const { can } = useAuth();
  const { data, loading, error } = useAsync(() => api("GET", "/api/admins"), []);

  return (
    <QueryState loading={loading} error={error} data={data}>
      {data && (
        <>
          {can("users.manage") && (
            <Link className="btn pri full" to="/adduser" style={{ marginBottom: 12 }}>
              <Icon name="plus" /> Add admin
            </Link>
          )}
          <List d={data} />
        </>
      )}
    </QueryState>
  );
}

function List({ d }) {
  const us = [...d.users].sort((a, b) => (ORDER[a.role] ?? 1) - (ORDER[b.role] ?? 1) || a.name.localeCompare(b.name));
  if (!us.length) return <Empty icon="users" text="No team members" />;
  return us.map((u, i) => (
    <motion.div key={u.uid} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 8) * 0.04 }}>
      <Link className="u" to={`/user/${encodeURIComponent(u.uid)}`}>
        <Avatar u={u} />
        <div>
          <b>
            {u.name}
            {u.uid === d.me ? " (you)" : ""}
          </b>
          <small>
            {u.empId || ""} · {u.position || ROLE_NAME[u.role]}
          </small>
        </div>
        <span className={`pill ${rolePill(u.role)}`}>{ROLE_NAME[u.role] || u.role}</span>
      </Link>
    </motion.div>
  ));
}
