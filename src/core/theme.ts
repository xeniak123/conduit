const CACHE = "conduit.theme";

type Theme = "light" | "dark" | "system";

/** Resolves "system" to the OS preference, and follows it if it changes. */
export function applyTheme(theme: Theme): void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const set = () => {
    document.documentElement.dataset.theme = theme === "system" ? (media.matches ? "dark" : "light") : theme;
  };
  set();
  media.onchange = theme === "system" ? set : null;
  try {
    localStorage.setItem(CACHE, theme);
  } catch {
    /* the next start just resolves it a moment later */
  }
}

/**
 * The theme from the last run, applied before settings have loaded.
 *
 * Settings come from disk through the native layer, which takes long enough
 * that a dark-theme user saw the light interface flash first on every start.
 */
export function applyCachedTheme(): void {
  let theme: Theme = "system";
  try {
    const saved = localStorage.getItem(CACHE);
    if (saved === "light" || saved === "dark" || saved === "system") theme = saved;
  } catch {
    /* no cache: follow the system */
  }
  applyTheme(theme);
}
