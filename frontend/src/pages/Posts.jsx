import { useState } from "react";
import Icon from "../components/Icon";
import Segmented from "../components/Segmented";
import PostCard from "../components/PostCard";
import QueryState from "../components/QueryState";
import Empty from "../components/Empty";
import { useAsync } from "../hooks/useAsync";
import { usePosts } from "../hooks/useAuth";

const FILTERS = [
  ["all", "All"],
  ["fb", "Facebook"],
  ["li", "LinkedIn"],
  ["sc", "Scheduled"],
];
const apply = (l, f) => (f === "fb" ? l.filter((p) => p.fb) : f === "li" ? l.filter((p) => p.li) : f === "sc" ? l.filter((p) => p.sched) : l);

export default function Posts() {
  const { load } = usePosts();
  const [filter, setFilter] = useState("all");
  const { data, loading, error, reload } = useAsync(() => load(true), []);
  const rows = data ? apply(data, filter) : [];

  return (
    <>
      <div className="row sp" style={{ marginBottom: 12, flexWrap: "nowrap" }}>
        <Segmented style={{ flex: 1 }} options={FILTERS} value={filter} onChange={setFilter} />
        <button className="btn sm" aria-label="Refresh" onClick={() => reload()}>
          <Icon name="ref" />
        </button>
      </div>
      <QueryState loading={loading} error={error} data={data}>
        {rows.length ? rows.map((p, i) => <PostCard key={p.key} post={p} index={i} />) : <Empty icon="doc" text="No posts here yet" />}
      </QueryState>
    </>
  );
}
