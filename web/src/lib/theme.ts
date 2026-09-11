/**
 * Theme system (3 themes) for the web app.
 *
 * The chosen theme is:
 *  - applied to <html data-theme="…"> + color-scheme (CSS override layer lives in index.css),
 *  - mirrored to localStorage so the inline bootstrap in index.html can apply it
 *    before first paint (no white flash for dark-theme users),
 *  - persisted server-side under the existing `theme` settings key.
 */

export type ThemeId = "light" | "dark" | "midnight";

export const THEME_STORAGE_KEY = "soodyar.theme";

export interface ThemeOption {
  id: ThemeId;
  /** Persian label shown in the settings picker. */
  label: string;
  /** Short Persian hint under the label. */
  hint: string;
  /** Preview swatches: [page background, card surface, accent]. */
  swatch: [string, string, string];
}

export const THEME_OPTIONS: ThemeOption[] = [
  {
    id: "light",
    label: "روشن (فعلی)",
    hint: "ظاهر پیش‌فرض روشن",
    swatch: ["#f8fafc", "#ffffff", "#226b47"],
  },
  {
    id: "dark",
    label: "تیره",
    hint: "پس‌زمینه سرمه‌ای تیره",
    swatch: ["#0f172a", "#1e293b", "#4fa172"],
  },
  {
    id: "midnight",
    label: "شبانه (تیره‌تر)",
    hint: "مشکی‌تر با کنتراست بیشتر",
    swatch: ["#0b0f14", "#11161d", "#4fa172"],
  },
];

export const DEFAULT_THEME: ThemeId = "light";

export function isThemeId(value: unknown): value is ThemeId {
  return value === "light" || value === "dark" || value === "midnight";
}

/** Read the theme mirrored to localStorage; falls back to light (current look). */
export function readStoredTheme(): ThemeId {
  try {
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemeId(raw)) return raw;
  } catch {
    /* localStorage may be unavailable (private mode); fall through */
  }
  return DEFAULT_THEME;
}

/** Page background per theme; also used by the inline bootstrap in index.html. */
const PAGE_BG: Record<ThemeId, string> = {
  light: "",
  dark: "#0f172a",
  midnight: "#0b0f14",
};

/** Apply the theme to <html>: data-theme attribute + native color-scheme. */
export function applyThemeToDom(theme: ThemeId): void {
  const root = document.documentElement;
  if (theme === "light") {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = theme;
  }
  root.style.colorScheme = theme === "light" ? "light" : "dark";
  // Keep the inline background in sync with the bootstrap so overscroll areas
  // never flash the light page colour; clearing it lets the stylesheet win.
  root.style.backgroundColor = PAGE_BG[theme];
}

/** Mirror the theme to localStorage so the next load paints without a flash. */
export function storeTheme(theme: ThemeId): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* ignore quota / private-mode errors */
  }
}
