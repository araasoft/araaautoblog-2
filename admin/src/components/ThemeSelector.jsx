import { useTheme } from "../hooks/useAuth";

export default function ThemeSelector() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="themesel" role="group" aria-label="Theme">
      <div className="seg">
        {[
          ["light", "Light"],
          ["dark", "Dark"],
          ["system", "System"],
        ].map(([v, t]) => (
          <button key={v} type="button" aria-pressed={theme === v} onClick={() => setTheme(v)}>
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}
