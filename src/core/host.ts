/**
 * Is there a Tauri runtime under us?
 *
 * `npm run dev` serves the interface in a plain browser, with no native host.
 * Without this guard every window call throws on mount and the app renders a
 * white page — which is exactly what happens if you launch the debug binary
 * with no dev server behind it. Degrading instead of exploding means the UI is
 * always inspectable, and a missing backend shows up as disabled controls
 * rather than a blank window.
 */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Runs `fn` only under the native host; otherwise resolves to `fallback`. */
export async function native<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  if (!isTauri()) return fallback;
  try {
    return await fn();
  } catch {
    return fallback;
  }
}
