const STORAGE_KEY = "theme";

export type Theme = "light" | "dark";

export function getStoredTheme(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* ignore */
  }
  return null;
}

/** Before first React paint — prefers saved theme, else defaults to dark. */
export function applyInitialTheme(): void {
  const root = document.documentElement;
  const stored = getStoredTheme();
  root.dataset.theme = stored ?? "dark";
}

export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
}

export function readThemeFromDom(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}
