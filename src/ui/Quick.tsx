import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getSettings } from "@/core/config";
import { isTauri } from "@/core/host";
import { BUILTIN_PROMPTS, matchPrompts, variablesIn } from "@/core/prompts";
import { getProvider } from "@/llm";
import { costOf, record as recordUsage } from "@/core/usage";
import { Icon } from "./icons";
import { Logo } from "./Logo";
import { Markdown } from "./Markdown";
import { SPRING, SPRING_SNAP } from "./motion";

/**
 * Quick capture — `Ctrl+Alt+K` from anywhere.
 *
 * The main window is where you have a conversation. This is for the other
 * ninety percent of the time, when you have one question and do not want to
 * change what you are looking at: a single field over whatever is on screen,
 * an answer underneath it, and Escape to make it all go away.
 *
 * It deliberately does not run tools. A floating box that can quietly delete a
 * file is the wrong shape — anything that acts belongs in the main window
 * where the whole run is visible. Press Enter with Shift to send it there
 * instead.
 */
export function Quick() {
  const [value, setValue] = useState("");
  const [answer, setAnswer] = useState("");
  const [state, setState] = useState<"idle" | "thinking" | "answered" | "failed">("idle");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const slashQuery = /^\/[a-z0-9-]*$/i.test(value) ? value.slice(1) : null;
  const prompts = slashQuery !== null ? matchPrompts(BUILTIN_PROMPTS, slashQuery).slice(0, 5) : [];

  // Reset every time it is summoned: this is a scratch surface, and finding
  // yesterday's question still sitting in it would be worse than useless.
  useEffect(() => {
    if (!isTauri()) return;
    const stop = listen("conduit://quick-open", () => {
      setValue("");
      setAnswer("");
      setState("idle");
      window.setTimeout(() => inputRef.current?.focus(), 40);
    });
    return () => void stop.then((off) => off());
  }, []);

  // The window grows to fit rather than scrolling inside a fixed frame.
  useEffect(() => {
    if (!isTauri()) return;
    const height = (shellRef.current?.offsetHeight ?? 80) + 28;
    void invoke("resize_quick", { height }).catch(() => undefined);
  }, [answer, state, prompts.length]);

  const close = () => {
    abortRef.current?.abort();
    void invoke("hide_quick").catch(() => undefined);
  };

  const ask = async (text: string) => {
    const question = text.trim();
    if (!question) return;

    setState("thinking");
    setAnswer("");
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const settings = getSettings();
      const provider = getProvider(settings.command.provider, settings);
      const request = {
        model: settings.command.model,
        system: SYSTEM,
        messages: [{ role: "user" as const, text: question }],
        maxTokens: 1024,
        signal: controller.signal,
      };

      const result = provider.completeStream
        ? await provider.completeStream(request, (delta) => setAnswer((a) => a + delta))
        : await provider.complete(request);

      if (!provider.completeStream) setAnswer(result.text);

      // Quick asks cost money like any other call; leaving them out of the
      // ledger would make the usage page quietly wrong.
      if (result.usage) {
        recordUsage({
          at: Date.now(),
          model: settings.command.model,
          input: result.usage.input,
          output: result.usage.output,
          cost: costOf(settings.command.model, result.usage.input, result.usage.output, settings.command.provider),
        });
      }
      setState("answered");
    } catch (e) {
      setAnswer(e instanceof Error ? e.message : String(e));
      setState("failed");
    }
  };

  const handOff = async () => {
    const text = value.trim();
    close();
    const { sendMessage } = await import("@/core/chat");
    await invoke("open_settings").catch(() => undefined);
    void sendMessage(text);
  };

  return (
    <div className="quick">
      <motion.div
        ref={shellRef}
        className="quick__shell"
        initial={{ opacity: 0, y: -10, scale: 0.98, filter: "blur(8px)" }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
        transition={SPRING}
      >
        <div className="quick__field">
          <span className="quick__mark">
            <Logo size={15} />
          </span>
          <textarea
            ref={inputRef}
            className="quick__input"
            rows={1}
            autoFocus
            placeholder="Ask anything, or / for a prompt"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                close();
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (prompts.length) {
                  const pick = prompts[0];
                  // A template with holes needs the main window to fill them.
                  if (variablesIn(pick.body).length) {
                    setValue(pick.body);
                    return;
                  }
                  void ask(pick.body);
                  return;
                }
                void ask(value);
              }
              if (e.key === "Enter" && e.shiftKey) {
                e.preventDefault();
                void handOff();
              }
            }}
          />
          {state === "thinking" ? (
            <span className="thinking" aria-label="Thinking">
              <i />
              <i />
              <i />
            </span>
          ) : (
            <span className="kbd kbd--dim">Esc</span>
          )}
        </div>

        <AnimatePresence>
          {prompts.length > 0 && (
            <motion.div
              className="quick__list"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={SPRING_SNAP}
            >
              {prompts.map((p, i) => (
                <button
                  key={p.id}
                  className="quick__prompt"
                  aria-selected={i === 0}
                  onPointerDown={() => void ask(p.body)}
                >
                  <code>/{p.trigger}</code>
                  <span>{p.title}</span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {answer && (
            <motion.div
              className={`quick__answer${state === "failed" ? " quick__answer--bad" : ""}`}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={SPRING}
            >
              <Markdown text={answer} />
              {state === "answered" && (
                <div className="quick__actions">
                  <button
                    className="msg__action"
                    onPointerDown={() => void navigator.clipboard.writeText(answer)}
                  >
                    <Icon.file />
                    Copy
                  </button>
                  <button className="msg__action" onPointerDown={() => void handOff()}>
                    <Icon.sparkle />
                    Continue in Conduit
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {state === "idle" && !value && (
          <div className="quick__foot">
            <span>
              <span className="kbd">Enter</span> ask
            </span>
            <span>
              <span className="kbd">Shift Enter</span> open in Conduit
            </span>
            <span>
              <span className="kbd">/</span> prompts
            </span>
          </div>
        )}
      </motion.div>
    </div>
  );
}

const SYSTEM = [
  "You are Conduit's quick answer box, summoned over whatever the user is",
  "working in. Answer the question directly and stop.",
  "",
  "Be brief — three sentences at most unless code is the answer, in which case",
  "give the code and one line about it. No preamble, no offers of further help.",
  "You have no tools here; if the request needs one, say it belongs in the main",
  "window and name what you would do there.",
].join("\n");
