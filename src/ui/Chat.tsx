import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { sendMessage } from "@/core/chat";
import { activeConversation, useApp } from "@/core/store";
import { Composer } from "./Composer";
import { Logo } from "./Logo";
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

function Welcome() {
  return (
    <motion.div className="welcome" {...riseIn} transition={SPRING}>
      <motion.span
        className="welcome__mark"
        initial={{ scale: 0.86, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", bounce: 0.22, duration: 0.6 }}
      >
        <Logo size={30} />
      </motion.span>
      <h1 className="welcome__title">What should we do?</h1>
      <p className="welcome__sub">
        Type, or hold the hotkey and speak. Conduit can read files, run commands,
        and, once you allow it, see and operate the screen.
      </p>

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
    </motion.div>
  );
}
