import { createContext, useCallback, useContext, useMemo, useRef } from "react";
import { api } from "../services/api";
import { normFb, normRec } from "../utils/posts";
import { useAuth } from "./AuthContext";

const PostsContext = createContext(null);

export function PostsProvider({ children }) {
  const cache = useRef(null);
  const { me } = useAuth();

  // Drop the cache whenever the signed-in user changes.
  const uid = me && (me.uid || me.email || me.name);
  const lastUid = useRef(uid);
  if (lastUid.current !== uid) {
    lastUid.current = uid;
    cache.current = null;
  }

  const invalidate = useCallback(() => {
    cache.current = null;
  }, []);

  const load = useCallback(async (force = false) => {
    if (cache.current && !force && Date.now() - cache.current.t < 30000) return cache.current.list;
    const [rows, fl, sc] = await Promise.all([
      api("GET", "/api/records?limit=40"),
      api("GET", "/api/posts?limit=20").catch(() => ({ data: [] })),
      api("GET", "/api/scheduled").catch(() => ({ data: [] })),
    ]);
    const seen = new Set(
      rows.map((r) => r.targets && r.targets.facebook && r.targets.facebook.postId).filter(Boolean),
    );
    const list = [
      ...rows.map(normRec),
      ...(fl.data || []).filter((p) => !seen.has(p.id)).map((p) => normFb(p, false)),
      ...(sc.data || []).filter((p) => !seen.has(p.id)).map((p) => normFb(p, true)),
    ].sort((a, b) => b.at - a.at);
    cache.current = { t: Date.now(), list };
    return list;
  }, []);

  const value = useMemo(() => ({ load, invalidate }), [load, invalidate]);
  return <PostsContext.Provider value={value}>{children}</PostsContext.Provider>;
}

export const usePosts = () => useContext(PostsContext);
