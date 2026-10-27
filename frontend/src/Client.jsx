import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
    Heart,
    Bookmark,
    Eye,
    MessageCircle,
    Send,
    Trash2,
    X,
    Mail,
    Lock,
    User,
    LogIn,
    LogOut
} from "lucide-react";
import {
    db,
    ref,
    set,
    remove,
    push,
    useDb,
    list,
    date,
    useAuth,
    userName,
    adminLogin,
    adminLogout,
    signup,
    googleLogin,
    resetPass,
    openAuth,
    toast
} from "./lib.js";

const ERR = {
    "auth/invalid-credential": "Wrong email or password.",
    "auth/invalid-email": "Enter a valid email.",
    "auth/email-already-in-use": "This email is already registered.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/too-many-requests": "Too many attempts. Try later.",
    "auth/popup-closed-by-user": "Sign-in was cancelled.",
    "auth/missing-password": "Enter your password."
};

/* login / signup / reset modal for readers */
export function AuthModal() {
    const [mode, setMode] = useState(null),
        [msg, setMsg] = useState(null),
        [busy, setBusy] = useState(false);
    useEffect(() => {
        const f = e => {
            setMode(e.detail);
            setMsg(null);
        };
        addEventListener("auth:open", f);
        return () => removeEventListener("auth:open", f);
    }, []);
    if (!mode) return null;
    const T = {
        login: ["Welcome back 👋", "Sign in to like, save and comment"],
        signup: ["Create account ✨", "Join AraaBlogs in a few seconds"],
        reset: ["Reset password 🔑", "We'll email you a reset link"]
    }[mode];
    const submit = async e => {
        e.preventDefault();
        const f = e.target.elements;
        setBusy(true);
        setMsg(null);
        try {
            const em = f.email.value.trim();
            if (mode === "login") await adminLogin(em, f.password.value);
            else if (mode === "signup") {
                if (!f.name.value.trim()) throw { code: "x" };
                await signup(f.name.value.trim(), em, f.password.value);
            } else {
                await resetPass(em);
                setMsg({ ok: 1, t: "Reset link sent. Check your email." });
                setBusy(false);
                return;
            }
            setMode(null);
            toast("Welcome!");
        } catch (x) {
            setMsg({ t: ERR[x.code] || "Something went wrong. Try again." });
        }
        setBusy(false);
    };
    const google = async () => {
        try {
            await googleLogin();
            setMode(null);
            toast("Welcome!");
        } catch (x) {
            setMsg({ t: ERR[x.code] || "Google sign-in failed." });
        }
    };
    const F = ({ I, ...r }) => (
        <label className="mb-3 flex h-[52px] items-center gap-2.5 rounded-2xl border border-[#dde2f3] bg-white px-3.5 text-[#8a93b5] focus-within:border-b focus-within:ring-4 focus-within:ring-b/15">
            <I size={18} />
            <input
                required
                className="min-w-0 flex-1 bg-transparent text-base text-n outline-none"
                {...r}
            />
        </label>
    );
    const sw = (m, t) => (
        <button
            type="button"
            onClick={() => {
                setMode(m);
                setMsg(null);
            }}
            className="font-semibold text-b"
        >
            {t}
        </button>
    );
    return (
        <div
            onClick={e => e.target === e.currentTarget && setMode(null)}
            className="fixed inset-0 z-[100] flex overflow-auto overscroll-contain bg-gradient-to-br from-y via-n via-[48%] to-b p-4 sm:p-5 animate-pop"
        >
            <div
                key={mode}
                className="relative m-auto w-[min(410px,100%)] rounded-[30px] bg-w p-7 pt-9 text-center text-n shadow-2xl animate-pop"
            >
                <button
                    onClick={() => setMode(null)}
                    className="absolute right-4 top-4 grid size-9 place-items-center rounded-full bg-[#eef1fb]"
                >
                    <X size={17} />
                </button>
                <div className="mx-auto mb-3.5 grid size-[68px] place-items-center rounded-full bg-n shadow-[0_10px_24px_-8px_#2948C2]">
                    <img src="/logo.png" alt="" className="w-10" />
                </div>
                <h2 className="text-[26px]">{T[0]}</h2>
                <p className="mb-5 mt-1.5 text-[15px] text-[#667]">{T[1]}</p>
                <form onSubmit={submit} noValidate={false}>
                    {mode === "signup" && (
                        <F
                            I={User}
                            name="name"
                            placeholder="Full name"
                            autoComplete="name"
                        />
                    )}
                    <F
                        I={Mail}
                        name="email"
                        type="email"
                        placeholder="Email address"
                        autoComplete="email"
                    />
                    {mode !== "reset" && (
                        <F
                            I={Lock}
                            name="password"
                            type="password"
                            placeholder="Password"
                            autoComplete={
                                mode === "login"
                                    ? "current-password"
                                    : "new-password"
                            }
                        />
                    )}
                    {mode === "login" && (
                        <div className="-mt-1 mb-2 text-right text-sm">
                            {sw("reset", "Forgot password?")}
                        </div>
                    )}
                    <p
                        className={`min-h-5 mb-2 text-sm ${msg?.ok ? "text-emerald-600" : "text-red-600"}`}
                    >
                        {msg?.t}
                    </p>
                    <button
                        disabled={busy}
                        className="h-[52px] w-full rounded-2xl bg-gradient-to-br from-b to-n font-semibold text-white shadow-[0_10px_24px_-10px_#2948C2] transition active:scale-[.98] disabled:opacity-60"
                    >
                        {
                            {
                                login: "Login",
                                signup: "Create account",
                                reset: "Send reset link"
                            }[mode]
                        }
                    </button>
                </form>
                {mode !== "reset" && (
                    <>
                        <div className="my-5 flex items-center gap-3 text-sm text-[#889] before:h-px before:flex-1 before:bg-[#e2e6f4] after:h-px after:flex-1 after:bg-[#e2e6f4]">
                            Or continue with
                        </div>
                        <button
                            onClick={google}
                            className="mx-auto flex h-[54px] items-center gap-2.5 rounded-full border border-[#dde2f3] bg-white px-6 text-sm font-semibold shadow-md transition hover:-translate-y-0.5"
                        >
                            <svg viewBox="0 0 48 48" width="22" height="22">
                                <path
                                    fill="#EA4335"
                                    d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"
                                />
                                <path
                                    fill="#4285F4"
                                    d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"
                                />
                                <path
                                    fill="#FBBC05"
                                    d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z"
                                />
                                <path
                                    fill="#34A853"
                                    d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"
                                />
                            </svg>
                            Google
                        </button>
                    </>
                )}
                <p className="mt-5 text-sm text-[#667]">
                    {mode === "login" ? (
                        <>No account? {sw("signup", "Create account")}</>
                    ) : mode === "signup" ? (
                        <>Have an account? {sw("login", "Login")}</>
                    ) : (
                        sw("login", "Back to login")
                    )}
                </p>
            </div>
        </div>
    );
}

export function Toast() {
    const [t, setT] = useState("");
    useEffect(() => {
        let id;
        const f = e => {
            setT(e.detail);
            clearTimeout(id);
            id = setTimeout(() => setT(""), 2200);
        };
        addEventListener("toast", f);
        return () => removeEventListener("toast", f);
    }, []);
    return (
        <div
            className={`pointer-events-none fixed bottom-[calc(28px+env(safe-area-inset-bottom,0px))] left-1/2 z-[200] -translate-x-1/2 rounded-full bg-y px-5 py-3 font-semibold text-n shadow-xl transition-all duration-300 ${t ? "translate-y-0 opacity-100" : "translate-y-8 opacity-0"}`}
        >
            {t}
        </div>
    );
}

/* nav: Login button, or avatar menu (Saved, Log out) */
export function UserMenu() {
    const { user } = useAuth(),
        [open, setOpen] = useState(false);
    if (user === undefined) return null;
    if (!user)
        return (
            <button
                onClick={() => openAuth("login")}
                className="btn pri sm ml-1"
            >
                <LogIn size={16} />
            </button>
        );
    return (
        <div className="relative ml-1">
            {open && (
                <div className="fixed inset-0" onClick={() => setOpen(false)} />
            )}
            <button
                onClick={() => setOpen(!open)}
                className="relative grid size-[38px] place-items-center overflow-hidden rounded-full bg-b font-semibold"
            >
                {user.photoURL ? (
                    <img
                        src={user.photoURL}
                        alt=""
                        referrerPolicy="no-referrer"
                        className="size-full object-cover"
                    />
                ) : (
                    userName(user)[0].toUpperCase()
                )}
            </button>
            <div
                className={`absolute right-0 top-12 w-56 origin-top-right rounded-2xl border border-w/10 bg-[#1a2350] p-2 shadow-2xl transition duration-200 ${open ? "scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0"}`}
            >
                <div className="mb-1.5 grid border-b border-w/10 px-3 py-2.5">
                    <b className="truncate">{userName(user)}</b>
                    <small className="truncate text-w/60">{user.email}</small>
                </div>
                <Link
                    to="/blogs?fav=1"
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm hover:bg-w/10"
                >
                    <Bookmark size={16} />
                    Saved blogs
                </Link>
                <button
                    onClick={async () => {
                        setOpen(false);
                        await adminLogout();
                        toast("Logged out");
                    }}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm hover:bg-w/10"
                >
                    <LogOut size={16} />
                    Log out
                </button>
            </div>
        </div>
    );
}

/* like / save / views bar on an article */
export function Engage({ id, views }) {
    const { user } = useAuth(),
        likes = useDb(`blog_likes/${id}`) || {},
        saved = useDb(user ? `blog_favs/${user.uid}` : null) || {};
    const liked = !!(user && likes[user.uid]),
        fav = !!saved[id],
        n = Object.keys(likes).length;
    const flip = (path, on) => {
        if (!user) return openAuth("login");
        on ? remove(ref(db, path)) : set(ref(db, path), true);
    };
    const B = ({ on, c, onClick, children }) => (
        <button
            onClick={onClick}
            className={`chip transition active:scale-95 ${on ? "!border-y text-y" : "hover:bg-w/10"}`}
        >
            <span className={on ? c : ""}>{children[0]}</span>
            {children[1]}
        </button>
    );
    return (
        <>
            <B
                on={liked}
                c="animate-pop [&_svg]:fill-current"
                onClick={() => flip(`blog_likes/${id}/${user?.uid}`, liked)}
            >
                <Heart size={16} />
                {n}
            </B>
            <B
                on={fav}
                c="animate-pop [&_svg]:fill-current"
                onClick={() => flip(`blog_favs/${user?.uid}/${id}`, fav)}
            >
                <Bookmark size={16} />
                {fav ? "Saved" : "Save"}
            </B>
            <span className="chip">
                <Eye size={15} />
                {views}
            </span>
        </>
    );
}

export function Comments({ id }) {
    const { user } = useAuth(),
        data = useDb(`blog_comments/${id}`),
        [t, setT] = useState(""),
        all = list(data).sort((a, b) => b.createdAt - a.createdAt);
    const post = async e => {
        e.preventDefault();
        const text = t.trim();
        if (!text) return;
        setT("");
        await push(ref(db, `blog_comments/${id}`), {
            uid: user.uid,
            name: userName(user),
            text,
            createdAt: Date.now()
        }).catch(() => toast("Could not post comment"));
    };
    return (
        <section className="mt-14">
            <h3 className="mb-5 flex items-center gap-2 text-2xl">
                <MessageCircle />
                Comments <span className="text-y">{all.length}</span>
            </h3>
            {user ? (
                <form onSubmit={post} className="mb-6 grid gap-3">
                    <textarea
                        value={t}
                        onChange={e => setT(e.target.value)}
                        maxLength={500}
                        required
                        placeholder="Write a comment…"
                        className="min-h-24 w-full resize-y rounded-2xl border border-w/10 bg-w/5 p-4 outline-none transition focus:border-y"
                    />
                    <button className="btn pri justify-self-end">
                        <Send size={16} />
                        Post comment
                    </button>
                </form>
            ) : (
                <div className="mb-6 grid justify-items-start gap-3">
                    <p className="text-w/60">
                        Log in to like, save and comment.
                    </p>
                    <button
                        onClick={() => openAuth("login")}
                        className="btn pri"
                    >
                        <LogIn size={16} />
                        Login
                    </button>
                </div>
            )}
            {data === null ? (
                <div className="sk h-20" />
            ) : (
                all.map(c => (
                    <div
                        key={c.id}
                        className="flex gap-3.5 border-t border-w/10 py-4 animate-rise"
                    >
                        <div className="grid size-10 flex-none place-items-center rounded-full bg-b font-semibold">
                            {(c.name || "?")[0].toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                            <b>{c.name}</b>
                            <small className="ml-2 text-w/50">
                                {date(c.createdAt)}
                            </small>
                            {user && c.uid === user.uid && (
                                <button
                                    onClick={() =>
                                        remove(
                                            ref(
                                                db,
                                                `blog_comments/${id}/${c.id}`
                                            )
                                        )
                                    }
                                    title="Delete"
                                    className="ml-2 align-middle text-w/50 hover:text-red-400"
                                >
                                    <Trash2 size={14} />
                                </button>
                            )}
                            <p className="mt-1 break-words leading-relaxed">
                                {c.text}
                            </p>
                        </div>
                    </div>
                ))
            )}
            {data && !all.length && (
                <p className="text-w/60">No comments yet. Be the first.</p>
            )}
        </section>
    );
}
