import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "motion/react";
import { isTauri } from "@/core/host";
import { keyKnown } from "@/core/secrets";
import { useApp } from "@/core/store";
import {
  conversationsToJsonl,
  datasetRows,
  datasetSplits,
  guessMapping,
  parseLocalDataset,
  rowToChat,
  searchDatasets,
  slugify,
  toChatJsonl,
  type DatasetRows,
} from "@/data/datasets";
import {
  DATASET_DEFAULTS,
  TRAINABLE_DEFAULTS,
  cachedRepos,
  looksLikePath,
  savedTrainingFiles,
  searchTrainableModels,
  toTextJsonl,
} from "@/data/sources";
import {
  CONTEXT_LENGTHS,
  DEFAULTS,
  METHODS,
  conversionSteps,
  effectiveBatch,
  estimate,
  family,
  fromYaml,
  parametersFromName,
  problems,
  toYaml,
  trainingScript,
  type Method,
  type TuneConfig,
} from "@/data/tune";
import {
  checkEnvironment,
  forgetRun,
  installPackages,
  startRun,
  stopRun,
  trainingDir,
  useTraining,
  type Point,
  type Run,
} from "@/data/runs";
import { detectHardware, useRuntime } from "@/models/runtime";
import { Icon } from "./icons";
import { SPRING, SPRING_SNAP } from "./motion";

/**
 * Train: fine-tuning from a model and a dataset to a running job.
 *
 * Laid out the way the work goes — Model, Dataset, Parameters — with a run
 * preview beside it that answers the only questions that matter before
 * pressing Start: what will run, will it fit, and is this machine ready.
 * Current run follows the job live; History keeps every run and its curve.
 */

type Tab = "configure" | "current" | "history";
type Source =
  | { kind: "hub"; id: string }
  | { kind: "file"; name: string; data: DatasetRows }
  | { kind: "saved"; path: string }
  | { kind: "chats" };

const DRAFT_KEY = "conduit.train.draft.v1";

function loadDraft(): { config: TuneConfig; source: Source | null } {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null") as { config?: TuneConfig; source?: Source } | null;
    if (raw?.config) {
      // A file's rows are not kept between sessions; it has to be chosen again.
      const source = raw.source && raw.source.kind !== "file" ? raw.source : null;
      return { config: { ...DEFAULTS, ...raw.config }, source };
    }
  } catch {
    /* start fresh */
  }
  return { config: DEFAULTS, source: null };
}

export function TunePage() {
  const running = useTraining((s) => s.current?.status === "running" || s.current?.status === "starting");
  const [tab, setTab] = useState<Tab>(running ? "current" : "configure");
  const draft = useMemo(loadDraft, []);
  const [config, setConfig] = useState<TuneConfig>(draft.config);
  const [source, setSource] = useState<Source | null>(draft.source);
  const [chats, setChats] = useState<{ project: string; system: string }>({ project: "all", system: "" });

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ config, source: source?.kind === "file" ? null : source }));
    } catch {
      /* the draft is a convenience */
    }
  }, [config, source]);

  // The output folder follows the run's name (or the model) until someone types their own.
  const outputTouched = useRef(Boolean(draft.config.output && draft.config.name));
  useEffect(() => {
    if (outputTouched.current) return;
    void trainingDir().then((dir) =>
      setConfig((c) => ({ ...c, output: `${dir}/${slugify(c.name || c.model.split("/").pop() || "run")}` })),
    );
  }, [config.model, config.name]);

  const set = (patch: Partial<TuneConfig>) => setConfig((c) => ({ ...c, ...patch }));

  return (
    <div className="page page--wide train">
      <header className="train__head">
        <h1 className="page__title">Train</h1>
        <p className="page__sub">Configure and start training</p>
      </header>

      <nav className="train__tabs" role="tablist">
        {(
          [
            ["configure", "Configure"],
            ["current", "Current run"],
            ["history", "History"],
          ] as Array<[Tab, string]>
        ).map(([id, label]) => (
          <button key={id} role="tab" className="train__tab" aria-selected={tab === id} onPointerDown={() => setTab(id)}>
            {label}
            {id === "current" && running && <span className="train__live" aria-label="Running" />}
            {tab === id && <motion.span layoutId="train-tab" className="train__tabline" transition={SPRING_SNAP} />}
          </button>
        ))}
      </nav>

      {tab === "configure" && (
        <Configure
          config={config}
          set={set}
          replace={(next) => {
            outputTouched.current = true;
            setConfig(next);
            setSource(next.hubDataset ? { kind: "hub", id: next.hubDataset } : next.dataset ? { kind: "saved", path: next.dataset } : null);
          }}
          touchOutput={() => (outputTouched.current = true)}
          source={source}
          setSource={setSource}
          chats={chats}
          setChats={setChats}
          onStarted={() => setTab("current")}
        />
      )}
      {tab === "current" && <Current onConfigure={() => setTab("configure")} />}
      {tab === "history" && (
        <History
          onLoad={(run) => {
            outputTouched.current = true;
            setConfig({ ...DEFAULTS, ...run.config });
            setSource(run.config.hubDataset ? { kind: "hub", id: run.config.hubDataset } : { kind: "saved", path: run.config.dataset });
            setTab("configure");
          }}
        />
      )}
    </div>
  );
}

// --- configure ---------------------------------------------------------------------

function Configure({
  config,
  set,
  replace,
  touchOutput,
  source,
  setSource,
  chats,
  setChats,
  onStarted,
}: {
  config: TuneConfig;
  set: (patch: Partial<TuneConfig>) => void;
  replace: (next: TuneConfig) => void;
  touchOutput: () => void;
  source: Source | null;
  setSource: (s: Source | null) => void;
  chats: { project: string; system: string };
  setChats: (c: { project: string; system: string }) => void;
  onStarted: () => void;
}) {
  const hardware = useRuntime((s) => s.hardware);
  const env = useTraining((s) => s.env);
  const conversations = useApp((s) => s.conversations);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void detectHardware().catch(() => undefined);
    if (!useTraining.getState().env.checked) void checkEnvironment();
  }, []);

  // What a local file or the chats will become at Start, counted now.
  const chatExport = useMemo(
    () =>
      source?.kind === "chats"
        ? conversationsToJsonl(
            conversations.filter((c) => chats.project === "all" || c.projectId === chats.project),
            chats.system,
          )
        : null,
    [source, conversations, chats],
  );

  // Problems the plan has, counting the dataset the way Start will see it.
  const effective: TuneConfig = {
    ...config,
    dataset: source?.kind === "saved" ? source.path : source?.kind === "file" || source?.kind === "chats" ? "(prepared on start)" : "",
    hubDataset: source?.kind === "hub" ? source.id : "",
  };
  const issues = [
    ...problems(effective),
    ...(source?.kind === "chats" && !chatExport?.count ? ["There are no finished chats to train on yet."] : []),
  ];
  const envReady = env.checked && env.python !== null && env.missing.length === 0;

  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      const final = { ...effective };
      if (source?.kind === "file") {
        final.dataset = await saveTrainingFile(source.name.replace(/\.[^.]+$/, ""), buildLocal(source.data, config));
      } else if (source?.kind === "chats" && chatExport) {
        final.dataset = await saveTrainingFile(`my-chats-${new Date().toISOString().slice(0, 10)}`, chatExport.jsonl);
      }
      await startRun(final);
      onStarted();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="train__grid">
      <div className="train__main">
        <ModelCard config={config} set={set} />
        <DatasetCard
          config={config}
          set={set}
          source={source}
          setSource={setSource}
          chats={chats}
          setChats={setChats}
          chatCount={chatExport?.count ?? 0}
        />
        <ParametersCard config={config} set={set} touchOutput={touchOutput} />
        <ConfigurationCard config={effective} replace={replace} />
      </div>

      <RunPreview
        config={effective}
        source={source}
        issues={issues}
        vramGb={hardware && hardware.vram > 0 ? Math.round((hardware.vram / 1024) * 10) / 10 : null}
        gpu={hardware?.gpu ?? null}
        envReady={envReady}
        starting={starting}
        error={error}
        onStart={() => void start()}
        nvidia={Boolean(hardware?.vendor && /nvidia/i.test(hardware.vendor)) || Boolean(hardware?.gpu && /nvidia|geforce|rtx/i.test(hardware.gpu))}
      />
    </div>
  );
}

/** A local file's rows in the shape training needs. */
function buildLocal(data: DatasetRows, config: TuneConfig): string {
  if (config.method === "cpt") return toTextJsonl(data.rows, config.mapPrompt || "text");
  return toChatJsonl(data.rows, {
    prompt: config.mapPrompt,
    response: config.mapResponse,
    system: config.mapSystem || undefined,
    context: config.mapContext || undefined,
  });
}

async function saveTrainingFile(name: string, jsonl: string): Promise<string> {
  if (!jsonl.trim()) throw new Error("None of those rows became training examples. Check which columns hold what under Advanced.");
  const dir = (await trainingDir()).replace(/\/training$/, "");
  const path = `${dir}/datasets/${slugify(name)}.jsonl`;
  if (isTauri()) await invoke("fs_write", { path, contents: jsonl });
  return path;
}

function Card({
  icon,
  tone,
  title,
  sub,
  aside,
  children,
}: {
  icon: React.ReactNode;
  tone: "green" | "pink" | "amber" | "teal";
  title: string;
  sub: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="tcard">
      <header className="tcard__head">
        <span className="tcard__icon" data-tone={tone}>
          {icon}
        </span>
        <div className="tcard__titles">
          <b>{title}</b>
          <span>{sub}</span>
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <span className="tlabel">
      {children}
      {hint && (
        <span className="tlabel__hint" title={hint} aria-label={hint}>
          i
        </span>
      )}
    </span>
  );
}

function Segmented<T extends string>({ value, options, onChange, id }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; id: string }) {
  return (
    <div className="tseg">
      {options.map(([key, label]) => (
        <button key={key} className="tseg__item" aria-pressed={value === key} onPointerDown={() => onChange(key)}>
          {value === key && <motion.span layoutId={`tseg-${id}`} className="tseg__pill" transition={SPRING_SNAP} />}
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

// --- model ----------------------------------------------------------------------------

function ModelCard({ config, set }: { config: TuneConfig; set: (patch: Partial<TuneConfig>) => void }) {
  const hfToken = keyKnown("huggingface");
  return (
    <Card icon={<Icon.brain />} tone="green" title="Model" sub="Select model and training method">
      <div className="tfields tfields--model">
        <div className="tfield">
          <Label hint="The model to start from: a Hugging Face repository, or a folder on this computer.">Model</Label>
          <ModelPicker value={config.model} onPick={(model) => set({ model })} />
        </div>
        <div className="tfield">
          <Label hint="How much of the model is trained, and how much memory that takes.">Method</Label>
          <MethodPicker
            value={config.method}
            onPick={(method) =>
              set({
                method,
                learningRate: method === "full" ? 1e-5 : config.method === "full" ? 2e-4 : config.learningRate,
                mapPrompt: method === "cpt" || config.method === "cpt" ? "" : config.mapPrompt,
              })
            }
          />
        </div>
        <div className="tfield">
          <Label hint="Needed for gated models such as Llama and Gemma. Stored in the system keychain and passed to the training process, never shown here.">
            HF token
          </Label>
          <button className="tselect tselect--quiet" onPointerDown={() => useApp.getState().openHub("cloud")}>
            <span className="ttoken" data-set={hfToken}>
              <Icon.shield />
            </span>
            <span>{hfToken ? "Connected" : "Not set"}</span>
          </button>
        </div>
      </div>
    </Card>
  );
}

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", key);
    };
  }, [open]);
  return { open, setOpen, ref };
}

const pop = {
  initial: { opacity: 0, y: -4, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -4, scale: 0.98 },
  transition: { duration: 0.14 },
};

interface PickItem {
  id: string;
  label: string;
  badge?: string;
}

/**
 * The two-tab picker used for models and datasets: what is on this computer,
 * and what is on Hugging Face. Typing searches; pasting a path offers it.
 */
function Picker({
  value,
  icon,
  placeholder,
  searchLocal,
  searchHub,
  onPick,
}: {
  value: string;
  icon: React.ReactNode;
  placeholder: [string, string];
  searchLocal: (q: string) => Promise<PickItem[]>;
  searchHub: (q: string) => Promise<PickItem[]>;
  onPick: (item: PickItem, from: "device" | "hub") => void;
}) {
  const { open, setOpen, ref } = usePopover();
  const [tab, setTab] = useState<"device" | "hub">("hub");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<PickItem[]>([]);
  const [loading, setLoading] = useState(false);
  const ticket = useRef(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => input.current?.focus());
  }, [open, tab]);

  useEffect(() => {
    if (!open) return;
    const mine = ++ticket.current;
    setLoading(true);
    const t = window.setTimeout(
      () => {
        (tab === "device" ? searchLocal(query) : searchHub(query))
          .then((found) => mine === ticket.current && setItems(found))
          .catch(() => mine === ticket.current && setItems([]))
          .finally(() => mine === ticket.current && setLoading(false));
      },
      query ? 280 : 0,
    );
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab, query]);

  const pathOption = tab === "device" && looksLikePath(query) ? [{ id: query.trim(), label: query.trim(), badge: "Folder" }] : [];
  const shown = [...pathOption, ...items];

  return (
    <div className="tpick" ref={ref}>
      <button className="tselect" aria-expanded={open} onPointerDown={() => setOpen(!open)}>
        <span className="tselect__icon">{icon}</span>
        <span className="tselect__value">{value ? value.split(/[\\/]/).slice(-1)[0] : "Choose…"}</span>
        <span className="tselect__chev">
          <Icon.chevron />
        </span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="tpop" {...pop}>
            <Segmented
              id={`pick-${placeholder[1]}`}
              value={tab}
              options={[
                ["device", "On device"],
                ["hub", "Hugging Face"],
              ]}
              onChange={(t) => {
                setTab(t);
                setQuery("");
              }}
            />
            <div className="tpop__search">
              <Icon.search />
              <input
                ref={input}
                value={query}
                placeholder={tab === "device" ? placeholder[0] : placeholder[1]}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && shown[0]) {
                    onPick(shown[0], tab);
                    setOpen(false);
                  }
                }}
              />
            </div>
            <div className="tpop__list" aria-busy={loading}>
              {shown.map((item) => (
                <button
                  key={item.id}
                  className="tpop__item"
                  aria-current={item.id === value}
                  onPointerDown={() => {
                    onPick(item, tab);
                    setOpen(false);
                  }}
                >
                  <span className="tpop__label">{item.label}</span>
                  {item.badge && <span className="tpop__badge">{item.badge}</span>}
                </button>
              ))}
              {!loading && !shown.length && (
                <div className="tpop__empty">
                  {tab === "device" ? "Nothing on this computer yet. Paste a folder path, or pick from Hugging Face." : "Nothing matches that."}
                </div>
              )}
              {loading && !shown.length && <div className="tpop__empty">Searching…</div>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ModelPicker({ value, onPick }: { value: string; onPick: (model: string) => void }) {
  return (
    <Picker
      value={value}
      icon={<Icon.cpu />}
      placeholder={["Search local models or paste a folder path…", "Search Hugging Face models…"]}
      searchLocal={async (q) =>
        (await cachedRepos("models"))
          .filter((id) => !/gguf/i.test(id) && id.toLowerCase().includes(q.toLowerCase()))
          .map((id) => ({ id, label: id, badge: "HF cache" }))
      }
      searchHub={async (q) =>
        q.trim()
          ? (await searchTrainableModels(q)).map((m) => ({ id: m.id, label: m.id, badge: compact(m.downloads) }))
          : TRAINABLE_DEFAULTS.map((id) => ({ id, label: id }))
      }
      onPick={(item) => onPick(item.id)}
    />
  );
}

function MethodPicker({ value, onPick }: { value: Method; onPick: (m: Method) => void }) {
  const { open, setOpen, ref } = usePopover();
  const [hover, setHover] = useState<Method | null>(null);
  const current = METHODS.find((m) => m.id === value)!;
  const tip = METHODS.find((m) => m.id === (hover ?? value));
  return (
    <div className="tpick" ref={ref}>
      <button className="tselect" aria-expanded={open} onPointerDown={() => setOpen(!open)}>
        <span className="tdot" data-tone={current.colour} />
        <span className="tselect__value">{current.label}</span>
        <span className="tselect__chev">
          <Icon.chevron />
        </span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="tpop tpop--menu" {...pop}>
            {METHODS.map((m) => (
              <button
                key={m.id}
                className="tpop__item"
                aria-current={m.id === value}
                onPointerEnter={() => setHover(m.id)}
                onPointerLeave={() => setHover(null)}
                onPointerDown={() => {
                  onPick(m.id);
                  setOpen(false);
                }}
              >
                <span className="tdot" data-tone={m.colour} />
                <span className="tpop__label">{m.label}</span>
                {m.id === value && <Icon.check />}
              </button>
            ))}
            {tip && <div className="ttip">{tip.detail}</div>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- dataset ---------------------------------------------------------------------------

function DatasetCard({
  config,
  set,
  source,
  setSource,
  chats,
  setChats,
  chatCount,
}: {
  config: TuneConfig;
  set: (patch: Partial<TuneConfig>) => void;
  source: Source | null;
  setSource: (s: Source | null) => void;
  chats: { project: string; system: string };
  setChats: (c: { project: string; system: string }) => void;
  chatCount: number;
}) {
  const [mode, setMode] = useState<"browse" | "chats">(source?.kind === "chats" ? "chats" : "browse");
  const [splits, setSplits] = useState<Array<{ config: string; split: string }>>([]);
  const [preview, setPreview] = useState<DatasetRows | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const projects = useApp((s) => s.settings.projects);
  const hubId = source?.kind === "hub" ? source.id : "";

  // A Hugging Face dataset: its subsets and splits, then a peek at its rows.
  useEffect(() => {
    if (!hubId) return;
    setProblem(null);
    setSplits([]);
    datasetSplits(hubId)
      .then((found) => {
        setSplits(found);
        const subset = found.some((s) => s.config === config.hubSubset) ? config.hubSubset : (found[0]?.config ?? "");
        const inSubset = found.filter((s) => s.config === subset).map((s) => s.split);
        const split = inSubset.includes(config.hubSplit) ? config.hubSplit : inSubset.includes("train") ? "train" : (inSubset[0] ?? "train");
        set({ hubSubset: subset, hubSplit: split, hubEvalSplit: inSubset.includes(config.hubEvalSplit) ? config.hubEvalSplit : "" });
      })
      .catch((e) => setProblem(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hubId]);

  useEffect(() => {
    if (!hubId || !config.hubSubset) return;
    setPreview(null);
    datasetRows(hubId, config.hubSubset, config.hubSplit || "train", 8)
      .then((rows) => {
        setPreview(rows);
        applyGuess(rows.columns);
      })
      .catch((e) => setProblem(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hubId, config.hubSubset, config.hubSplit]);

  useEffect(() => {
    if (source?.kind === "file") {
      setPreview(source.data);
      applyGuess(source.data.columns);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  /** First guess at the columns, kept if the user already chose ones that exist. */
  function applyGuess(columns: string[]) {
    if (config.mapPrompt && columns.includes(config.mapPrompt)) return;
    if (config.method === "cpt") {
      set({ mapPrompt: columns.includes("text") ? "text" : (columns[0] ?? ""), mapResponse: "", mapSystem: "", mapContext: "" });
      return;
    }
    const guess = guessMapping(columns);
    set({ mapPrompt: guess.prompt, mapResponse: guess.response, mapSystem: guess.system ?? "", mapContext: guess.context ?? "" });
  }

  const readFile = async (file: File) => {
    setProblem(null);
    try {
      const data = parseLocalDataset(await file.text(), file.name);
      if (!data.rows.length) throw new Error("No rows in that file. Conduit reads JSONL, JSON, CSV, TXT and Markdown.");
      set({ mapPrompt: "", mapResponse: "", mapSystem: "", mapContext: "" });
      setSource({ kind: "file", name: file.name, data });
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };

  const subsets = [...new Set(splits.map((s) => s.config))];
  const splitNames = splits.filter((s) => s.config === config.hubSubset).map((s) => s.split);

  return (
    <Card
      icon={<Icon.book />}
      tone="pink"
      title="Dataset"
      sub="Select or upload training data"
      aside={
        <Segmented
          id="dataset-mode"
          value={mode}
          options={[
            ["browse", "Browse"],
            ["chats", "Your chats"],
          ]}
          onChange={(m) => {
            setMode(m);
            if (m === "chats") setSource({ kind: "chats" });
            else if (source?.kind === "chats") setSource(null);
          }}
        />
      }
    >
      {mode === "chats" ? (
        <div className="tfields">
          <div className="tfield">
            <Label hint="Every finished exchange becomes one example. Nothing leaves this computer.">Which chats</Label>
            <select className="tselect tselect--native" value={chats.project} onChange={(e) => setChats({ ...chats, project: e.target.value })}>
              <option value="all">All chats</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="tfield tfield--wide">
            <Label hint="Optional. Trained in as the system message of every example.">Instruction</Label>
            <input
              className="tinput"
              placeholder="You are my writing assistant."
              value={chats.system}
              onChange={(e) => setChats({ ...chats, system: e.target.value })}
            />
          </div>
          <p className="tnote">{chatCount ? `${chatCount.toLocaleString()} finished conversations will be used.` : "No finished conversations to use yet."}</p>
        </div>
      ) : (
        <>
          <div className="tfields tfields--two">
            <div className="tfield">
              <Label hint="A dataset on Hugging Face, or a training file already on this computer.">Dataset</Label>
              <Picker
                value={source?.kind === "hub" ? source.id : source?.kind === "saved" ? source.path : source?.kind === "file" ? source.name : ""}
                icon={<Icon.book />}
                placeholder={["Search training files on this computer…", "Search Hugging Face datasets…"]}
                searchLocal={async (q) => {
                  const dir = (await trainingDir()).replace(/\/training$/, "");
                  const files = (await savedTrainingFiles(dir)).map((path) => ({ id: path, label: path.split("/").pop()!, badge: "Conduit" }));
                  const cached = (await cachedRepos("datasets")).map((id) => ({ id, label: id, badge: "HF cache" }));
                  return [...files, ...cached].filter((i) => i.label.toLowerCase().includes(q.toLowerCase()));
                }}
                searchHub={async (q) =>
                  q.trim()
                    ? (await searchDatasets(q)).slice(0, 30).map((d) => ({ id: d.id, label: d.id, badge: compact(d.downloads) }))
                    : DATASET_DEFAULTS.map((id) => ({ id, label: id }))
                }
                onPick={(item) => {
                  set({ mapPrompt: "", mapResponse: "", mapSystem: "", mapContext: "", hubSubset: "", hubEvalSplit: "" });
                  setPreview(null);
                  setSource(item.id.endsWith(".jsonl") && item.badge === "Conduit" ? { kind: "saved", path: item.id } : { kind: "hub", id: item.id });
                }}
              />
            </div>
            <div className="tfield">
              <Label hint="A file from this computer: rows of questions and answers, or plain text for continued pretraining.">Or upload a local file</Label>
              <button
                className="tdrop"
                onPointerDown={() => fileInput.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f) void readFile(f);
                }}
              >
                <Icon.download />
                Drop file or click to upload
              </button>
              <span className="tformats">CSV, JSONL, JSON, TXT, MD</span>
              <input
                ref={fileInput}
                type="file"
                accept=".jsonl,.json,.csv,.tsv,.txt,.md,.markdown"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void readFile(f);
                  e.target.value = "";
                }}
              />
            </div>
          </div>

          {problem && <div className="result result--bad">{problem}</div>}

          {source && source.kind !== "chats" && (
            <div className="tchosen">
              <span className="tchosen__icon">
                <Icon.book />
              </span>
              <div className="tchosen__text">
                <b>{source.kind === "hub" ? source.id : source.kind === "file" ? source.name : source.path.split("/").pop()}</b>
                <span>
                  {source.kind === "hub"
                    ? `Hugging Face dataset / ${config.hubSubset || "…"} / ${config.hubSplit || "train"}`
                    : source.kind === "file"
                      ? `Local file · ${source.data.rows.length.toLocaleString()} rows · ${source.data.columns.length} columns`
                      : "Training file made by Conduit"}
                </span>
              </div>
              {preview && (
                <button className="linkbtn tchosen__act" onPointerDown={() => setViewing(true)}>
                  <Icon.search /> View dataset
                </button>
              )}
              <button className="linkbtn tchosen__act" onPointerDown={() => setSource(null)}>
                Clear
              </button>
            </div>
          )}

          {source?.kind === "hub" && (
            <div className="tfields tfields--three">
              <div className="tfield">
                <Label hint="Some datasets come in several versions or languages.">Subset</Label>
                <select className="tselect tselect--native" value={config.hubSubset} onChange={(e) => set({ hubSubset: e.target.value })}>
                  {subsets.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="tfield">
                <Label hint="The part of the dataset to learn from.">Train split</Label>
                <select className="tselect tselect--native" value={config.hubSplit} onChange={(e) => set({ hubSplit: e.target.value })}>
                  {splitNames.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="tfield">
                <Label hint="Scored during training to show whether the model is learning or memorising.">Evaluation split</Label>
                <select className="tselect tselect--native" value={config.hubEvalSplit} onChange={(e) => set({ hubEvalSplit: e.target.value })}>
                  <option value="">None</option>
                  {splitNames
                    .filter((s) => s !== config.hubSplit)
                    .map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                </select>
              </div>
            </div>
          )}

          {preview && source && source.kind !== "saved" && (
            <div className="tadv">
              <button className="tadv__toggle" aria-expanded={advanced} onPointerDown={() => setAdvanced(!advanced)}>
                <Icon.chevron /> Advanced
              </button>
              <AnimatePresence initial={false}>
                {advanced && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={SPRING}>
                    <Mapping columns={preview.columns} config={config} set={set} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </>
      )}

      <AnimatePresence>
        {viewing && preview && <DatasetViewer rows={preview} config={config} onClose={() => setViewing(false)} />}
      </AnimatePresence>
    </Card>
  );
}

function Mapping({ columns, config, set }: { columns: string[]; config: TuneConfig; set: (patch: Partial<TuneConfig>) => void }) {
  const pick = (label: string, hint: string, value: string, onChange: (v: string) => void, optional: boolean) => (
    <div className="tfield">
      <Label hint={hint}>{label}</Label>
      <select className="tselect tselect--native" value={value} onChange={(e) => onChange(e.target.value)}>
        {optional && <option value="">None</option>}
        {columns.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
    </div>
  );
  if (config.method === "cpt") {
    return (
      <div className="tfields tfields--three tmap">
        {pick("Text column", "The column with the text to learn from.", config.mapPrompt, (mapPrompt) => set({ mapPrompt }), false)}
      </div>
    );
  }
  return (
    <div className="tfields tfields--four tmap">
      {pick("Question or conversation", "The user's turn, or a column holding a whole conversation.", config.mapPrompt, (mapPrompt) => set({ mapPrompt }), false)}
      {pick("Answer", "The model's turn. Not needed when the first column is a conversation.", config.mapResponse, (mapResponse) => set({ mapResponse }), true)}
      {pick("Extra context", "Appended to the question, like Alpaca's input column.", config.mapContext, (mapContext) => set({ mapContext }), true)}
      {pick("Instruction", "A system message, if the dataset has one.", config.mapSystem, (mapSystem) => set({ mapSystem }), true)}
    </div>
  );
}

/** The rows as they are, and as the model will see them. */
function DatasetViewer({ rows, config, onClose }: { rows: DatasetRows; config: TuneConfig; onClose: () => void }) {
  const [view, setView] = useState<"model" | "raw">("model");
  const examples = useMemo(
    () =>
      rows.rows.slice(0, 8).map((row) =>
        config.method === "cpt"
          ? [{ role: "text", content: String(row[config.mapPrompt] ?? "") }]
          : rowToChat(row, {
              prompt: config.mapPrompt,
              response: config.mapResponse,
              system: config.mapSystem || undefined,
              context: config.mapContext || undefined,
            }),
      ),
    [rows, config],
  );
  return (
    <motion.div className="dialog-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onPointerDown={onClose}>
      <motion.div
        className="tviewer"
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={SPRING}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <header className="tviewer__head">
          <b>Dataset preview</b>
          <span className="muted">{rows.total ? `${rows.total.toLocaleString()} rows` : `${rows.rows.length} rows`} · first 8 shown</span>
          <span className="spacer" />
          <Segmented
            id="viewer"
            value={view}
            options={[
              ["model", "As training examples"],
              ["raw", "Raw rows"],
            ]}
            onChange={setView}
          />
          <button className="acct__close" aria-label="Close" onPointerDown={onClose}>
            <Icon.close />
          </button>
        </header>
        <div className="tviewer__body">
          {view === "model"
            ? examples.map((turns, i) => (
                <div key={i} className="tune__example">
                  {turns.length ? (
                    turns.map((t, j) => (
                      <div key={j} className="tune__turn" data-role={t.role}>
                        <em>{t.role === "assistant" ? "model" : t.role}</em>
                        <span>{t.content.length > 400 ? `${t.content.slice(0, 400)}…` : t.content}</span>
                      </div>
                    ))
                  ) : (
                    <span className="muted">This row does not become an example with the current columns.</span>
                  )}
                </div>
              ))
            : (
              <div className="tviewer__table">
                <table>
                  <thead>
                    <tr>
                      {rows.columns.map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.rows.slice(0, 8).map((row, i) => (
                      <tr key={i}>
                        {rows.columns.map((c) => {
                          const v = row[c];
                          const text = typeof v === "string" ? v : JSON.stringify(v);
                          return <td key={c}>{text && text.length > 160 ? `${text.slice(0, 160)}…` : text}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// --- parameters ------------------------------------------------------------------------

function ParametersCard({ config, set, touchOutput }: { config: TuneConfig; set: (patch: Partial<TuneConfig>) => void; touchOutput: () => void }) {
  const [mode, setMode] = useState<"simple" | "advanced">("simple");
  const num = (label: string, hint: string, key: keyof TuneConfig, step: number) => (
    <div className="tfield">
      <Label hint={hint}>{label}</Label>
      <input
        className="tinput tinput--mono"
        type="number"
        step={step}
        value={config[key] as number}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) set({ [key]: v } as Partial<TuneConfig>);
        }}
      />
    </div>
  );

  return (
    <Card
      icon={<Icon.sliders />}
      tone="amber"
      title="Parameters"
      sub="Configure training parameters"
      aside={
        <Segmented
          id="params"
          value={mode}
          options={[
            ["simple", "Simple"],
            ["advanced", "Advanced"],
          ]}
          onChange={setMode}
        />
      }
    >
      <div className="tfields tfields--two">
        <div className="tfield">
          <Label hint="Names the run in History and its output folder.">
            Project name <em className="toptional">Optional</em>
          </Label>
          <input className="tinput" placeholder="customer-support-lora" value={config.name} onChange={(e) => set({ name: e.target.value })} />
        </div>

        <div className="tfield">
          <span className="tlabel tlabel--row">
            <Label hint={config.useEpochs ? "Passes over the whole dataset." : "Optimiser steps. 60 is a quick first run; a few hundred for real results."}>
              {config.useEpochs ? "Epochs" : "Max steps"}
            </Label>
            <button className="linkbtn tlabel__link" onPointerDown={() => set({ useEpochs: !config.useEpochs })}>
              {config.useEpochs ? "Use steps" : "Use epochs"}
            </button>
            <input
              className="tinput tinput--mini tinput--mono"
              type="number"
              min={1}
              value={config.useEpochs ? config.epochs : config.maxSteps}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (!Number.isFinite(v) || v <= 0) return;
                set(config.useEpochs ? { epochs: v } : { maxSteps: Math.round(v) });
              }}
            />
          </span>
          <input
            className="trange"
            type="range"
            min={config.useEpochs ? 1 : 10}
            max={config.useEpochs ? 10 : 2000}
            step={config.useEpochs ? 1 : 10}
            value={config.useEpochs ? config.epochs : config.maxSteps}
            style={{ ["--fill" as string]: `${config.useEpochs ? ((config.epochs - 1) / 9) * 100 : ((config.maxSteps - 10) / 1990) * 100}%` }}
            onChange={(e) => set(config.useEpochs ? { epochs: Number(e.target.value) } : { maxSteps: Number(e.target.value) })}
          />
        </div>

        <div className="tfield">
          <Label hint="The longest example the model sees. Longer costs memory.">Context length</Label>
          <select className="tselect tselect--native tinput--mono" value={config.sequenceLength} onChange={(e) => set({ sequenceLength: Number(e.target.value) })}>
            {CONTEXT_LENGTHS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        {num("Learning rate", "2e-4 suits LoRA and QLoRA; a full fine-tune wants about 1e-5.", "learningRate", 1e-5)}
      </div>

      <AnimatePresence initial={false}>
        {mode === "advanced" && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={SPRING}>
            <div className="tfields tfields--four tfields--gap">
              {num("Batch size", "Examples per step on the GPU.", "batchSize", 1)}
              {num("Gradient accumulation", "Steps added together before an update: a bigger batch without more memory.", "gradientAccumulation", 1)}
              {config.method !== "full" && num("LoRA rank", "How big the adapter is. 16 is a good default.", "rank", 4)}
              {config.method !== "full" && num("LoRA alpha", "Scale of the adapter, usually twice the rank.", "alpha", 4)}
              {config.method !== "full" && num("LoRA dropout", "0 is fastest and usually fine.", "dropout", 0.05)}
              {num("Warmup steps", "Steps spent ramping the learning rate up.", "warmupSteps", 1)}
              {num("Weight decay", "A little regularisation.", "weightDecay", 0.01)}
              {num("Seed", "Fixes the randomness so a run can be repeated.", "seed", 1)}
            </div>
            <div className="tfield tfield--wide tfields--gap">
              <Label hint="Where the adapter and checkpoints are written.">Output folder</Label>
              <input
                className="tinput tinput--mono"
                value={config.output}
                spellCheck={false}
                onChange={(e) => {
                  touchOutput();
                  set({ output: e.target.value });
                }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

function ConfigurationCard({ config, replace }: { config: TuneConfig; replace: (c: TuneConfig) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);

  const save = async () => {
    const yaml = toYaml(config);
    const name = slugify(config.name || config.model.split("/").pop() || "training");
    if (isTauri()) {
      const path = `${await trainingDir()}/configs/${name}.yaml`;
      await invoke("fs_write", { path, contents: yaml });
      setNote(`Saved ${path}`);
    } else {
      const url = URL.createObjectURL(new Blob([yaml], { type: "text/yaml" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name}.yaml`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <Card icon={<Icon.file />} tone="teal" title="Configuration" sub="Save and load configurations">
      <div className="tactions">
        <button className="tbtn" onPointerDown={() => input.current?.click()}>
          <Icon.download /> Load YAML
        </button>
        <button className="tbtn" onPointerDown={() => void save()}>
          <Icon.file /> Save YAML
        </button>
        <button
          className="tbtn"
          onPointerDown={() => {
            replace({ ...DEFAULTS, output: config.output });
            setNote("Back to the defaults.");
          }}
        >
          <Icon.refresh /> Reset to defaults
        </button>
        <input
          ref={input}
          type="file"
          accept=".yaml,.yml"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            replace(fromYaml(await f.text()));
            setNote(`Loaded ${f.name}`);
          }}
        />
      </div>
      {note && <p className="tnote">{note}</p>}
    </Card>
  );
}

// --- run preview ------------------------------------------------------------------------

function RunPreview({
  config,
  source,
  issues,
  vramGb,
  gpu,
  envReady,
  starting,
  error,
  onStart,
  nvidia,
}: {
  config: TuneConfig;
  source: Source | null;
  issues: string[];
  vramGb: number | null;
  gpu: string | null;
  envReady: boolean;
  starting: boolean;
  error: string | null;
  onStart: () => void;
  nvidia: boolean;
}) {
  const env = useTraining((s) => s.env);
  const installing = useTraining((s) => s.installing);
  const busy = useTraining((s) => s.current?.status === "running" || s.current?.status === "starting");
  const method = METHODS.find((m) => m.id === config.method)!;
  const params = parametersFromName(config.model);
  const fit = params ? estimate(params, config, vramGb) : null;
  const custom = (["batchSize", "gradientAccumulation", "rank", "alpha", "dropout", "warmupSteps", "weightDecay", "seed"] as const).some(
    (k) => config[k] !== DEFAULTS[k],
  );
  const ready = issues.length === 0 && envReady && !busy;
  const datasetName =
    source?.kind === "hub"
      ? source.id
      : source?.kind === "file"
        ? source.name
        : source?.kind === "saved"
          ? source.path.split("/").pop()
          : source?.kind === "chats"
            ? "Your chats"
            : null;
  const [owner, name] = datasetName?.includes("/") ? datasetName.split("/") : [null, datasetName];

  let button = "Start Training";
  if (busy) button = "Training is running";
  else if (starting) button = "Starting…";
  else if (!env.checked) button = "Checking Python…";

  return (
    <aside className="tpreview">
      <div className="tpreview__card">
        <div className="tpreview__top">
          <span>Run preview</span>
          <span className="tbadge" data-ready={ready}>
            {ready ? "Ready" : "Not ready"}
          </span>
        </div>

        <span className="tpreview__family">{family(config.model)}</span>
        <b className="tpreview__model">{config.model.split(/[\\/]/).pop()}</b>
        {datasetName && (
          <>
            {owner && <span className="tpreview__owner">{owner.toUpperCase()}</span>}
            <span className="tpreview__dataset">
              {name}
              {source?.kind === "hub" && <em> · {config.hubSplit || "train"}</em>}
            </span>
          </>
        )}

        <dl className="tpreview__rows">
          <dt>Method</dt>
          <dd>
            {method.label} <em>· {method.bits}</em>
          </dd>
          <dt>Length</dt>
          <dd>{config.useEpochs ? `${config.epochs} epoch${config.epochs === 1 ? "" : "s"}` : `${config.maxSteps} steps`}</dd>
          <dt>Batch</dt>
          <dd className="mono">
            {config.batchSize} <em>×</em> {config.gradientAccumulation} <em>=</em> {effectiveBatch(config)}
          </dd>
          <dt>Context</dt>
          <dd className="mono">{config.sequenceLength.toLocaleString("en-US")}</dd>
          <dt>LR</dt>
          <dd className="mono">{formatLr(config.learningRate)}</dd>
          <dt>Advanced settings</dt>
          <dd>{custom ? "Custom" : "Defaults"}</dd>
        </dl>

        <dl className="tpreview__rows tpreview__rows--gap">
          <dt>Hardware</dt>
          <dd>{gpu ? `${gpu}${vramGb ? ` · ${vramGb} GiB` : ""}` : "GPU not detected"}</dd>
          {fit && (
            <>
              <dt>Memory</dt>
              <dd className={fit.fits ? "tfit tfit--ok" : "tfit tfit--bad"} title={fit.note}>
                ≈ {fit.needed} GiB {vramGb ? (fit.fits ? "· fits" : "· too much") : ""}
              </dd>
            </>
          )}
          <dt>HF token</dt>
          <dd>{keyKnown("huggingface") ? "Set" : "Not set"}</dd>
        </dl>

        <span className="tpreview__section">Files</span>
        <dl className="tpreview__rows">
          <dt>
            <span className="tstate" data-ok={Boolean(datasetName)} /> Dataset
          </dt>
          <dd>{!datasetName ? "Not chosen" : source?.kind === "saved" ? "Ready" : "Continues on start"}</dd>
          <dt>
            <span className="tstate" data-ok={envReady} /> Python
          </dt>
          <dd>{!env.checked ? "Checking…" : env.python ? (env.missing.length ? `${env.python} · ${env.missing.length} missing` : `${env.python}${env.cuda ? " · CUDA" : ""}`) : "Not found"}</dd>
        </dl>

        {env.checked && !envReady && (
          <div className="tsetup">
            {env.python ? (
              <>
                <span>Missing: {env.missing.join(", ")}</span>
                <button className="tbtn tbtn--small" disabled={installing} onPointerDown={() => void installPackages(nvidia)}>
                  {installing ? <span className="spin" /> : <Icon.download />} {installing ? "Installing…" : "Install packages"}
                </button>
              </>
            ) : (
              <>
                <span>Training needs Python 3.10 or newer on PATH.</span>
                <button className="tbtn tbtn--small" onPointerDown={() => void invoke("open_target", { target: "https://www.python.org/downloads/" }).catch(() => undefined)}>
                  <Icon.external /> Get Python
                </button>
                <button className="linkbtn" onPointerDown={() => void checkEnvironment()}>
                  Check again
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="tpreview__foot">
        {issues.length > 0 && !busy && <p className="tpreview__issue">{issues[0]}</p>}
        {error && <p className="tpreview__issue tpreview__issue--bad">{error}</p>}
        <button className="tstart" disabled={!ready || starting} onPointerDown={onStart}>
          {starting ? <span className="spin spin--ink" /> : <Icon.play />}
          {button}
        </button>
      </div>
    </aside>
  );
}

// --- current run ---------------------------------------------------------------------------

function Current({ onConfigure }: { onConfigure: () => void }) {
  const run = useTraining((s) => s.current);
  const log = useTraining((s) => s.log);
  const installing = useTraining((s) => s.installing);
  const logRef = useRef<HTMLPreElement>(null);
  const [now, setNow] = useState(Date.now());
  const [showScript, setShowScript] = useState(false);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    const el = logRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 60) el.scrollTop = el.scrollHeight;
  }, [log]);

  if (!run && !installing) {
    return (
      <div className="tempty">
        <Icon.chart />
        <b>No run yet</b>
        <span>Configure a model and a dataset, then press Start Training. Progress, loss and the log appear here.</span>
        <button className="tbtn" onPointerDown={onConfigure}>
          Configure a run
        </button>
      </div>
    );
  }

  const active = run?.status === "running" || run?.status === "starting";
  const share = run && run.maxSteps ? Math.min(1, run.step / run.maxSteps) : 0;
  const last = run?.loss.at(-1)?.loss;
  const elapsed = run ? ((run.endedAt ?? now) - run.startedAt) / 1000 : 0;
  const perStep = run && run.step ? elapsed / run.step : 0;
  const remaining = run && run.maxSteps && run.step && active ? perStep * (run.maxSteps - run.step) : 0;

  return (
    <div className="trun">
      {run && (
        <section className="tcard trun__head">
          <div className="trun__title">
            <div>
              <span className="tpreview__family">{family(run.model)}</span>
              <b>{run.name}</b>
              <span className="muted">
                {run.model} · {run.dataset.split(/[\\/]/).pop()} · {METHODS.find((m) => m.id === run.method)?.label}
              </span>
            </div>
            <span className="tbadge" data-status={run.status}>
              {STATUS[run.status]}
            </span>
          </div>

          <div className="trun__bar" role="progressbar" aria-valuenow={Math.round(share * 100)} aria-valuemin={0} aria-valuemax={100}>
            <motion.span animate={{ width: `${share * 100}%` }} transition={{ duration: 0.4 }} />
          </div>

          <div className="trun__stats">
            <Stat label="Step" value={run.maxSteps ? `${run.step} / ${run.maxSteps}` : String(run.step)} />
            <Stat label="Loss" value={last !== undefined ? last.toFixed(4) : "—"} />
            <Stat label="Eval loss" value={run.evalLoss.at(-1)?.loss.toFixed(4) ?? "—"} />
            <Stat label="Learning rate" value={run.learningRate !== undefined ? formatLr(run.learningRate) : "—"} />
            <Stat label="Elapsed" value={duration(elapsed)} />
            <Stat label={active ? "Remaining" : "Epoch"} value={active ? (remaining ? `≈ ${duration(remaining)}` : "—") : (run.epoch?.toFixed(2) ?? "—")} />
          </div>

          <LossChart loss={run.loss} evalLoss={run.evalLoss} />

          {run.error && <div className="result result--bad">{run.error}</div>}

          <div className="tactions">
            {active ? (
              <button className="tbtn tbtn--danger" onPointerDown={() => void stopRun()}>
                <Icon.stop /> Stop training
              </button>
            ) : (
              <button className="tbtn" onPointerDown={onConfigure}>
                <Icon.refresh /> New run
              </button>
            )}
            <button className="tbtn" onPointerDown={() => void invoke("open_target", { target: run.output }).catch(() => undefined)}>
              <Icon.folder /> Open output folder
            </button>
            <button className="linkbtn" onPointerDown={() => setShowScript(!showScript)}>
              {showScript ? "Hide the script" : "Read the script"}
            </button>
          </div>

          {showScript && (
            <div className="codebox">
              <pre>{trainingScript(run.config)}</pre>
            </div>
          )}

          {run.status === "done" && (
            <details className="tune__after" open>
              <summary>Next: turn it into a model Conduit can load</summary>
              <p className="block__sub">
                The result is an adapter. These merge it into the base model and convert it to GGUF; they need the llama.cpp repository
                checked out next to the output folder. Then load the .gguf file from Model hub.
              </p>
              <div className="codebox">
                <pre>{conversionSteps(run.config).join("\n\n")}</pre>
              </div>
            </details>
          )}
        </section>
      )}

      <section className="tcard trun__log">
        <header className="tcard__head">
          <span className="tcard__icon" data-tone="teal">
            <Icon.terminal />
          </span>
          <div className="tcard__titles">
            <b>{installing ? "Installing packages" : "Log"}</b>
            <span>{installing ? "pip is working; this can take a few minutes for PyTorch." : "Everything the training process writes."}</span>
          </div>
        </header>
        <pre ref={logRef} className="trun__pre">
          {log.join("\n") || "Waiting for output…"}
        </pre>
      </section>
    </div>
  );
}

const STATUS: Record<Run["status"], string> = {
  starting: "Starting",
  running: "Training",
  done: "Finished",
  failed: "Failed",
  stopped: "Stopped",
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="tstat">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

/** Loss over steps; the evaluation loss, when there is one, dashed on top. */
function LossChart({ loss, evalLoss, small = false }: { loss: Point[]; evalLoss?: Point[]; small?: boolean }) {
  const width = small ? 120 : 640;
  const height = small ? 32 : 200;
  const pad = small ? 2 : 28;
  const all = [...loss, ...(evalLoss ?? [])];
  if (loss.length < 2) {
    return small ? <span className="tspark tspark--empty" /> : <div className="tchart tchart--empty">The loss curve appears after the first logged steps.</div>;
  }
  const maxStep = Math.max(...all.map((p) => p.step));
  const minStep = Math.min(...all.map((p) => p.step));
  const values = all.map((p) => p.loss);
  const hi = Math.max(...values);
  const lo = Math.min(...values);
  const x = (s: number) => pad + ((s - minStep) / Math.max(1, maxStep - minStep)) * (width - pad * 2);
  const y = (v: number) => pad / 2 + (1 - (v - lo) / Math.max(1e-9, hi - lo)) * (height - pad * 1.5);
  const path = (points: Point[]) => points.map((p, i) => `${i ? "L" : "M"}${x(p.step).toFixed(1)},${y(p.loss).toFixed(1)}`).join(" ");
  const area = `${path(loss)} L${x(loss.at(-1)!.step).toFixed(1)},${height - pad} L${x(loss[0].step).toFixed(1)},${height - pad} Z`;

  if (small) {
    return (
      <svg className="tspark" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={path(loss)} />
      </svg>
    );
  }
  return (
    <figure className="tchart">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`Loss from ${loss[0].loss.toFixed(3)} to ${loss.at(-1)!.loss.toFixed(3)}`}>
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={pad} x2={width - pad} y1={y(lo + (hi - lo) * t)} y2={y(lo + (hi - lo) * t)} className="tchart__grid" />
            <text x={2} y={y(lo + (hi - lo) * t) + 3} className="tchart__tick">
              {(lo + (hi - lo) * t).toFixed(2)}
            </text>
          </g>
        ))}
        <path d={area} className="tchart__area" />
        <path d={path(loss)} className="tchart__line" />
        {evalLoss && evalLoss.length > 1 && <path d={path(evalLoss)} className="tchart__eval" />}
      </svg>
      <figcaption>
        <span className="tchart__key" /> Training loss
        {evalLoss && evalLoss.length > 1 && (
          <>
            <span className="tchart__key tchart__key--eval" /> Evaluation loss
          </>
        )}
        <span className="spacer" />
        steps {minStep}–{maxStep}
      </figcaption>
    </figure>
  );
}

// --- history -----------------------------------------------------------------------------

function History({ onLoad }: { onLoad: (run: Run) => void }) {
  const history = useTraining((s) => s.history);
  if (!history.length) {
    return (
      <div className="tempty">
        <Icon.clock />
        <b>No runs yet</b>
        <span>Every run is kept here with its settings and its loss curve, so you can compare them and run one again.</span>
      </div>
    );
  }
  return (
    <div className="thistory">
      {history.map((run) => (
        <div key={run.id} className="thistory__row">
          <span className="tbadge" data-status={run.status}>
            {STATUS[run.status]}
          </span>
          <div className="thistory__text">
            <b>{run.name}</b>
            <span>
              {run.model} · {run.dataset.split(/[\\/]/).pop()} · {METHODS.find((m) => m.id === run.method)?.label}
            </span>
          </div>
          <LossChart loss={run.loss} small />
          <div className="thistory__meta">
            <span>{run.loss.at(-1) ? `loss ${run.loss.at(-1)!.loss.toFixed(3)}` : "no loss logged"}</span>
            <span>
              {new Date(run.startedAt).toLocaleDateString([], { day: "numeric", month: "short" })} · {duration(((run.endedAt ?? run.startedAt) - run.startedAt) / 1000)}
            </span>
          </div>
          <div className="thistory__acts">
            <button className="tbtn tbtn--small" onPointerDown={() => onLoad(run)} title="Put this run's settings back on Configure">
              <Icon.refresh /> Run again
            </button>
            <button className="tbtn tbtn--small" onPointerDown={() => void invoke("open_target", { target: run.output }).catch(() => undefined)}>
              <Icon.folder />
            </button>
            <button className="tbtn tbtn--small" aria-label="Remove from history" onPointerDown={() => forgetRun(run.id)}>
              <Icon.trash />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// --- small helpers ------------------------------------------------------------------------

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatLr(v: number): string {
  if (!v) return "0";
  const exp = Math.floor(Math.log10(Math.abs(v)));
  const mant = v / 10 ** exp;
  return `${Number(mant.toFixed(2))}e${exp}`;
}

function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
