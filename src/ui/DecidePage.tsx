import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useApp } from "@/core/store";
import { decide, isDecisionModel, type Decision, type DecisionKind } from "@/models/decide";
import { load, useRuntime } from "@/models/runtime";
import { Icon } from "./icons";
import { SPRING, SPRING_SNAP } from "./motion";

/**
 * The console for decision models.
 *
 * A chat window is the wrong shape for a model that answers with a
 * probability over options: what matters is the options, the bars, and how
 * many milliseconds it took. So it gets its own page: a console to try
 * decisions, a small live game to feel the speed, and the API call to use it
 * from your own program.
 */

const PRESETS: Array<{ name: string; state: string; question: string; options: string[]; kind: DecisionKind }> = [
  {
    name: "News topic",
    state: "Shares of the chipmaker jumped 8% after it raised its revenue forecast.",
    question: "Which news section does this article belong to?",
    options: ["World", "Sports", "Business", "Science/Technology"],
    kind: "choice",
  },
  {
    name: "Sentiment",
    state: "The battery lasts two days, but the screen scratched within a week.",
    question: "How positive is this review?",
    options: ["very negative", "negative", "neutral", "positive", "very positive"],
    kind: "score",
  },
  {
    name: "Needs a human?",
    state: "Customer: I was charged twice for the same order and the bank says it is your side.",
    question: "Should this ticket be escalated to a person?",
    options: [],
    kind: "bool",
  },
  {
    name: "Route a request",
    state: "User message: Refactor this 400-line React component into smaller hooks and keep the tests passing.",
    question: "Which model tier should handle this request?",
    options: ["small fast local model", "mid-size model", "strongest frontier model"],
    kind: "choice",
  },
  {
    name: "Game move",
    state: "You are at row 4, column 2 of a grid. The coin is at row 1, column 2. Nothing blocks the way.",
    question: "Which move brings you closer to the coin?",
    options: ["up", "down", "left", "right"],
    kind: "choice",
  },
];

type Tab = "console" | "game" | "api";

export function DecidePage() {
  const loaded = useRuntime((s) => s.loaded);
  const loading = useRuntime((s) => s.loading);
  const library = useRuntime((s) => s.library);
  const [tab, setTab] = useState<Tab>("console");
  const candidates = library.filter((e) => isDecisionModel(e.repo));
  const ready = loaded?.decision ? loaded : null;

  return (
    <div className="page page--wide">
      <header className="page__head">
        <div>
          <h1 className="page__title">Decisions</h1>
          <p className="page__sub">
            Decision models do not write text. They pick one of your options, with a calibrated probability, in tens of
            milliseconds. Use them to route, filter, classify, or drive a game or a bot.
          </p>
        </div>
        {ready && (
          <div className="page__tools">
            <span className="hwchip">
              <i className="running__dot" data-state="on" /> <b>{ready.name}</b>
            </span>
          </div>
        )}
      </header>

      {!ready ? (
        <div className="dec__empty">
          <div className="dec__emptyart">
            <span />
            <span />
            <span />
          </div>
          <b>{loading ? "Loading…" : "Load a decision model to start"}</b>
          <span>
            Jev-style models such as Jev-Style-Qwen3.5-2B-Decision or Tiny-Jev. They are small and run well even on a
            laptop.
          </span>
          <div className="dec__emptyactions">
            {candidates.map((e) => (
              <button
                key={e.id}
                className="btn btn--ink"
                disabled={Boolean(loading)}
                onPointerDown={() => void load(e, { context: 4096, gpuLayers: 999, flashAttention: true })}
              >
                <Icon.play /> Load {e.name} ({e.quant})
              </button>
            ))}
            <button className="btn" onPointerDown={() => useApp.getState().openHub("discover")}>
              Find decision models
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="hub__bar">
            <div className="seg seg--lg">
              {(
                [
                  ["console", "Console"],
                  ["game", "Live game"],
                  ["api", "Use from code"],
                ] as Array<[Tab, string]>
              ).map(([id, label]) => (
                <button key={id} className="seg__item" aria-current={tab === id} onPointerDown={() => setTab(id)}>
                  {tab === id && <motion.span layoutId="dec-tab" className="seg__pill" transition={SPRING_SNAP} />}
                  <span>{label}</span>
                </button>
              ))}
            </div>
          </div>
          {tab === "console" && <Console port={ready.port} />}
          {tab === "game" && <Game port={ready.port} />}
          {tab === "api" && <Api />}
        </>
      )}
    </div>
  );
}

function Console({ port }: { port: number }) {
  const [state, setState] = useState(PRESETS[0].state);
  const [question, setQuestion] = useState(PRESETS[0].question);
  const [options, setOptions] = useState<string[]>(PRESETS[0].options);
  const [kind, setKind] = useState<DecisionKind>("choice");
  const [draft, setDraft] = useState("");
  const [result, setResult] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(false);
  const [bench, setBench] = useState<string | null>(null);

  const opts = kind === "bool" ? ["yes", "no"] : options;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await decide(port, { state, question, options: opts, kind }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Deciding as you type is what makes the speed tangible.
  useEffect(() => {
    if (!live) return;
    const t = setTimeout(() => void run(), 220);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, state, question, options, kind]);

  const benchmark = async () => {
    setBench("Running 20 decisions…");
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      const d = await decide(port, { state, question, options: opts, kind });
      times.push(d.ms);
    }
    times.sort((a, b) => a - b);
    const median = times[10];
    setBench(`Median ${median} ms · ${Math.round(1000 / Math.max(1, median))} decisions a second`);
  };

  const add = () => {
    const v = draft.trim();
    if (v && options.length < 26) setOptions([...options, v]);
    setDraft("");
  };

  return (
    <div className="dec__layout">
      <div className="dec__form">
        <div className="dec__presets">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              className="chip"
              onPointerDown={() => {
                setState(p.state);
                setQuestion(p.question);
                setOptions(p.options.length ? p.options : options);
                setKind(p.kind);
                setResult(null);
              }}
            >
              {p.name}
            </button>
          ))}
        </div>

        <label className="form">
          <span>State</span>
          <textarea className="textarea" rows={4} value={state} onChange={(e) => setState(e.target.value)} />
        </label>
        <label className="form">
          <span>Question</span>
          <input className="input" value={question} onChange={(e) => setQuestion(e.target.value)} />
        </label>

        <div className="form">
          <span>Answer type</span>
          <div className="seg">
            {(
              [
                ["choice", "Pick one"],
                ["bool", "Yes or no"],
                ["score", "Score (ordered)"],
              ] as Array<[DecisionKind, string]>
            ).map(([id, label]) => (
              <button key={id} className="seg__item" aria-current={kind === id} onPointerDown={() => setKind(id)}>
                {kind === id && <motion.span layoutId="dec-kind" className="seg__pill" transition={SPRING_SNAP} />}
                <span>{label}</span>
              </button>
            ))}
          </div>
        </div>

        {kind !== "bool" && (
          <div className="form">
            <span>{kind === "score" ? "Levels, lowest first" : "Options"}</span>
            <div className="dec__options">
              {options.map((o, i) => (
                <span key={`${o}-${i}`} className="pill pill--removable">
                  <b className="dec__letter">{String.fromCharCode(65 + i)}</b>
                  {o}
                  <button aria-label={`Remove ${o}`} onPointerDown={() => setOptions(options.filter((_, j) => j !== i))}>
                    <Icon.close />
                  </button>
                </span>
              ))}
              <input
                className="input input--small dec__add"
                placeholder="Add an option"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && add()}
              />
            </div>
          </div>
        )}

        <div className="dec__actions">
          <button className="btn btn--ink btn--lg" disabled={busy || opts.length < 2} onPointerDown={() => void run()}>
            Decide
          </button>
          <label className="dec__live">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
            Decide as I type
          </label>
          <span className="spacer" />
          <button className="btn" onPointerDown={() => void benchmark()}>
            <Icon.gauge /> Speed test
          </button>
        </div>
        {bench && <div className="muted">{bench}</div>}
      </div>

      <div className="dec__result">
        {error && <div className="result result--bad">{error}</div>}
        {!result && !error && <div className="emptyline">The decision shows up here, with a probability for every option.</div>}
        {result && (
          <>
            <div className="dec__winner">
              <span>Decision</span>
              <b>{result.best}</b>
              <em>
                {Math.round((result.options.find((o) => o.label === result.best)?.p ?? 0) * 100)}% sure · {result.ms} ms
              </em>
            </div>
            <div className="dec__bars">
              {result.options.map((o) => (
                <div key={o.label} className="dec__bar" data-best={o.label === result.best}>
                  <span className="dec__barlabel">{o.label}</span>
                  <span className="dec__track">
                    <motion.i initial={{ width: 0 }} animate={{ width: `${Math.max(1, o.p * 100)}%` }} transition={SPRING} />
                  </span>
                  <span className="dec__pct">{(o.p * 100).toFixed(1)}%</span>
                </div>
              ))}
            </div>
            {result.expected !== undefined && (
              <div className="muted">
                Expected level {(result.expected + 1).toFixed(2)} of {result.options.length}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * A tiny world the model plays live: reach the coin, avoid the walls.
 * Each step is one decision from a text description of the surroundings,
 * which is exactly how these models are meant to sit inside a game loop.
 */
const SIZE = 9;
type Pos = { r: number; c: number };
const DELTA = { up: { r: -1, c: 0 }, down: { r: 1, c: 0 }, left: { r: 0, c: -1 }, right: { r: 0, c: 1 } } as const;

function Game({ port }: { port: number }) {
  const [me, setMe] = useState<Pos>({ r: 7, c: 1 });
  const [coin, setCoin] = useState<Pos>({ r: 1, c: 7 });
  const [walls] = useState<Set<string>>(() => new Set(["3,3", "3,4", "3,5", "5,5", "6,5", "5,2"]));
  const [running, setRunning] = useState(false);
  const [stats, setStats] = useState({ moves: 0, coins: 0, ms: 0 });
  const [last, setLast] = useState<Decision | null>(null);
  const stop = useRef(false);

  const free = (p: Pos) => p.r >= 0 && p.c >= 0 && p.r < SIZE && p.c < SIZE && !walls.has(`${p.r},${p.c}`);

  /** Steps to the goal around the walls (breadth-first), or Infinity. */
  const distance = (from: Pos, goal: Pos): number => {
    const seen = new Set([`${from.r},${from.c}`]);
    let frontier = [from];
    for (let steps = 0; frontier.length; steps++) {
      const next: Pos[] = [];
      for (const p of frontier) {
        if (p.r === goal.r && p.c === goal.c) return steps;
        for (const d of Object.values(DELTA)) {
          const q = { r: p.r + d.r, c: p.c + d.c };
          const k = `${q.r},${q.c}`;
          if (free(q) && !seen.has(k)) {
            seen.add(k);
            next.push(q);
          }
        }
      }
      frontier = next;
    }
    return Infinity;
  };

  /**
   * The way decision models are meant to be fed: only the moves that are
   * possible, each with what it leads to. The model weighs consequences; it
   * does not have to do geometry in its head, which a 2B model does badly.
   */
  const choices = (p: Pos, goal: Pos, recent: string[]) => {
    const now = distance(p, goal);
    return (Object.keys(DELTA) as Array<keyof typeof DELTA>)
      .map((dir) => {
        const q = { r: p.r + DELTA[dir].r, c: p.c + DELTA[dir].c };
        if (!free(q)) return null;
        const after = distance(q, goal);
        const effect = after < now ? "closer to the coin" : after > now ? "farther from the coin" : "no closer";
        const revisit = recent.includes(`${q.r},${q.c}`) ? ", back to a square you just left" : "";
        return { dir, pos: q, label: `move ${dir}: ${after} steps from the coin, ${effect}${revisit}` };
      })
      .filter((c): c is { dir: keyof typeof DELTA; pos: Pos; label: string } => c !== null);
  };

  const play = async () => {
    stop.current = false;
    setRunning(true);
    let pos = me;
    let goal = coin;
    let totalMs = 0;
    let moves = 0;
    let coins = stats.coins;
    let lastMove: string | null = null;
    const recent: string[] = [];
    while (!stop.current && moves < 300) {
      const options = choices(pos, goal, recent);
      if (!options.length) break;
      const d = await decide(port, {
        state: `You are playing a grid game and want to reach the coin in as few moves as possible. You are ${distance(pos, goal)} steps from it.${lastMove ? ` Your last move was ${lastMove}.` : ""}`,
        question: "Which move should you make?",
        options: options.map((o) => o.label),
      });
      const best = options[d.options.findIndex((o) => o.label === d.best)] ?? options[0];
      recent.push(`${pos.r},${pos.c}`);
      if (recent.length > 6) recent.shift();
      pos = best.pos;
      lastMove = best.dir;
      moves += 1;
      totalMs += d.ms;
      if (pos.r === goal.r && pos.c === goal.c) {
        coins += 1;
        recent.length = 0;
        do {
          goal = { r: Math.floor(Math.random() * SIZE), c: Math.floor(Math.random() * SIZE) };
        } while (!free(goal) || (goal.r === pos.r && goal.c === pos.c));
        setCoin(goal);
      }
      setMe(pos);
      // Bars show the direction; the full option text is what the model read.
      setLast({ ...d, best: best.dir, options: d.options.map((o, i) => ({ ...o, label: options[i].dir })) });
      setStats({ moves, coins, ms: Math.round(totalMs / moves) });
    }
    setRunning(false);
  };

  const cells = useMemo(() => Array.from({ length: SIZE * SIZE }, (_, i) => ({ r: Math.floor(i / SIZE), c: i % SIZE })), []);

  return (
    <div className="dec__layout">
      <div className="dec__game">
        {cells.map((cell) => {
          const key = `${cell.r},${cell.c}`;
          const kind = walls.has(key) ? "wall" : cell.r === me.r && cell.c === me.c ? "me" : cell.r === coin.r && cell.c === coin.c ? "coin" : "";
          return (
            <span key={key} className="dec__cell" data-kind={kind}>
              {kind === "me" && <motion.i layoutId="dec-me" className="dec__me" transition={{ type: "spring", bounce: 0, duration: 0.12 }} />}
            </span>
          );
        })}
      </div>
      <div className="dec__result">
        <div className="dec__stats">
          <div><b>{stats.coins}</b><span>coins</span></div>
          <div><b>{stats.moves}</b><span>moves</span></div>
          <div><b>{stats.ms || "–"}</b><span>ms per move</span></div>
        </div>
        <AnimatePresence>
          {last && (
            <div className="dec__bars">
              {last.options.map((o) => (
                <div key={o.label} className="dec__bar" data-best={o.label === last.best}>
                  <span className="dec__barlabel">{o.label}</span>
                  <span className="dec__track"><i style={{ width: `${Math.max(1, o.p * 100)}%` }} /></span>
                  <span className="dec__pct">{(o.p * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          )}
        </AnimatePresence>
        <button
          className="btn btn--ink btn--lg"
          onPointerDown={() => {
            if (running) stop.current = true;
            else void play();
          }}
        >
          {running ? <Icon.pause /> : <Icon.play />} {running ? "Stop" : "Let it play"}
        </button>
        <p className="muted">
          Each move is one decision from a sentence describing the surroundings. A chat model would take seconds per
          move; this one decides in the time a frame takes to draw.
        </p>
      </div>
    </div>
  );
}

function Api() {
  const port = useApp((s) => s.settings.api.port);
  const on = useApp((s) => s.settings.api.enabled);
  const sample = `curl http://127.0.0.1:${port}/v1/decide \\
  -H "Content-Type: application/json" \\
  -d '{
    "state": "Health 3/20. A zombie is two blocks ahead. Night.",
    "question": "What should the player do now?",
    "options": ["attack", "retreat", "eat", "build a wall"]
  }'`;
  const python = `import requests

r = requests.post("http://127.0.0.1:${port}/v1/decide", json={
    "state": "Health 3/20. A zombie is two blocks ahead. Night.",
    "question": "What should the player do now?",
    "options": ["attack", "retreat", "eat", "build a wall"],
}).json()
print(r["best"], r["options"])   # retreat [{'label': 'attack', 'p': 0.04}, ...]`;
  return (
    <div className="dec__api">
      {!on && (
        <div className="notice--soft">
          Turn on the local API on the API page first. It listens only on this computer unless you change that.
        </div>
      )}
      <p className="muted">
        POST a state, a question and options to <code>/v1/decide</code>. The answer has a probability for every option,
        the winner and the time it took. Add <code>"kind": "bool"</code> for yes or no, or <code>"kind": "score"</code>{" "}
        for ordered levels.
      </p>
      <h3 className="block__title">curl</h3>
      <pre className="dec__code">{sample}</pre>
      <h3 className="block__title block__title--gap">Python</h3>
      <pre className="dec__code">{python}</pre>
    </div>
  );
}
