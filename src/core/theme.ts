/** Resolves "system" to the OS preference, and follows it if it changes. */
export function applyTheme(theme: "light" | "dark" | "system"): void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const set = () => {
    document.documentElement.dataset.theme = theme === "system" ? (media.matches ? "dark" : "light") : theme;
  };
  set();
  media.onchange = theme === "system" ? set : null;
}
