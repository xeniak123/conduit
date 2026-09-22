import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { AnimatePresence, motion } from "motion/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@/core/host";
import { stopRun } from "@/core/chat";
import { exportConversation } from "@/core/export";
import { activeConversation, useApp } from "@/core/store";
import { ApprovalSheet } from "./ApprovalSheet";
import { GrantSheet } from "./GrantSheet";
import { CommandPalette } from "./CommandPalette";
import { Onboarding, useFirstRun } from "./Onboarding";
import { Chat } from "./Chat";
import { ApiPage } from "./ApiPage";
import { CompanionPage } from "./CompanionPage";
import { ModelHub } from "./ModelHub";
import { ModelSwitch } from "./ModelSwitch";
import { ProjectsPage } from "./ProjectsPage";
import { ScheduledPage } from "./ScheduledPage";
import { AgentsPage } from "./AgentsPage";
import { DecidePage } from "./DecidePage";
import { ArenaPage } from "./ArenaPage";
import { StorePage } from "./StorePage";
import { Settings } from "./Settings";
import { Sidebar } from "./Sidebar";
import { UpdateBanner } from "./UpdateBanner";
import { Icon } from "./icons";
import { SPRING } from "./motion";

export function Shell() {
  const conversation = useApp(activeConversation);
  const screenActive = useApp((s) => s.screenActive);
  const busy = useApp((s) => s.abort !== null);
  const win = isTauri() ? getCurrentWindow() : null;
  useFirstRun();
  const openSettings = useApp((s) => s.setSettingsOpen);
  const page = useApp((s) => s.page);

  // The tray can open Settings without the window already being up.
  useEffect(() => {
    if (!isTauri()) return;
    const stop = listen("conduit://open-settings", () => openSettings(true));
    return () => void stop.then((off) => off());
  }, [openSettings]);

  // Escape is the universal brake. While the agent is driving the pointer, a
  // person's instinct is to hit Escape — so that has to be the thing that
  // actually stops it, not a button they must first find with a hijacked mouse.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && busy) stopRun();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy]);

  return (
    <div className="app">
      <Sidebar />

      <div className="stage">
        <header
          className="topbar"
          data-tauri-drag-region
          onDoubleClick={() => void win?.toggleMaximize()}
        >
          {page === "chat" && <ModelSwitch />}
          <span className="spacer" />
          {page === "chat" && conversation && conversation.messages.length > 0 && (
            <button
              className="iconbtn"
              title="Export this conversation as Markdown"
              aria-label="Export conversation"
              onPointerDown={() => exportConversation(conversation)}
            >
              <Icon.download />
            </button>
          )}
          <button
            className="topbar__hint"
            onPointerDown={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))}
          >
            <Icon.search />
            Search
            <span className="kbd kbd--dim">Ctrl K</span>
          </button>
          <button className="winctl" onPointerDown={() => void win?.minimize()} aria-label="Minimise">
            <Icon.minimise />
          </button>
          <button
            className="winctl"
            onPointerDown={() => void win?.toggleMaximize()}
            aria-label="Maximise"
          >
            <Icon.maximise />
          </button>
          {/* Closing hides the window; the agent lives on in the tray. */}
          <button
            className="winctl winctl--close"
            onPointerDown={() => void win?.hide()}
            aria-label="Close"
          >
            <Icon.close />
          </button>
        </header>

        <AnimatePresence>
          {screenActive && (
            <motion.div
              className="livebar"
              initial={{ opacity: 0, y: -12, x: "-50%", filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, x: "-50%", filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -10, x: "-50%", filter: "blur(6px)" }}
              transition={SPRING}
            >
              <span className="livebar__pulse" />
              Conduit is controlling your screen
              <button className="livebar__stop" onPointerDown={stopRun}>
                Stop
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait" initial={false}>
          <motion.main
            key={page}
            className="view"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
          >
            {page === "chat" && <Chat />}
            {page === "models" && <ModelHub />}
            {page === "store" && <StorePage />}
            {page === "projects" && <ProjectsPage />}
            {page === "companion" && <CompanionPage />}
            {page === "api" && <ApiPage />}
            {page === "scheduled" && <ScheduledPage />}
            {page === "agents" && <AgentsPage />}
            {page === "decide" && <DecidePage />}
            {page === "arena" && <ArenaPage />}
          </motion.main>
        </AnimatePresence>

      </div>

      <CommandPalette />
      <Onboarding />
      <Settings />
      <UpdateBanner />
      <ApprovalSheet />
      <GrantSheet />
    </div>
  );
}
