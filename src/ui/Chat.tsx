import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { sendMessage } from "@/core/chat";
import { activeConversation, useApp } from "@/core/store";
import { Composer } from "./Composer";
import { contenders } from "@/core/arena";
import { saveSettings } from "@/core/config";
import { nextRun, relative } from "@/core/schedule";
import { BrandMark, brandForModel } from "./Brand";
import { Icon } from "./icons";
import { Message } from "./Message";
import { SPRING, riseIn } from "./motion";

const SUGGESTIONS = [
  { title: "Open a project", body: "Make a folder in Documents called demo and start a Claude Code session in it" },
  { title: "Fix what I wrote", body: "Hold the dictation hotkey and talk. It lands as clean text." },
  { title: "Drive the screen", body: "Turn on Screen, then: open the browser and search for the Tauri docs" },
  { title: "Check the machine", body: "What is running on port 3000, and can you stop it?" },
];

export function Chat() {
  const conversation = useApp(activeConversation);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const messages = conversation?.messages ?? [];
  const lastId = messages[messages.length - 1]?.id;
  const lastLength = messages[messages.length - 1]?.text.length ?? 0;

  /**
   * Follows the conversation as it grows — but only if the reader is already
   * at the bottom.
   *
   * Scrolling unconditionally meant that scrolling up to re-read something
   * during a streamed reply pulled you back down on the very next fragment.
   * The jump is also instant rather than smooth: a smooth scroll restarted
   * every few milliseconds never arrives anywhere.
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !pinnedRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [lastId, lastLength, messages.length]);

  // "Near the bottom" rather than exactly at it: sub-pixel rounding and the
  // scroll-edge mask mean an exact comparison is false more often than not.
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  return (
    <>
      <div className="transcript" ref={scrollRef} onScroll={onScroll}>
        {messages.length === 0 ? (
          <Welcome />
        ) : (
          <div className="column">
            <AnimatePresence initial={false}>
              {messages.map((message) => (
                <Message key={message.id} message={message} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      <Composer />
    </>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * The first screen of a new chat: yours, not a brochure. Where you left off,
 * the projects you work in, what is scheduled next, and the models one click
 * away. Examples only appear while there is nothing of yours to show.
 */
function Welcome() {
  const settings = useApp((s) => s.settings);
  const conversations = useApp((s) => s.conversations);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState(settings.userName);

  const recent = conversations.filter((c) => c.messages.length > 0 && !c.scheduleId).slice(0, 3);
  const projects = settings.projects.slice(0, 3);
  const upcoming = (settings.schedules ?? [])
    .map((t) => ({ task: t, at: nextRun(t) }))
    .filter((x) => x.at)
    .sort((a, b) => a.at!.getTime() - b.at!.getTime())
    .slice(0, 2);
  const models = contenders(settings).slice(0, 5);
  const fresh = recent.length === 0 && projects.length === 0;

  const saveName = () => {
    const next = { ...settings, userName: name.trim() };
    useApp.getState().setSettings(next);
    void saveSettings(next);
    setNaming(false);
  };

  const pick = (provider: string, model: string) => {
    const next = { ...settings, command: { provider, model }, router: { ...settings.router, enabled: false } };
    useApp.getState().setSettings(next);
    void saveSettings(next);
  };

  return (
    <motion.div className="welcome welcome--home" {...riseIn} transition={SPRING}>
      <h1 className="welcome__title">
        {greeting()}
        {settings.userName ? `, ${settings.userName}` : ""}
      </h1>
      {naming ? (
        <div className="welcome__name">
          <input
            className="input"
            autoFocus
            placeholder="Your name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveName()}
          />
          <button className="btn btn--ink btn--small" onPointerDown={saveName}>
            Save
          </button>
        </div>
      ) : (
        <p className="welcome__sub">
          What should we do?{" "}
          {!settings.userName && (
            <button className="linkbtn" onPointerDown={() => setNaming(true)}>
              What should I call you?
            </button>
          )}
        </p>
      )}

      {models.length > 1 && (
        <div className="welcome__models">
          {models.map((m) => {
            const on = !settings.router?.enabled && settings.command.provider === m.provider && settings.command.model === m.model;
            return (
              <button key={`${m.provider}:${m.model}`} className="welcome__model" aria-pressed={on} onPointerDown={() => pick(m.provider, m.model)}>
                <BrandMark brand={brandForModel(m.model, m.provider)} size={18} fallback={m.model} />
                {m.model.split("/").pop()}
              </button>
            );
          })}
        </div>
      )}

      {fresh ? (
        <div className="suggestions">
          {SUGGESTIONS.map((s) => (
            <motion.button
              key={s.title}
              className="suggestion"
              whileTap={{ scale: 0.985 }}
              transition={SPRING}
              onPointerDown={() => void sendMessage(s.body)}
            >
              <b>{s.title}</b>
              {s.body}
            </motion.button>
          ))}
        </div>
      ) : (
        <div className="home">
          {recent.length > 0 && (
            <section className="home__col">
              <h3>Continue</h3>
              {recent.map((c) => (
                <button key={c.id} className="home__item" onPointerDown={() => useApp.getState().selectConversation(c.id)}>
                  <Icon.compose />
                  <span>
                    <b>{c.title}</b>
                    <em>{ago(c.at)}</em>
                  </span>
                </button>
              ))}
            </section>
          )}
          {projects.length > 0 && (
            <section className="home__col">
              <h3>Projects</h3>
              {projects.map((p) => (
                <button
                  key={p.id}
                  className="home__item"
                  onPointerDown={() => {
                    const next = { ...settings, activeProjectId: p.id };
                    useApp.getState().setSettings(next);
                    void saveSettings(next);
                    useApp.getState().newConversation(p.id);
                  }}
                >
                  <span className="home__swatch" style={{ background: p.colour }} />
                  <span>
                    <b>{p.name}</b>
                    <em>New chat in this project</em>
                  </span>
                </button>
              ))}
            </section>
          )}
          <section className="home__col">
            <h3>Scheduled</h3>
            {upcoming.length ? (
              upcoming.map(({ task, at }) => (
                <button key={task.id} className="home__item" onPointerDown={() => useApp.getState().setPage("scheduled")}>
                  <Icon.clock />
                  <span>
                    <b>{task.name}</b>
                    <em>{relative(at)}</em>
                  </span>
                </button>
              ))
            ) : (
              <button className="home__item home__item--add" onPointerDown={() => useApp.getState().setPage("scheduled")}>
                <Icon.plus />
                <span>
                  <b>A morning briefing</b>
                  <em>News that matters to you, every weekday</em>
                </span>
              </button>
            )}
          </section>
        </div>
      )}
    </motion.div>
  );
}

function ago(at: number): string {
  const min = Math.round((Date.now() - at) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
