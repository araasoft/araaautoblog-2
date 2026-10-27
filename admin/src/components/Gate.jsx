import { useLocation } from "react-router-dom";
import Empty from "./Empty";
import { useAuth } from "../hooks/useAuth";

/** Shows children only when the signed-in person may open this page. */
export default function Gate({ perm, children }) {
  const { can, canSee, guest } = useAuth();
  const seg = useLocation().pathname.split("/")[1] || "home";
  if (!canSee(seg) || (perm && !can(perm)))
    return <Empty icon="lock" text={guest ? "This page is disabled for guest accounts" : "Your position does not include this page"} />;
  return children;
}
