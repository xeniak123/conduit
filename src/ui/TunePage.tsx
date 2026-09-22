import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "motion/react";
import { isTauri } from "@/core/host";
import { useApp } from "@/core/store";
import {
  DATASET_SHELVES,
  collectRows,
  conversationsToJsonl,
  datasetRows,
  datasetSplits,
  guessMapping,
  parseLocalDataset,
  searchDatasets,
  slugify,
  toChatJsonl,
  type ColumnMapping,
  type DatasetRows,
  type HubDataset,
} from "@/data/datasets";
import {
  DEFAULTS,
  METHODS,
  PACKAGES,
  conversionSteps,
  estimate,
  parametersFromName,
  problems,
  trainingScript,
  type TuneConfig,
} from "@/data/tune";
import { detectHardware, useRuntime } from "@/models/runtime";
import { Icon } from "./icons";
import { Problem } from "./Problem";
import { SPRING, SPRING_SNAP } from "./motion";

/**
 * Fine-tuning, from data to a model Conduit can run.
 *
 * Three steps down the page, in the order the work actually happens: get
 * training data into one clean file, choose what to teach and how, then run a
 * script you can read. The column on the right keeps the one question that
 * decides everything else in view — will this fit on this machine — and
 * answers it before anything is downloaded.
 */

type Source = "hub" | "file" | "chats";

interface Built {
  path: string;
  count: number;
  label: string;
}

const BASES = [
  "unsloth/Qwen3-4B-Instruct",
  "unsloth/Qwen3-8B",
  "unsloth/Llama-3.2-3B-Instruct",
  "unsloth/gemma-3-4b-it",
  "HuggingFaceTB/SmolLM3-3B",
];

const SIZES = [100, 500, 1000, 2000];

async function dataDir(): Promise<string> {
  return isTauri() ? invoke<string>("data_dir") : "C:/Users/you/AppData/Roaming/conduit";
}

export function TunePage() {
  const [source, setSource] = useState<Source>("hub");
  const [built, setBuilt] = useState<Built | null>(null);
  const [config, setConfig] = useState<TuneConfig>(DEFAULTS);
  const hardware = useRuntime((s) => s.hardware);

  useEffect(() => {
    void detectHardware().catch(() => undefined);
  }, []);

  // The output folder follows the model until the user types their own.
  const outputTouched = useRef(false);
  useEffect(() => {
    if (outputTouched.current) return;
    void dataDir().then((dir) =>
      setConfig((c) => ({ ...c, output: `${dir}/training/${slugify(c.model.split("/").pop() ?? "run")}` })),
    );
  }, [config.model]);

  useEffect(() => {
    if (built) setConfig((c) => ({ ...c, dataset: built.path }));
  }, [built]);

  const set = (patch: Partial<TuneConfig>) => setConfig((c) => ({ ...c, ...patch }));

  return (
    <div className="page page--wide">
      <header className="page__head">
        <div>
          <h1 className="page__title">Fine-tune</h1>
          <p className="page__sub">
            Teach a model your data with LoRA, QLoRA or a full fine-tune. Conduit prepares the data, checks it fits on
            this machine and writes a plain training script you can read and keep.
          </p>
        </div>
      </header>

      <div className="tune">
        <div className="tune__main">
          <section className="tune__step">
            <StepHead n={1} title="Training data" done={Boolean(built)}>
              {built ? `${built.count.toLocaleString()} examples from ${built.label}` : "One file of example conversations."}
            </StepHead>

            <div className="seg tune__seg">
              {(
                [
                  ["hub", "Hugging Face"],
                  ["file", "A file on this computer"],
                  ["chats", "Your chats"],
                ] as Array<[Source, string]>
              ).map(([id, label]) => (
                <button key={id} className="seg__item" aria-current={source === id} onPointerDown={() => setSource(id)}>
                  {source === id && <motion.span layoutId="tune-source" className="seg__pill" transition={SPRING_SNAP} />}
                  <span>{label}</span>
                </button>
              ))}
            </div>

            {source === "hub" && <HubSource onBuilt={setBuilt} />}
            {source === "file" && <FileSource onBuilt={setBuilt} />}
            {source === "chats" && <ChatSource onBuilt={setBuilt} />}
          </section>

          <section className="tune__step">
            <StepHead n={2} title="Model and method" done={Boolean(config.model.trim())}>
              What to start from, and how much of it to train.
            </StepHead>

            <label className="form">
              <span>Base model on Hugging Face</span>
              <input
                className="input input--mono"
                value={config.model}
                list="tune-bases"
                spellCheck={false}
                onChange={(e) => set({ model: e.target.value })}
              />
              <datalist id="tune-bases">
                {BASES.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </label>

            <div className="tune__methods">
              {METHODS.map((m) => (
                <button
                  key={m.id}
                  className="tune__method"
                  aria-pressed={config.method === m.id}
                  onPointerDown={() =>
                    set({ method: m.id, learningRate: m.id === "full" ? 1e-5 : config.method === "full" ? 2e-4 : config.learningRate })
                  }
                >
                  <b>{m.label}</b>
                  <span>{m.detail}</span>
                </button>
              ))}
            </div>

            <div className="tune__grid">
              <Num label="Epochs" value={config.epochs} step={1} min={1} onChange={(epochs) => set({ epochs })} />
              <Num
                label="Learning rate"
                value={config.learningRate}
                step={config.method === "full" ? 1e-6 : 1e-5}
                min={0}
                onChange={(learningRate) => set({ learningRate })}
              />
              <Num label="Batch size" value={config.batchSize} step={1} min={1} onChange={(batchSize) => set({ batchSize })} />
              <Num
                label="Gradient accumulation"
                value={config.gradientAccumulation}
                step={1}
                min={1}
                onChange={(gradientAccumulation) => set({ gradientAccumulation })}
              />
              <Num
                label="Sequence length"
                value={config.sequenceLength}
                step={256}
                min={256}
                onChange={(sequenceLength) => set({ sequenceLength })}
              />
              {config.method !== "full" && (
                <>
                  <Num label="LoRA rank" value={config.rank} step={4} min={1} onChange={(rank) => set({ rank, alpha: rank * 2 })} />
                  <Num label="LoRA alpha" value={config.alpha} step={4} min={1} onChange={(alpha) => set({ alpha })} />
                </>
              )}
            </div>
          </section>

          <section className="tune__step">
            <StepHead n={3} title="Run it" done={false}>
              A script in your own folder, run in a terminal you can watch and close.
            </StepHead>
            <label className="form">
              <span>Where the result goes</span>
              <input
                className="input input--mono"
                value={config.output}
                spellCheck={false}
                onChange={(e) => {
                  outputTouched.current = true;
                  set({ output: e.target.value });
                }}
              />
            </label>
            <Runner config={config} />
          </section>
        </div>

        <Summary config={config} vram={hardware && hardware.vram > 0 ? Math.round(hardware.vram / 1024) : null} gpu={hardware?.gpu ?? null} />
      </div>
    </div>
  );
}

function StepHead({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <div className="tune__head">
      <span className="tune__n" data-done={done}>
        {done ? <Icon.check /> : n}
      </span>
      <div>
        <h3 className="block__title">{title}</h3>
        <p className="block__sub">{children}</p>
      </div>
    </div>
  );
}

function Num({
  label,
  value,
  step,
  min,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  min: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="form">
      <span>{label}</span>
      <input
        className="input input--mono"
        type="number"
        value={value}
        step={step}
        min={min}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
      />
    </label>
  );
}

/** Writes a finished JSONL file into Conduit's datasets folder. */
async function saveTrainingFile(name: string, jsonl: string): Promise<string> {
  const path = `${await dataDir()}/datasets/${slugify(name)}.jsonl`;
  if (isTauri()) await invoke("fs_write", { path, contents: jsonl });
  return path;
}

// --- sources -------------------------------------------------------------------

function HubSource({ onBuilt }: { onBuilt: (b: Built) => void }) {
  const [query, setQuery] = useState("");
  const [shelf, setShelf] = useState(DATASET_SHELVES[0].id);
  const [results, setResults] = useState<HubDataset[]>([]);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [picked, setPicked] = useState<HubDataset | null>(null);
  const ticket = useRef(0);

  useEffect(() => {
    const q = query.trim() || DATASET_SHELVES.find((s) => s.id === shelf)?.query || "";
    const mine = ++ticket.current;
    setLoading(true);
    setProblem(null);
    // Typing is debounced; only the newest search may write its results, so
    // a slow early answer can never replace a fast later one.
    const t = window.setTimeout(() => {
      searchDatasets(q)
        .then((r) => mine === ticket.current && setResults(r))
        .catch((e) => mine === ticket.current && setProblem(e instanceof Error ? e.message : String(e)))
        .finally(() => mine === ticket.current && setLoading(false));
    }, query ? 300 : 0);
    return () => window.clearTimeout(t);
  }, [query, shelf]);

  if (picked) return <DatasetDetail dataset={picked} onBack={() => setPicked(null)} onBuilt={onBuilt} />;

  return (
    <div className="tune__source">
      <div className="searchbox">
        <Icon.search />
        <input placeholder="Search datasets on Hugging Face" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {!query && (
        <div className="chips">
          {DATASET_SHELVES.map((s) => (
            <button key={s.id} className="chip" aria-pressed={shelf === s.id} onPointerDown={() => setShelf(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
      )}
      {problem && <Problem error={problem} />}
      <div className="tune__list" aria-busy={loading}>
        {loading && !results.length
          ? Array.from({ length: 5 }, (_, i) => <div key={i} className="tune__skel" />)
          : results.slice(0, 20).map((d) => (
              <button key={d.id} className="tune__row" onPointerDown={() => setPicked(d)}>
                <span className="tune__rowtext">
                  <b>{d.name}</b>
                  <span>{d.author}</span>
                </span>
                <span className="tune__rowmeta">
                  <Icon.download /> {compact(d.downloads)}
                  <Icon.heart /> {compact(d.likes)}
                </span>
              </button>
            ))}
        {!loading && !results.length && !problem && <div className="emptyline">Nothing matches that.</div>}
      </div>
    </div>
  );
}

function DatasetDetail({ dataset, onBack, onBuilt }: { dataset: HubDataset; onBack: () => void; onBuilt: (b: Built) => void }) {
  const [splits, setSplits] = useState<Array<{ config: string; split: string }>>([]);
  const [chosen, setChosen] = useState(0);
  const [preview, setPreview] = useState<DatasetRows | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [size, setSize] = useState(500);
  const [progress, setProgress] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    setProblem(null);
    datasetSplits(dataset.id)
      .then((s) => {
        setSplits(s);
        // "train" when there is one: it is what almost everybody means.
        const train = s.findIndex((x) => x.split === "train");
        setChosen(train >= 0 ? train : 0);
      })
      .catch((e) => setProblem(e instanceof Error ? e.message : String(e)));
    return () => abort.current?.abort();
  }, [dataset.id]);

  const split = splits[chosen];
  useEffect(() => {
    if (!split) return;
    setPreview(null);
    datasetRows(dataset.id, split.config, split.split, 8)
      .then((rows) => {
        setPreview(rows);
        setMapping(guessMapping(rows.columns));
      })
      .catch((e) => setProblem(e instanceof Error ? e.message : String(e)));
  }, [dataset.id, split?.config, split?.split]);

  const build = async () => {
    if (!split || !mapping) return;
    abort.current = new AbortController();
    setProgress(0);
    setProblem(null);
    try {
      const rows = await collectRows(dataset.id, split.config, split.split, size, setProgress, abort.current.signal);
      const jsonl = toChatJsonl(rows.rows, mapping);
      const count = jsonl ? jsonl.split("\n").length : 0;
      if (!count) throw new Error("None of those rows became a conversation. Check which columns hold the question and the answer.");
      const path = await saveTrainingFile(`${dataset.id}-${split.split}-${count}`, jsonl);
      onBuilt({ path, count, label: dataset.id });
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="tune__source">
      <div className="tune__crumb">
        <button className="linkbtn" onPointerDown={onBack}>
          <Icon.chevron /> All datasets
        </button>
        <b>{dataset.id}</b>
      </div>
      {problem && <Problem error={problem} />}

      {splits.length > 1 && (
        <label className="form">
          <span>Part of the dataset</span>
          <select className="select" value={chosen} onChange={(e) => setChosen(Number(e.target.value))}>
            {splits.map((s, i) => (
              <option key={`${s.config}/${s.split}`} value={i}>
                {s.config === "default" ? s.split : `${s.config} · ${s.split}`}
              </option>
            ))}
          </select>
        </label>
      )}

      {!preview && !problem && <div className="tune__skel tune__skel--tall" />}
      {preview && mapping && (
        <>
          <Mapping columns={preview.columns} mapping={mapping} onChange={setMapping} />
          <Preview rows={preview.rows} mapping={mapping} />
          <div className="tune__build">
            <label className="form">
              <span>How many rows{preview.total ? ` (of ${preview.total.toLocaleString()})` : ""}</span>
              <select className="select" value={size} onChange={(e) => setSize(Number(e.target.value))}>
                {SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n.toLocaleString()}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn btn--ink" disabled={progress !== null} onPointerDown={() => void build()}>
              {progress !== null ? (
                <>
                  <span className="spin spin--ink" /> {progress.toLocaleString()} rows
                </>
              ) : (
                "Make the training file"
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function FileSource({ onBuilt }: { onBuilt: (b: Built) => void }) {
  const [file, setFile] = useState<{ name: string; data: DatasetRows } | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const read = async (f: File) => {
    setProblem(null);
    try {
      const data = parseLocalDataset(await f.text(), f.name);
      if (!data.rows.length) throw new Error("No rows in that file. Conduit reads JSONL, JSON arrays and CSV.");
      setFile({ name: f.name, data });
      setMapping(guessMapping(data.columns));
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };

  const build = async () => {
    if (!file || !mapping) return;
    const jsonl = toChatJsonl(file.data.rows, mapping);
    const count = jsonl ? jsonl.split("\n").length : 0;
    if (!count) {
      setProblem("None of those rows became a conversation. Check which columns hold the question and the answer.");
      return;
    }
    const path = await saveTrainingFile(file.name.replace(/\.[^.]+$/, ""), jsonl);
    onBuilt({ path, count, label: file.name });
  };

  return (
    <div className="tune__source">
      <button
        className="tune__drop"
        onPointerDown={() => input.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) void read(f);
        }}
      >
        <Icon.file />
        <b>{file ? file.name : "Choose or drop a file"}</b>
        <span>{file ? `${file.data.rows.length.toLocaleString()} rows · ${file.data.columns.length} columns` : "JSONL, JSON or CSV"}</span>
      </button>
      <input
        ref={input}
        type="file"
        accept=".jsonl,.json,.csv,.tsv"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void read(f);
          e.target.value = "";
        }}
      />
      {problem && <Problem error={problem} />}
      {file && mapping && (
        <>
          <Mapping columns={file.data.columns} mapping={mapping} onChange={setMapping} />
          <Preview rows={file.data.rows.slice(0, 8)} mapping={mapping} />
          <div className="tune__build">
            <span className="spacer" />
            <button className="btn btn--ink" onPointerDown={() => void build()}>
              Make the training file
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ChatSource({ onBuilt }: { onBuilt: (b: Built) => void }) {
  const conversations = useApp((s) => s.conversations);
  const projects = useApp((s) => s.settings.projects);
  const [project, setProject] = useState<string>("all");
  const [system, setSystem] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const chosen = useMemo(
    () => conversations.filter((c) => project === "all" || c.projectId === project),
    [conversations, project],
  );
  const { jsonl, count } = useMemo(() => conversationsToJsonl(chosen, system), [chosen, system]);

  return (
    <div className="tune__source">
      <p className="block__sub">
        The questions you actually ask, answered the way you kept them. Unfinished answers are left out. Nothing leaves
        this computer: the file is written next to your other Conduit data.
      </p>
      <div className="tune__build">
        <label className="form">
          <span>Which chats</span>
          <select className="select" value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="all">All chats</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="form tune__grow">
          <span>Instruction to train with (optional)</span>
          <input className="input" placeholder="You are my writing assistant." value={system} onChange={(e) => setSystem(e.target.value)} />
        </label>
      </div>
      {problem && <Problem error={problem} />}
      <div className="tune__build">
        <span className="muted">
          {count ? `${count.toLocaleString()} usable conversations` : "No finished conversations to use yet."}
        </span>
        <span className="spacer" />
        <button
          className="btn btn--ink"
          disabled={!count}
          onPointerDown={async () => {
            try {
              const path = await saveTrainingFile(`my-chats-${new Date().toISOString().slice(0, 10)}`, jsonl);
              onBuilt({ path, count, label: "your chats" });
            } catch (e) {
              setProblem(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          Make the training file
        </button>
      </div>
    </div>
  );
}

function Mapping({
  columns,
  mapping,
  onChange,
}: {
  columns: string[];
  mapping: ColumnMapping;
  onChange: (m: ColumnMapping) => void;
}) {
  const pick = (label: string, value: string, set: (v: string) => void, optional = false) => (
    <label className="form">
      <span>{label}</span>
      <select className="select" value={value} onChange={(e) => set(e.target.value)}>
        {optional && <option value="">None</option>}
        {columns.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="tune__mapping">
      {pick("Question or conversation", mapping.prompt, (prompt) => onChange({ ...mapping, prompt }))}
      {pick("Answer", mapping.response, (response) => onChange({ ...mapping, response }), true)}
      {pick("Extra for the question", mapping.context ?? "", (context) => onChange({ ...mapping, context: context || undefined }), true)}
      {pick("Instruction", mapping.system ?? "", (system) => onChange({ ...mapping, system: system || undefined }), true)}
    </div>
  );
}

/** The first rows as the model will see them, so a wrong mapping is obvious at a glance. */
function Preview({ rows, mapping }: { rows: Array<Record<string, unknown>>; mapping: ColumnMapping }) {
  const examples = useMemo(() => {
    const jsonl = toChatJsonl(rows.slice(0, 3), mapping);
    return jsonl ? jsonl.split("\n").map((l) => (JSON.parse(l) as { messages: Array<{ role: string; content: string }> }).messages) : [];
  }, [rows, mapping]);

  if (!examples.length) {
    return <div className="result result--bad">These columns do not make a conversation yet. Pick the question and the answer.</div>;
  }
  return (
    <div className="tune__preview">
      {examples.map((turns, i) => (
        <div key={i} className="tune__example">
          {turns.map((t, j) => (
            <div key={j} className="tune__turn" data-role={t.role}>
              <em>{t.role === "assistant" ? "model" : t.role}</em>
              <span>{t.content.length > 280 ? `${t.content.slice(0, 280)}…` : t.content}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// --- running -------------------------------------------------------------------

function Runner({ config }: { config: TuneConfig }) {
  const found = problems(config);
  const script = useMemo(() => trainingScript(config), [config]);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [showScript, setShowScript] = useState(false);
  const scriptPath = `${config.output}/train.py`;
  const command = `python "${scriptPath}"`;

  const write = async () => {
    if (!isTauri()) throw new Error("Running a training job needs the desktop app.");
    await invoke("fs_write", { path: scriptPath, contents: script });
  };

  return (
    <div className="tune__run">
      {found.length > 0 && (
        <ul className="tune__problems">
          {found.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <div className="tune__cmd">
        <span className="muted">Runs in a new terminal window:</span>
        <code>{command}</code>
      </div>

      <div className="tune__actions">
        <button
          className="btn btn--accent"
          disabled={found.length > 0}
          onPointerDown={async () => {
            try {
              await write();
              // A terminal the user can watch and close, never a process
              // hidden inside the app: training runs for hours.
              await invoke("agent_launch", { program: "python", args: [scriptPath], env: {}, cwd: config.output });
              setStatus({ ok: true, text: "Training started in a new terminal. The first run downloads the base model." });
            } catch (e) {
              setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
            }
          }}
        >
          <Icon.play /> Start training
        </button>
        <button
          className="btn"
          disabled={found.length > 0}
          onPointerDown={async () => {
            try {
              await write();
              setStatus({ ok: true, text: `Saved ${scriptPath}` });
            } catch (e) {
              setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
            }
          }}
        >
          Save script only
        </button>
        <button className="linkbtn" onPointerDown={() => setShowScript(!showScript)}>
          {showScript ? "Hide the script" : "Read the script"}
        </button>
      </div>

      <AnimatePresence>
        {status && (
          <motion.div
            className={`result result--${status.ok ? "ok" : "bad"}`}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
          >
            {status.ok ? status.text : <Problem error={status.text} />}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {showScript && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={SPRING}>
            <div className="codebox">
              <button className="codebox__copy btn btn--small" onPointerDown={() => void navigator.clipboard.writeText(script)}>
                <Icon.copy /> Copy
              </button>
              <pre>{script}</pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <details className="tune__after">
        <summary>After training: turn it into a model Conduit can load</summary>
        <p className="block__sub">
          An adapter is not a model on its own. These merge it into the base weights and convert the result to GGUF;
          they need the llama.cpp repository checked out next to the output folder.
        </p>
        <div className="codebox">
          <pre>{conversionSteps(config).join("\n\n")}</pre>
        </div>
      </details>
    </div>
  );
}

function Summary({ config, vram, gpu }: { config: TuneConfig; vram: number | null; gpu: string | null }) {
  const params = parametersFromName(config.model);
  const fit = params ? estimate(params, config, vram) : null;
  const perEpoch = config.batchSize * config.gradientAccumulation;

  return (
    <aside className="tune__side">
      <span className="tune__label">This machine</span>
      <b className="tune__gpu">{gpu ?? "GPU not detected"}</b>
      <span className="muted">{vram ? `${vram} GB of video memory` : "Estimates assume nothing about memory."}</span>

      <div className="tune__fit" data-fits={fit && vram ? fit.fits : undefined}>
        {fit ? (
          <>
            <span className="tune__need">
              {fit.needed}
              <small> GB</small>
            </span>
            <span>{fit.note}</span>
          </>
        ) : (
          <span>Put the size in the model name (for example Qwen3-4B) and Conduit can say whether it fits.</span>
        )}
      </div>

      <dl className="tune__facts">
        <dt>Method</dt>
        <dd>{METHODS.find((m) => m.id === config.method)?.label}</dd>
        <dt>Examples per step</dt>
        <dd>{perEpoch}</dd>
        <dt>Needs</dt>
        <dd className="tune__pkgs">Python with {PACKAGES.slice(0, 4).join(", ")}…</dd>
      </dl>
    </aside>
  );
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
