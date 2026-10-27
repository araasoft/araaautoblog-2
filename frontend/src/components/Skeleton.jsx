export default function Skeleton({ n = 3 }) {
  return Array.from({ length: n }, (_, i) => <div className="sk" key={i} />);
}
