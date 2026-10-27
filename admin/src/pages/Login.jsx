import { useState } from "react";
import { motion } from "framer-motion";
import Segmented from "../components/Segmented";
import AsyncButton from "../components/AsyncButton";
import { useAuth } from "../hooks/useAuth";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { notify } from "../utils/notify";
import { LOGO } from "../utils/constants";

export default function Login() {
  const { login, register, resetPassword, config } = useAuth();
  const [mode, setMode] = useState(config.firstUser ? "up" : "in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  useDocumentTitle("Sign in");

  const go = async () => {
    const e = email.trim();
    if (!e || !pass) return notify.error("Enter email and password");
    if (mode === "up" && !name.trim()) return notify.error("Enter your name");
    if (mode === "up") await register(name.trim(), e, pass);
    else await login(e, pass);
    setPass("");
  };

  const forgot = async () => {
    if (!email.trim()) return notify.error("Type your email first");
    await resetPassword(email.trim());
  };

  return (
    <section id="auth">
      <motion.div className="card" initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}>
        <div className="brand">
          <img src={LOGO} alt="" width="40" height="40" />
          AraaPosts
        </div>
        {!config.ready ? (
          <p>
            Firebase sign-in is not set up. Set <b>VITE_FIREBASE_API_KEY</b> (and the other VITE_FIREBASE_* values) in{" "}
            <b>.env</b>, or configure <b>FIREBASE_WEB_API_KEY</b> on the server, then reload.
          </p>
        ) : (
          <form
            onSubmit={(ev) => ev.preventDefault()}
          >
            <Segmented
              options={[
                ["in", "Sign in"],
                ["up", "Create account"],
              ]}
              value={mode}
              onChange={setMode}
            />
            {mode === "up" && (
              <>
                <label className="l" htmlFor="name">
                  Your name
                </label>
                <input id="name" autoComplete="name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
              </>
            )}
            <label className="l" htmlFor="email">
              Email
            </label>
            <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <label className="l" htmlFor="pass">
              Password
            </label>
            <input
              id="pass"
              type="password"
              autoComplete={mode === "up" ? "new-password" : "current-password"}
              placeholder="At least 6 characters"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
            />
            {config.firstUser && (
              <div className="hint">
                <b>No account exists yet.</b> The first account becomes the <b>super admin</b>.
              </div>
            )}
            <div className="row" style={{ marginTop: 16 }}>
              <AsyncButton id="authGo" type="submit" className="btn pri" style={{ flex: 1 }} onClick={go}>
                {mode === "up" ? "Create account" : "Sign in"}
              </AsyncButton>
              <AsyncButton className="btn" onClick={forgot}>
                Forgot password
              </AsyncButton>
            </div>
          </form>
        )}
      </motion.div>
    </section>
  );
}
