import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { getAuthInstance, initFirebase } from "../lib/firebase";
import { api, fetchAuthConfig, setApiHandlers } from "../services/api";
import { notify } from "../utils/notify";
import { GUEST_PERMS, GUEST_ROUTES, MENU } from "../utils/constants";

const AuthContext = createContext(null);

export function authMessage(e) {
  const c = (e && e.code) || "";
  if (c.includes("email-already-in-use")) return "That email already has an account - use Sign in";
  if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(c)) return "Wrong email or password";
  if (c.includes("weak-password")) return "Password must be at least 6 characters";
  if (c.includes("invalid-email")) return "That email is not valid";
  if (c.includes("operation-not-allowed")) return "Email/password sign-in is off in Firebase Authentication";
  if (c.includes("too-many-requests")) return "Too many attempts - try later";
  if (c.includes("user-disabled")) return "This account is disabled";
  if (c.includes("network")) return "Network error - check your connection";
  return (e && e.message) || "Sign-in failed";
}

export function AuthProvider({ children }) {
  const [me, setMe] = useState(null);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState({ ready: false, firstUser: false });
  const manual = useRef(false);

  const enter = useCallback(async (name = "") => {
    const r = await api("POST", "/api/session", { name });
    setMe({ ...r.user });
    return r.user;
  }, []);

  const logout = useCallback(async () => {
    setMe(null);
    const a = getAuthInstance();
    if (a) await signOut(a).catch(() => {});
  }, []);

  useEffect(() => {
    setApiHandlers({
      unauthorized: () => logout(),
      pending: () => setMe((m) => (m ? { ...m, role: "pending" } : m)),
    });
  }, [logout]);

  // Load config, start Firebase and restore an existing session.
  useEffect(() => {
    let dead = false;
    let off = () => {};
    (async () => {
      const cfg = await fetchAuthConfig();
      if (dead) return;
      const a = initFirebase(cfg);
      setConfig({ ready: !!a, firstUser: !!cfg.firstUser });
      if (!a) {
        setLoading(false);
        return;
      }
      off = onAuthStateChanged(a, async (u) => {
        if (manual.current) return;
        if (!u) {
          setMe(null);
          setLoading(false);
          return;
        }
        try {
          await enter("");
        } catch {
          await logout();
        }
        setLoading(false);
      });
    })();
    return () => {
      dead = true;
      off();
    };
  }, [enter, logout]);

  const login = useCallback(
    async (email, password) => {
      manual.current = true;
      try {
        await signInWithEmailAndPassword(getAuthInstance(), email, password);
        await enter("");
      } catch (e) {
        const a = getAuthInstance();
        if (a) await signOut(a).catch(() => {});
        throw new Error(e.code ? authMessage(e) : e.message);
      } finally {
        manual.current = false;
      }
    },
    [enter],
  );

  const register = useCallback(
    async (name, email, password) => {
      manual.current = true;
      try {
        await createUserWithEmailAndPassword(getAuthInstance(), email, password);
        await enter(name);
      } catch (e) {
        throw new Error(e.code ? authMessage(e) : e.message);
      } finally {
        manual.current = false;
      }
    },
    [enter],
  );

  const resetPassword = useCallback(async (email) => {
    try {
      await sendPasswordResetEmail(getAuthInstance(), email);
      notify.success("Reset email sent - check your inbox");
    } catch (e) {
      throw new Error(authMessage(e));
    }
  }, []);

  const can = useCallback(
    (perm) => {
      if (!me) return false;
      if (me.role === "guest") return GUEST_PERMS.includes(perm);
      if (!Array.isArray(me.perms)) return me.role === "super" || me.role === "admin";
      return me.perms.includes("*") || me.perms.includes(perm);
    },
    [me],
  );
  const guest = me?.role === "guest";
  useEffect(() => {
    setApiHandlers({ readOnly: guest });
  }, [guest]);
  const canSee = useCallback(
    (route) => {
      if (!me) return false;
      if (guest) return GUEST_ROUTES.includes(route);
      const m = MENU.find((x) => x[0] === route);
      return !m || !m[3] || can(m[3]);
    },
    [me, guest, can],
  );
  const patchMe = useCallback((u) => setMe((m) => (m ? { ...m, ...u } : m)), []);

  const value = useMemo(
    () => ({ me, loading, config, can, canSee, guest, patchMe, login, register, logout, resetPassword, recheck: () => enter("") }),
    [me, loading, config, can, canSee, guest, patchMe, login, register, logout, resetPassword, enter],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
