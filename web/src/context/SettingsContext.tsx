import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "../lib/api";
import type { Currency } from "../lib/format";
import {
  applyThemeToDom,
  isThemeId,
  readStoredTheme,
  storeTheme,
  type ThemeId,
} from "../lib/theme";

interface SettingsCtx {
  currency: Currency;
  theme: ThemeId;
  settings: Record<string, string>;
  refresh: () => Promise<void>;
  setCurrency: (c: Currency) => void;
  setTheme: (t: ThemeId) => void;
}

const Ctx = createContext<SettingsCtx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [currency, setCurrencyState] = useState<Currency>("RIAL");
  // Start from localStorage so a dark-theme user keeps the theme the inline
  // bootstrap already painted; refresh() upgrades this to the server value.
  const [theme, setThemeState] = useState<ThemeId>(readStoredTheme);

  async function refresh() {
    try {
      const s = await api.settings();
      setSettings(s);
      if (s.currency === "TOMAN" || s.currency === "RIAL") {
        setCurrencyState(s.currency);
      }
      if (isThemeId(s.theme)) {
        setThemeState(s.theme);
      }
    } catch {
      /* server may not be up yet */
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  // Apply the theme on <html> and mirror it to localStorage for the next load.
  useEffect(() => {
    applyThemeToDom(theme);
    storeTheme(theme);
  }, [theme]);

  const setTheme = useCallback((t: ThemeId) => setThemeState(t), []);

  const value = useMemo<SettingsCtx>(
    () => ({
      currency,
      theme,
      settings,
      refresh,
      setCurrency: (c) => setCurrencyState(c),
      setTheme,
    }),
    [currency, theme, settings, setTheme]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
