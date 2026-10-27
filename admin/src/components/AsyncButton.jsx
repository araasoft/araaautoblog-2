import { useAsyncAction } from "../hooks/useAsyncAction";

/**
 * Button that disables itself while its async onClick runs, optionally swaps its label,
 * and reports errors with a toast.
 */
export default function AsyncButton({ onClick, loadingText, children, className = "", disabled, ...rest }) {
  const [run, busy] = useAsyncAction();
  return (
    <button
      type="button"
      className={className}
      disabled={disabled || busy}
      onClick={(e) => run(() => onClick(e))}
      {...rest}
    >
      {busy && loadingText ? loadingText : children}
    </button>
  );
}
