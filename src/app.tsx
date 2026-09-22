import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { hideCursor, setComputerUseEnabled } from "@/computer";
import { initAudit } from "@/core/audit";
import { getSettings, initSettings } from "@/core/config";
import { flush, loadConversations, persistConversations } from "@/core/history";
import { refreshKeyStatus } from "@/core/secrets";
import { isTauri } from "@/core/host";
import { installNativeShell, revealWindow } from "@/core/nativeShell";
import { applyTheme } from "@/core/theme";
import { startCompanionBridge } from "@/core/companion";
import { syncServers } from "@/mcp";
import { loadSkills } from "@/skills";
import { startLocalStt } from "@/stt/local";
import { keepApiInSync } from "@/api/server";
import { detectHardware, loadLibrary } from "@/models/runtime";
import { loadCompanions } from "@/companion";
import { startPipeline } from "@/core/pipeline";
import { startScheduler } from "@/core/schedule";
import { keepAccountInSync } from "@/core/account";
import { keepCheckingForUpdates } from "@/core/updates";
import { useApp } from "@/core/store";
import { Companion } from "@/ui/Companion";
import { Cursor } from "@/ui/Cursor";
import { Pet } from "@/ui/Pet";
import { Quick } from "@/ui/Quick";
import { Shell } from "@/ui/Shell";

/**
 * Four windows share one bundle, chosen by hash.
 *
 * The companion and the cursor marker are separate OS windows rather than
 * elements inside the main one, because both have to render over other
 * applications without stealing focus from them.
 */
export default function App() {
  const route = window.location.hash;
  const isCursor = route === "#/cursor";
  const isQuick = route === "#/quick";
  const isCompanion = route === "#/companion";
  const isPet = route === "#/pet";
  // Quick capture needs settings and providers, but not the hotkey pipeline —
  // running that twice would start two recordings on every keypress.
  const isOverlay = isCursor || isCompanion || isPet;

  const setSettings = useApp((s) => s.setSettings);
  const setLevel = useApp((s) => s.setLevel);
  const ensureConversation = useApp((s) => s.ensureConversation);
  const [ready, setReady] = useState(false);
  const [startupProblems, setStartupProblems] = useState<string[]>([]);

  useEffect(() => {
    if (isOverlay || isQuick) document.body.classList.add("overlay-window");
  }, [isOverlay, isQuick]);

  // Strip the browser affordances before the first frame, so a right-click or
  // a stray Ctrl+F never behaves like a web page even once.
  useEffect(() => installNativeShell(), []);

  useEffect(() => {
    if (!isTauri()) return;
    const stop = listen<number>("conduit://level", (e) => setLevel(e.payload));
    return () => void stop.then((off) => off());
  }, [setLevel]);

  useEffect(() => {
    let disposePipeline: (() => void) | undefined;
    let disposeCompanion: (() => void) | undefined;
    let disposeApi: (() => void) | undefined;
    let disposeScreen: (() => void) | undefined;
    let disposeScheduler: (() => void) | undefined;
    let disposeAccount: (() => void) | undefined;
    let disposeUpdates: (() => void) | undefined;

    /**
     * Startup, step by step, with each step allowed to fail alone.
     *
     * The original version awaited everything in one chain, so a single
     * rejection — two windows opening the same settings file at once, a
     * keychain prompt being dismissed — skipped `setReady` entirely and left
     * the window rendering nothing at all. An empty frame is the worst
     * possible failure mode, because it looks like the app is broken rather
     * than like one feature is unavailable.
     */
    const step = async (what: string, run: () => Promise<void>) => {
      try {
        await run();
      } catch (e) {
        console.error(`[conduit] ${what} failed`, e);
        problems.push(what);
      }
    };

    const problems: string[] = [];

    void (async () => {
      if (!isTauri()) {
        // Browser preview: render the interface with defaults and no backend.
        ensureConversation();
        setReady(true);
        return;
      }

      await step("loading settings", async () => {
        const settings = await initSettings();
        setSettings(settings);
        applyTheme(settings.appearance.theme);
        document.documentElement.dataset.density = settings.appearance.density;
      });

      // Quick capture asks a model, so it needs to know which keys exist — but
      // not the hotkey pipeline, which would start a second recording on every
      // press, nor the history, which it never shows.
      if (!isOverlay) {
        await step("checking saved keys", async () => {
          await refreshKeyStatus(["anthropic", "openai", "openrouter", "google", "groq"]);
        });
      }

      if (!isOverlay && !isQuick) {
        await step("registering tools", async () => {
          // A marker left over from a run that never finished is hidden at start.
          void hideCursor();
          let screenOn = getSettings().computerUse.enabled;
          setComputerUseEnabled(screenOn);
          // The Screen switch lives in the message box now, so the tools have
          // to follow it live. Registering them only at startup meant turning
          // it on did nothing until the next launch.
          disposeScreen = useApp.subscribe((state) => {
            const on = state.settings.computerUse.enabled;
            if (on === screenOn) return;
            screenOn = on;
            setComputerUseEnabled(on);
          });
        });
        await step("opening the audit log", () => initAudit());
        await step("loading history", async () => {
          const saved = await loadConversations();
          if (saved.length) useApp.getState().hydrate(saved);
        });
        await step("binding hotkeys", async () => {
          disposePipeline = await startPipeline();
        });
        await step("loading companions", async () => {
          await loadCompanions(true);
        });
        await step("loading skills", async () => {
          await loadSkills();
        });
        // Servers and the local speech runtime both start processes, which is
        // slow and must not hold up a window the user is waiting to see. They
        // are kicked off and left to report themselves in Settings.
        void syncServers().catch((e) => console.error("[conduit] MCP", e));
        void startLocalStt().catch((e) => console.error("[conduit] local speech", e));
        void loadLibrary();
        void detectHardware().catch(() => undefined);
        disposeApi = keepApiInSync();
        disposeScheduler = startScheduler();
        disposeAccount = keepAccountInSync();
        disposeUpdates = keepCheckingForUpdates();
        await step("starting the companion", async () => {
          disposeCompanion = await startCompanionBridge();
        });
        ensureConversation();
      }

      if (problems.length) setStartupProblems(problems);
      setReady(true);

      // Painted, then shown — the window never flashes white.
      if (!isOverlay && !isQuick) void revealWindow();
    })();

    return () => {
      disposePipeline?.();
      disposeCompanion?.();
      disposeApi?.();
      disposeScreen?.();
      disposeScheduler?.();
      disposeAccount?.();
      disposeUpdates?.();
    };
  }, [isOverlay, isQuick, setSettings, ensureConversation]);

  // History is written on a debounce as the conversation grows, and forced out
  // when the window goes away — a debounce alone would lose the last exchange.
  useEffect(() => {
    if (isOverlay || isQuick || !ready) return;
    let previous = useApp.getState().conversations;
    const unsubscribe = useApp.subscribe((state) => {
      if (state.conversations === previous) return;
      previous = state.conversations;
      persistConversations(state.conversations);
    });
    const onHide = () => void flush();
    window.addEventListener("beforeunload", onHide);
    return () => {
      unsubscribe();
      window.removeEventListener("beforeunload", onHide);
      void flush();
    };
  }, [isOverlay, isQuick, ready]);

  if (isCursor) return <Cursor />;
  if (isCompanion) return <Companion />;
  if (isPet) return <Pet />;
  if (isQuick) return <Quick />;
  if (!ready) return null;
  return (
    <>
      <Shell />
      {startupProblems.length > 0 && (
        <StartupWarning problems={startupProblems} onDismiss={() => setStartupProblems([])} />
      )}
    </>
  );
}


/**
 * Says which part of startup did not come up.
 *
 * Silent degradation is how people end up believing a feature is broken when
 * it simply never initialised — naming the step, once, turns a mystery into
 * something reportable.
 */
function StartupWarning({
  problems,
  onDismiss,
}: {
  problems: string[];
  onDismiss: () => void;
}) {
  return (
    <div className="startup-warning" role="status">
      <div>
        <b>Some things did not start.</b> {problems.join(", ")}. The rest of Conduit works;
        restarting usually clears it.
      </div>
      <button className="btn" onPointerDown={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}
