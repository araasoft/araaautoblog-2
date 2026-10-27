import { motion } from "framer-motion";
import AsyncButton from "../components/AsyncButton";
import { useAuth } from "../hooks/useAuth";
import { notify } from "../utils/notify";

export default function Pending() {
  const { recheck, logout } = useAuth();
  const check = async () => {
    const u = await recheck();
    if (u.role === "pending") notify.info("Still waiting for the super admin");
  };
  return (
    <section style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 18 }}>
      <motion.div className="card" style={{ maxWidth: 400, textAlign: "center" }} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        <h2 style={{ justifyContent: "center" }}>Waiting for approval</h2>
        <p style={{ margin: "12px 0" }}>Your account is created. The super admin needs to approve it before you can use the dashboard.</p>
        <div className="row" style={{ justifyContent: "center" }}>
          <AsyncButton className="btn pri" onClick={check}>
            Check again
          </AsyncButton>
          <button className="btn" onClick={logout}>
            Sign out
          </button>
        </div>
      </motion.div>
    </section>
  );
}
