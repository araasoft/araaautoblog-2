import Empty from "./Empty";
import Skeleton from "./Skeleton";

/** Renders a skeleton while loading, an error block on failure, otherwise children. */
export default function QueryState({ loading, error, data, rows = 3, children }) {
  if (loading && !data) return <Skeleton n={rows} />;
  if (error) return <Empty icon="x" text={error.message} />;
  if (!data) return null;
  return children;
}
