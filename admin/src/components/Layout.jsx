import { useCallback, useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import Avatar from "./Avatar";
import PageTransition from "./PageTransition";
import Icon from "./Icon";
import ThemeSelector from "./ThemeSelector";
import { useAuth } from "../hooks/useAuth";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { LOGO, MENU, NAV_GROUP, ROLE_NAME, TITLES } from "../utils/constants";
import { api } from "../services/api";
import { notify } from "../utils/notify";
import { confirmAlert } from "../utils/alerts";

export default function Layout() {
  const { me, logout, canSee, guest } = useAuth();
  const [unread, setUnread] = useState(0);
  const last = useRef(0);
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  const seg = loc.pathname.split("/")[1] || "home";
  const group = NAV_GROUP[seg] || seg;
  const title = TITLES[seg] || "Home";
  useDocumentTitle(title);

  useEffect(() => {
    setOpen(false);
    window.scrollTo(0, 0);
  }, [loc.pathname]);

  const poll = useCallback(async (first) => {
    try {
      const d = await api("GET", "/api/notifications");
      setUnread(d.unread);
      const x = d.items[0];
      if (!first && x && x.at > last.current && x.unread) {
        notify.info("🔔 " + x.title + (x.detail ? "\n" + x.detail.slice(0, 90) : ""));
        if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
          try {
            new Notification(x.title, { body: x.detail, icon: LOGO });
          } catch {
            /* ignore */
          }
        }
      }
      if (x) last.current = Math.max(last.current, x.at);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (guest) return undefined;
    poll(true);
    const t = setInterval(() => poll(false), 25000);
    const h = () => poll(true);
    window.addEventListener("araa:bell", h);
    return () => {
      clearInterval(t);
      window.removeEventListener("araa:bell", h);
    };
  }, [poll, guest]);

  const signOut = async () => {
    if (await confirmAlert({ title: "Sign out?", confirmText: "Sign out", icon: "question" })) logout();
  };

  return (
    <div>
      <aside id="drawer" className={open ? "open" : ""}>
        <div className="brand">
          <img src={LOGO} alt="" />
          AraaPosts
        </div>
        <nav>
          {MENU.filter(([r]) => canSee(r)).map(([r, t, i]) => (
            <NavLink key={r} to={`/${r}`} className={group === r ? "on" : ""}>
              <Icon name={i} />
              <span>{t}</span>
            </NavLink>
          ))}
        </nav>
        <ThemeSelector />
        <div className="me">
          <Avatar u={me} />
          <div>
            <b>{me.name}</b>
            <small>{me.position || ROLE_NAME[me.role] || me.role}</small>
          </div>
          <button className="sm" onClick={signOut} title="Sign out" aria-label="Sign out">
            <Icon name="out" />
          </button>
        </div>
      </aside>
      <div id="scrim" className={open ? "show" : ""} onClick={() => setOpen(false)} />
      <header className="top">
        <button id="menu" aria-label="Menu" onClick={() => setOpen(true)}>
          <Icon name="menu" />
        </button>
        <h1>{title}</h1>
        {!guest && (
        <button type="button" id="bell" aria-label="Notifications" style={{ position: "relative" }} onClick={() => nav("/notifications")}>
          <Icon name="bell" />
          {unread > 0 && (
            <span style={{ position: "absolute", top: 2, right: 0, background: "var(--bad)", color: "#fff", borderRadius: 99, fontSize: 11, padding: "0 6px", lineHeight: "17px" }}>
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
        )}
        {guest ? <Avatar u={me} /> : (
        <Link to="/profile" aria-label="My profile">
          <Avatar u={me} />
        </Link>
        )}
      </header>
      {guest && (
        <div className="card" style={{ margin: "10px 12px 0", background: "var(--pale)", textAlign: "center" }}>
          <b>Guest account</b> · view only, some pages are disabled
        </div>
      )}
      <main className="page">
        <PageTransition key={loc.pathname}>
          <Outlet />
        </PageTransition>
      </main>
    </div>
  );
}
