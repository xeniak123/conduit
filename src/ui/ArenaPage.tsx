import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ask, contenders, keyOf, vote, type Answer, type Contender } from "@/core/arena";
import { useApp } from "@/core/store";
import { formatCost } from "@/core/usage";
import { BrandMark, brandForModel } from "./Brand";
import { Icon } from "./icons";
import { Markdown } from "./Markdown";
import { SPRING, SPRING_SNAP } from "./motion";

/**
 * Arena: the same question to two, three or four models at once.
 *
 * Blind by default. Names are hidden until you vote, which is the only
 * honest way to find out which model you actually prefer, and it is what
 * makes the comparison worth showing to someone else.
 */

const LETTER = ["A", "B", "C", "D"];
const IDEAS = [
  "Explain quantum entanglement to a twelve-year-old in five sentences.",
  "Write a Python function that merges overlapping intervals, with tests.",
  "Plan a three-day trip to Kraków on a student budget.",
  "What is wrong with this SQL: SELECT name, COUNT(*) FROM users;",
];

export function ArenaPage() {
  const settings = useApp((s) => s.settings);
  const all = useMemo(() => contenders(settings), [settings]);
  const [picked, setPicked] = useState<string[]>(() => all.slice(0, 2).map(keyOf));
  const [prompt, setPrompt] = useState("");
  const [blind, setBlind] = useState(true);
  const [round, setRound] = useState<{ prompt: string; contenders: Contender[]; order: number[] } | null>(null);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [voted, setVoted] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [tab, setTab] = useState<"fight" | "board">("fight");

  // Models often appear a moment after the page (keys are checked
  // asynchronously), so the first two are picked once they do.
  useEffect(() => {
    const valid = picked.filter((k) => all.some((c) => keyOf(c) === k));
    if (valid.length < 2 && all.length >= 2) setPicked(all.slice(0, 2).map(keyOf));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all]);

  const chosen = picked.map((k) => all.find((c) => keyOf(c) === k)).filter(Boolean) as Contender[];
  const running = Object.values(answers).some((a) => !a.done);

  const start = () => {
    if (chosen.length < 2 || !prompt.trim()) return;
    abort.current?.abort();
    abort.current = new AbortController();
    // Shuffled, so position gives nothing away in blind mode.
    const order = chosen.map((_, i) => i).sort(() => Math.random() - 0.5);
    setRound({ prompt: prompt.trim(), contenders: chosen, order });
    setAnswers({});
    setVoted(null);
    for (const c of chosen) {
      void ask(c, prompt.trim(), (a) => setAnswers((cur) => ({ ...cur, [keyOf(c)]: a })), abort.current.signal);
    }
  };

  const castVote = async (winner: Contender | null, label: string) => {
    if (!round) return;
    await vote(round.contenders, winner);
    setVoted(label);
  };

  const toggle = (k: string) =>
    setPicked((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : cur.length >= 4 ? cur : [...cur, k]));

  const ratings = settings.arena?.ratings ?? {};
  const board = Object.entries(ratings)
    .map(([k, r]) => ({ key: k, provider: k.split("::")[0], model: k.split("::").slice(1).join("::"), ...r }))
    .sort((a, b) => b.elo - a.elo);

  return (
    <div className="page page--wide">
      <header className="page__head">
        <div>
          <h1 className="page__title">Arena</h1>
          <p className="page__sub">Ask two to four models the same thing, side by side. Vote blind, and Conduit learns which models you actually prefer.</p>
        </div>
        <div className="seg">
          {(
            [
              ["fight", "Compare"],
              ["board", `Your ranking${board.length ? ` · ${board.length}` : ""}`],
            ] as Array<["fight" | "board", string]>
          ).map(([id, label]) => (
            <button key={id} className="seg__item" aria-current={tab === id} onPointerDown={() => setTab(id)}>
              {tab === id && <motion.span layoutId="arena-tab" className="seg__pill" transition={SPRING_SNAP} />}
              <span>{label}</span>
            </button>
          ))}
        </div>
      </header>

      {tab === "board" ? (
        board.length === 0 ? (
          <div className="emptyline">No votes yet. Compare a few answers and your ranking appears here.</div>
        ) : (
          <div className="cardlist">
            {board.map((r, i) => (
              <div key={r.key} className="lrow">
                <span className="arena__rank">{i + 1}</span>
                <BrandMark brand={brandForModel(r.model, r.provider)} size={32} fallback={r.model} />
                <div className="lrow__text">
                  <b>{r.model}</b>
                  <span>
                    {r.provider} · {r.games} {r.games === 1 ? "round" : "rounds"} · won {Math.round((r.wins / Math.max(1, r.games)) * 100)}%
                  </span>
                </div>
                <span className="arena__elo">{Math.round(r.elo)}</span>
              </div>
            ))}
          </div>
        )
      ) : (
        <>
          {all.length < 2 ? (
            <div className="emptyline">
              The Arena needs at least two models. Add a provider or load a local model in the{" "}
              <button className="linkbtn" onPointerDown={() => useApp.getState().openHub("cloud")}>
                Model hub
              </button>
              .
            </div>
          ) : (
            <>
              <div className="arena__pick">
                {all.map((c) => {
                  const k = keyOf(c);
                  const on = picked.includes(k);
                  return (
                    <button key={k} className="arena__chip" aria-pressed={on} onPointerDown={() => toggle(k)}>
                      <BrandMark brand={brandForModel(c.model, c.provider)} size={20} fallback={c.model} />
                      {c.model}
                      {on && <b>{LETTER[picked.indexOf(k)]}</b>}
                    </button>
                  );
                })}
              </div>

              <div className="arena__ask">
                <textarea
                  className="textarea"
                  rows={2}
                  placeholder="Ask all of them the same thing"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      start();
                    }
                  }}
                />
                <div className="arena__askrow">
                  <div className="arena__ideas">
                    {IDEAS.map((idea) => (
                      <button key={idea} className="chip" onPointerDown={() => setPrompt(idea)}>
                        {idea.slice(0, 34)}…
                      </button>
                    ))}
                  </div>
                  <label className="dec__live">
                    <input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} />
                    Blind
                  </label>
                  <button className="btn btn--ink" disabled={chosen.length < 2 || !prompt.trim() || running} onPointerDown={start}>
                    Compare {chosen.length}
                  </button>
                </div>
              </div>

              <AnimatePresence>
                {round && (
                  <motion.div
                    className="arena__grid"
                    style={{ gridTemplateColumns: `repeat(${round.contenders.length}, minmax(0, 1fr))` }}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={SPRING}
                  >
                    {round.order.map((idx, pos) => {
                      const c = round.contenders[idx];
                      const a = answers[keyOf(c)];
                      const hidden = blind && !voted;
                      return (
                        <div key={keyOf(c)} className="arena__col" data-won={voted === keyOf(c)}>
                          <div className="arena__head">
                            {hidden ? (
                              <span className="arena__letter">Model {LETTER[pos]}</span>
                            ) : (
                              <>
                                <BrandMark brand={brandForModel(c.model, c.provider)} size={22} fallback={c.model} />
                                <b>{c.model}</b>
                              </>
                            )}
                            <span className="spacer" />
                            {a && (
                              <span className="arena__meta">
                                {a.firstMs !== null && `${(a.firstMs / 1000).toFixed(1)}s to start · `}
                                {(a.ms / 1000).toFixed(1)}s
                                {a.cost !== null && a.done ? ` · ${formatCost(a.cost)}` : ""}
                              </span>
                            )}
                          </div>
                          <div className="arena__body">
                            {a?.error ? (
                              <div className="result result--bad">{a.error}</div>
                            ) : a?.text ? (
                              <Markdown text={a.text} />
                            ) : (
                              <span className="spin" />
                            )}
                          </div>
                          {!running && !voted && !a?.error && (
                            <button className="btn arena__vote" onPointerDown={() => void castVote(c, keyOf(c))}>
                              <Icon.check /> {hidden ? `Model ${LETTER[pos]}` : c.model} is better
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
              {round && !running && !voted && (
                <div className="arena__tie">
                  <button className="btn" onPointerDown={() => void castVote(null, "tie")}>
                    It is a tie
                  </button>
                </div>
              )}
              {voted && <div className="result result--ok">Vote counted. Names are now shown.</div>}
            </>
          )}
        </>
      )}
    </div>
  );
}
