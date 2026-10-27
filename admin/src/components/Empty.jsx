import Icon from "./Icon";

export default function Empty({ icon = "doc", text }) {
  return (
    <div className="empty">
      <Icon name={icon} />
      <div>{text}</div>
    </div>
  );
}
