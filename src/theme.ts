/** Ensures dark theme is applied (matches `data-theme` on `<html>` in index.html). */
export function applyInitialTheme(): void {
  document.documentElement.dataset.theme = "dark";
}
