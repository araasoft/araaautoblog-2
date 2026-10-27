import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import Icon from "./Icon";
import PlatformBadges from "./PlatformBadges";
import { ago, fmt } from "../utils/format";

export default function PostCard({ post: p, index = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.04, duration: 0.25 }}
      whileTap={{ scale: 0.985 }}
    >
      <Link className="pc" to={`/post/${encodeURIComponent(p.key)}`}>
        <div className="th">
          {p.img ? <img src={p.img} loading="lazy" alt="" /> : <Icon name={p.hasImg ? "img" : "doc"} />}
        </div>
        <div className="pb">
          <div className="top2">
            <PlatformBadges fb={p.fb} li={p.li} />
            {p.sched && (
              <span className="pill warn">
                <Icon name="clock" /> Scheduled
              </span>
            )}
          </div>
          <p>{p.text || <i>(image only)</i>}</p>
          <small>
            {p.sched ? "Goes live " + fmt(p.schedAt) : ago(p.at) + " ago"}
            {p.author ? " · " + p.author : ""}
          </small>
        </div>
      </Link>
    </motion.div>
  );
}
