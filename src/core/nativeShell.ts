import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "./host";

/**
 * Making the webview stop behaving like a browser.
 *
 * Tauri renders through a system webview — so do VS Code, Slack, Discord and
 * every Electron app people happily call "real programs". What actually gives
 * the game away is not the renderer, it is the browser affordances nobody
 * turned off: a right-click menu offering "Reload", Ctrl+F opening a find bar
 * over your chat, Ctrl+scroll zooming the entire interface, F5 wiping your
 * session, and a stray drag dropping a file into the view as a navigation.
 *
 * Every one of those is removed here. What remains is the behaviour people
 * expect from an application window.
 */
export function installNativeShell(): () => void {
  if (!isTauri()) return () => {};

  const disposers: Array<() => void> = [];
  const on = <K extends keyof WindowEventMap>(
    type: K,
    handler: (e: WindowEventMap[K]) => void,
    opts?: AddEventListenerOptions,
  ) => {
    window.addEventListener(type, handler as EventListener, opts);
    disposers.push(() => window.removeEventListener(type, handler as EventListener, opts));
  };

  // No browser context menu. Application context menus are drawn by the app
  // itself where they mean something, not offered globally over every pixel.
  on("contextmenu", (e) => {
    const target = e.target as HTMLElement | null;
    const editable =
      target?.tagName === "INPUT" ||
      target?.tagName === "TEXTAREA" ||
      target?.isContentEditable;
    // Text fields keep theirs — cut/copy/paste is the one case where the
    // system menu is genuinely the right answer.
    if (!editable) e.preventDefault();
  });

  on("keydown", (e) => {
    const key = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;

    // Page-level shortcuts that have no meaning in an application and are
    // actively destructive here: reload throws away the conversation.
    const browserOnly =
      e.key === "F5" ||
      e.key === "F3" ||
      (mod && ["r", "f", "p", "u", "g", "j"].includes(key)) ||
      (mod && e.shiftKey && ["r", "i", "c", "j"].includes(key)) ||
      (e.key === "F12");

    // Zooming the whole interface is a page gesture. Text size belongs in
    // Settings, where it can scale the layout with it.
    const zoom = mod && ["+", "-", "=", "0"].includes(key);

    if (browserOnly || zoom) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, { capture: true });

  // Ctrl+wheel zoom, and rubber-band overscroll on the window itself.
  on("wheel", (e) => {
    if (e.ctrlKey) e.preventDefault();
  }, { passive: false, capture: true });

  // A file dropped anywhere outside a drop zone must not navigate the view.
  on("dragover", (e) => e.preventDefault());
  on("drop", (e) => e.preventDefault());

  // Middle-click paste-and-go, back/forward mouse buttons.
  on("auxclick", (e) => e.preventDefault());

  // A link in a reply, a model card or a help text opens in the user's own
  // browser. Left to the webview, target=_blank either did nothing or opened
  // a bare, chromeless window that looked like part of Conduit.
  on(
    "click",
    (e) => {
      const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      if (!/^(https?:|mailto:)/i.test(href)) return;
      e.preventDefault();
      void invoke("open_target", { target: href }).catch(() => undefined);
    },
    { capture: true },
  );

  return () => disposers.forEach((d) => d());
}

/**
 * Reveals the window only once the interface has actually painted.
 *
 * The window is created hidden. Showing it before first paint is what produces
 * the white flash that reads as "a page is loading" — the single most
 * webview-looking moment in an app's life.
 */
export async function revealWindow(): Promise<void> {
  if (!isTauri()) return;
  try {
    const win = getCurrentWindow();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    await win.show();
    await win.setFocus();
  } catch {
    // A hidden window that refuses to show is worth knowing about, but not
    // worth blocking startup over.
  }
}
