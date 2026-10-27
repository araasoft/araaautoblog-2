import { LOGO } from "../utils/constants";

/** Profile photo, or the Araa logo when the person has none. */
export default function Avatar({ u, className = "av", style }) {
  return (
    <div className={className} style={style}>
      <img src={(u && u.photo) || LOGO} alt="" />
    </div>
  );
}
