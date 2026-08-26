import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "../lib/api";
import type { Currency } from "../lib/format";

interface SettingsCtx {
  currency: Currency;
  settings: Record<string, string>;
  refresh: () => Promise<void>;
  setCurrency: (c: Currency) => void;
}

const Ctx = createContext<SettingsCtx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [currency, setCurrencyState] = useState<Currency>("RIAL");

  async function refresh() {
    try {
      const s = await api.settings();
      setSettings(s);
      if (s.currency === "TOMAN" || s.currency === "RIAL") {
        setCurrencyState(s.currency);
      }
    } catch {
      /* server may not be up yet */
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const value = useMemo<SettingsCtx>(
    () => ({
      currency,
      settings,
      refresh,
      setCurrency: (c) => setCurrencyState(c),
    }),
    [currency, settings]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
