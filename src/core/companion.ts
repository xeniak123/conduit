import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { activityForTool, type Activity } from "@/companion";
import { getSettings, type CompanionSettings } from "./config";
import { isTauri } from "./host";
import { useApp } from "./store";

/**
 * Keeping the companion in step with the agent.
 *
 * The companion is a separate OS window, which means a separate web view with
 * its own copy of every module and its own empty store. Nothing the main
 * window does reaches it unless it is sent — and that is precisely what the
 * old overlay got wrong: it read `phase` from a store nobody in that window
 * ever wrote to, so it displayed the initial value for ever. On screen that
 * was a black bar reading READY while Conduit was listening, thinking and
 * running commands a few pixels away.
 *
 * So state is broadcast. One message, on change, carrying everything the
 * companion draws — including the relevant settings, so changing the pet in
 * Settings updates the thing on screen immediately rather than at next launch.
 */

export interface CompanionState {
  activity: Activity;
  /** The last thing said, or heard. */
  caption: string;
  /** What is happening right now, in a few words. */
  detail: string;
  /** Rises when the agent takes the pointer: the bead sheds the cursor. */
  emitCursor: number;
  settings: CompanionSettings;
}

export const COMPANION_STATE = "conduit://companion-state";

/** Derives what the companion should be doing from what the app is doing. */
export function currentActivity(): Activity {
  const state = useApp.getState();
  if (state.phase === "listening") return "listening";
  if (state.screenActive) return "screen";
  if (state.abort) {
    const lastTool = state.steps.filter((s) => s.kind === "tool").at(-1);
    if (lastTool?.tool) return activityForTool(lastTool.tool);
    return state.phase === "thinking" ? "thinking" : "working";
  }
  if (state.phase === "thinking") return "thinking";
  if (state.phase === "working") return "working";
  if (state.phase === "error") return "error";
  if (state.phase === "done") return "done";
  return "idle";
}

function detailFor(): string {
  const state = useApp.getState();
  const step = state.steps.at(-1);
  if (state.phase === "listening") return "Listening";
  if (step?.kind === "tool") return step.text;
  return "";
}

let lastSent = "";
let sendTimer: number | null = null;

/** Broadcasts the current state, at most every frame or two. */
function broadcast(force = false): void {
  if (!isTauri()) return;

  const payload: CompanionState = {
    activity: currentActivity(),
    caption: useApp.getState().caption,
    detail: detailFor(),
    emitCursor: cursorPulse,
    settings: getSettings().companion,
  };

  const signature = JSON.stringify(payload);
  if (!force && signature === lastSent) return;
  lastSent = signature;

  if (sendTimer !== null) return;
  sendTimer = window.setTimeout(() => {
    sendTimer = null;
    void emit(COMPANION_STATE, payload).catch(() => undefined);
  }, 60);
}

let cursorPulse = 0;

/** Called when the agent takes the pointer, so the bead can shed a droplet. */
export function pulseCursorBirth(): void {
  cursorPulse = Date.now();
  broadcast(true);
}

let visible = false;
let appearTimer: number | null = null;

async function apply(next: boolean): Promise<void> {
  if (next === visible) return;
  visible = next;
  await invoke("set_companion", { visible: next }).catch(() => undefined);
  if (!next) return;

  // State first, then the cue to animate: the entrance should form around the
  // right shape rather than growing as a droplet and then becoming a caption.
  broadcast(true);
  await emit("conduit://companion-appear", { at: Date.now() }).catch(() => undefined);
}

/**
 * Decides whether the companion should be on screen.
 *
 * Two rules, and the order matters. Work always wins: if Conduit is listening
 * or acting, the companion appears at once, because that is the only signal
 * the user has that something is happening off-window. Otherwise it waits —
 * a bead that materialises the instant a window minimises reads as a thing
 * that followed you out of the room, and people find that unpleasant. A few
 * seconds later it reads as company.
 */
let petVisible: boolean | null = null;

/** The desktop pet: on screen always, or only while the window is away. */
function evaluatePet(windowAway: boolean): void {
  const settings = getSettings().companion;
  const wanted =
    (settings.mode === "pet" || settings.mode === "both") && (settings.petWhen === "always" || windowAway);
  if (wanted === petVisible) return;
  petVisible = wanted;
  void invoke("set_pet", { visible: wanted }).catch(() => undefined);
  if (wanted) broadcast(true);
}

function evaluate(windowAway: boolean): void {
  evaluatePet(windowAway);
  const settings = getSettings().companion;
  const busy = currentActivity() !== "idle";

  // The bead follows the cursor only in the modes that include it; the pet
  // has its own window and its own rules above.
  if (settings.mode === "off" || settings.mode === "pet") {
    if (appearTimer !== null) {
      window.clearTimeout(appearTimer);
      appearTimer = null;
    }
    void apply(false);
    return;
  }

  const wanted = windowAway || (busy && settings.alwaysDuringWork);

  if (!wanted) {
    if (appearTimer !== null) {
      window.clearTimeout(appearTimer);
      appearTimer = null;
    }
    void apply(false);
    return;
  }

  if (visible) return;

  // Busy is urgent; merely being away is not.
  if (busy) {
    if (appearTimer !== null) {
      window.clearTimeout(appearTimer);
      appearTimer = null;
    }
    void apply(true);
    return;
  }

  if (appearTimer === null) {
    appearTimer = window.setTimeout(() => {
      appearTimer = null;
      void apply(true);
    }, Math.max(0, settings.delay));
  }
}

/**
 * Starts the bridge. Runs in the main window only — it is the one that has the
 * agent, the microphone and the settings.
 */
export async function startCompanionBridge(): Promise<() => void> {
  if (!isTauri()) return () => undefined;

  const win = getCurrentWindow();
  let away = false;

  const sync = async () => {
    const shown = await win.isVisible().catch(() => true);
    const minimised = await win.isMinimized().catch(() => false);
    away = !shown || minimised;
    evaluate(away);
  };

  const unsubscribe = useApp.subscribe(() => {
    broadcast();
    evaluate(away);
  });

  const offs = await Promise.all([
    win.onFocusChanged(() => void sync()),
    listen("conduit://window-hidden", () => void sync()),
    // The companion window asks for this when it first paints, so a reload of
    // that web view does not leave it holding stale state until something
    // else happens to change.
    listen("conduit://companion-hello", () => broadcast(true)),
  ]);

  // A minimise raises no event on every platform, so a slow poll backs it up.
  const poll = window.setInterval(() => void sync(), 1200);
  await sync();

  return () => {
    unsubscribe();
    offs.forEach((off) => off());
    window.clearInterval(poll);
    if (appearTimer !== null) window.clearTimeout(appearTimer);
    if (sendTimer !== null) window.clearTimeout(sendTimer);
    void invoke("set_companion", { visible: false }).catch(() => undefined);
  };
}
