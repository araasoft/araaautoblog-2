import Icon from "./Icon";

export default function PlatformBadges({ fb, li }) {
  return (
    <span className="pls">
      {fb && (
        <span className="pl fb" title="Facebook">
          <Icon name="fb" />
        </span>
      )}
      {li && (
        <span className="pl li" title="LinkedIn">
          <Icon name="li" />
        </span>
      )}
    </span>
  );
}
