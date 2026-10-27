import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { LS } from "../utils/storage";
import { LS_KEYS } from "../utils/constants";

const ThemeContext = createContext(null);

const read = () => {
  const t = LS.get(LS_KEYS.theme);
  return t === "light" || t === "dark" ? t : "system";
};

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(read);

  useEffect(() => {
    const r = document.documentElement;
    if (theme === "light" || theme === "dark") r.dataset.theme = theme;
    else delete r.dataset.theme;
  }, [theme]);

  const setTheme = useCallback((t) => {
    if (t === "system") LS.del(LS_KEYS.theme);
    else LS.set(LS_KEYS.theme, t);
    setThemeState(t);
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
