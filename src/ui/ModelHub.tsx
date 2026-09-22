import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { isDecisionModel } from "@/models/decide";
import { BrandMark, brandForModel } from "./Brand";
import { HfConnect } from "./HfConnect";
import { isTauri } from "@/core/host";
import { useApp } from "@/core/store";
import { listFiles, readme, searchModels, SHELVES, type HubModel, type Sort } from "@/models/hub";
import {
  fitOf,
  formatBytes,
  formatCount,
  groupQuants,
  recommendQuant,
  type Hardware,
  type Quant,
} from "@/models/quant";
import {
  cancelDownload,
  detectHardware,
  dismissDownload,
  downloadQuant,
  eject,
  installRuntime,
  load,
  loadLibrary,
  preferredBackend,
  removeModel,
  runtimeChoices,
  useInChat,
  useRuntime,
  type Backend,
  type LibraryEntry,
  type RuntimeChoice,
} from "@/models/runtime";
import { Connections } from "./Connections";
import { Icon } from "./icons";
import { Markdown } from "./Markdown";
import { SPRING, SPRING_SNAP } from "./motion";

type Tab = "discover" | "device" | "cloud";

export function ModelHub() {
  const [tab, setTab] = useState<Tab>(() => useApp.getState().hubTab ?? "discover");
  const hubTab = useApp((s) => s.hubTab);
  useEffect(() => {
    if (!hubTab) return;
    setTab(hubTab);
    useApp.setState({ hubTab: null });
  }, [hubTab]);
  const hardware = useRuntime((s) => s.hardware);
  const library = useRuntime((s) => s.library);
  const downloads = useRuntime((s) => s.downloads);
  const active = Object.values(downloads).filter((d) => d.state === "running").length;

  useEffect(() => {
    void detectHardware();
    void loadLibrary();
  }, []);

  return (
    <div className="page page--wide">
      <header className="page__head">
        <div>
          <h1 className="page__title">Model hub</h1>
          <p className="page__sub">Find, download and run models on this computer, or connect a cloud provider.</p>
        </div>
        <div className="page__tools">
          <HfConnect />
          <HardwareChips hw={hardware} />
        </div>
      </header>

      <RunningBanner />

      <div className="hub__bar">
        <div className="seg seg--lg">
          {(
            [
              ["discover", "Discover"],
              ["device", `On this computer${library.length ? ` · ${library.length}` : ""}`],
              ["cloud", "Cloud providers"],
            ] as Array<[Tab, string]>
          ).map(([id, label]) => (
            <button key={id} className="seg__item" aria-current={tab === id} onPointerDown={() => setTab(id)}>
              {tab === id && <motion.span layoutId="hub-tab" className="seg__pill" transition={SPRING_SNAP} />}
              <span>
                {label}
                {id === "device" && active > 0 && <i className="seg__dot" />}
              </span>
            </button>
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tab}
          className="hub__body"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.16 }}
        >
          {tab === "discover" && <Discover hw={hardware} />}
          {tab === "device" && <OnDevice onBrowse={() => setTab("discover")} />}
          {tab === "cloud" && <Connections />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function HardwareChips({ hw }: { hw: Hardware | null }) {
  if (!hw) return <div className="hwchips hwchips--loading">Checking hardware…</div>;
  return (
    <div className="hwchips">
      {hw.gpu && (
        <span className="hwchip" title={hw.gpu}>
          <Icon.cpu />
          <b>{hw.vram ? `${Math.round(hw.vram / 1024)} GB` : "?"}</b> VRAM
        </span>
      )}
      <span className="hwchip">
        <Icon.gauge />
        <b>{hw.ram ? `${Math.round(hw.ram / 1024)} GB` : "?"}</b> RAM
      </span>
      <span className="hwchip">
        <b>{hw.cores || "?"}</b> cores
      </span>
    </div>
  );
}

function RunningBanner() {
  const loaded = useRuntime((s) => s.loaded);
  const loading = useRuntime((s) => s.loading);
  const error = useRuntime((s) => s.error);
  const command = useApp((s) => s.settings.command);
  const inChat = loaded && command.provider === "local" && command.model === loaded.name;

  return (
    <AnimatePresence initial={false}>
      {(loaded || loading || error) && (
        <motion.div
          className={`running${error && !loaded ? " running--bad" : ""}`}
          initial={{ opacity: 0, height: 0, marginBottom: 0 }}
          animate={{ opacity: 1, height: "auto", marginBottom: 18 }}
          exit={{ opacity: 0, height: 0, marginBottom: 0 }}
          transition={SPRING}
        >
          <div className="running__inner">
            <span className="running__dot" data-state={loaded ? "on" : loading ? "busy" : "bad"} />
            <div className="running__text">
              <b>{loaded ? loaded.name : loading ? "Loading model…" : "The model stopped"}</b>
              <span>
                {loaded
                  ? `Running on 127.0.0.1:${loaded.port} · ${loaded.context.toLocaleString()} tokens of context`
                  : loading
                    ? "Reading weights into memory. Large models take a moment."
                    : error}
              </span>
            </div>
            {loaded?.decision && (
              <button className="btn btn--ink btn--small" onPointerDown={() => useApp.getState().setPage("decide")}>
                Open Decisions
              </button>
            )}
            {loaded && !loaded.decision && !inChat && (
              <button className="btn btn--ink btn--small" onPointerDown={() => void useInChat()}>
                Use in chat
              </button>
            )}
            {loaded && !loaded.decision && inChat && <span className="tag tag--on">Chatting with this</span>}
            {(loaded || loading) && (
              <button className="btn btn--small" onPointerDown={() => void eject()}>
                <Icon.eject />
                Eject
              </button>
            )}
            {error && !loaded && !loading && (
              <button className="btn btn--small" onPointerDown={() => useRuntime.getState().set({ error: null })}>
                Dismiss
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// --- discover --------------------------------------------------------------------------

function Discover({ hw }: { hw: Hardware | null }) {
  const [query, setQuery] = useState("");
  const [shelf, setShelf] = useState(SHELVES[0].id);
  const [sort, setSort] = useState<Sort>("trending");
  const [results, setResults] = useState<HubModel[]>([]);
  const [selected, setSelected] = useState<HubModel | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const debounce = useRef<number | null>(null);

  useEffect(() => {
    if (debounce.current) window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => {
      const current = SHELVES.find((s) => s.id === shelf);
      const q = query.trim() || current?.query || "";
      setBusy(true);
      setProblem(null);
      searchModels(q, sort, query.trim() ? undefined : current?.author)
        .then((list) => {
          setResults(list);
          setSelected((prev) => (prev && list.some((m) => m.id === prev.id) ? prev : (list[0] ?? null)));
        })
        .catch((e) => setProblem(e instanceof Error ? e.message : String(e)))
        .finally(() => setBusy(false));
    }, query ? 320 : 0);
    return () => {
      if (debounce.current) window.clearTimeout(debounce.current);
    };
  }, [query, shelf, sort]);

  return (
    <>
      <div className="hub__filters">
        <label className="searchbox">
          <Icon.search />
          <input
            placeholder="Search models on Hugging Face"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {busy && <span className="spin" aria-label="Searching" />}
        </label>
        <select className="select" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="trending">Trending</option>
          <option value="downloads">Most downloaded</option>
          <option value="likes">Most liked</option>
          <option value="updated">Recently updated</option>
        </select>
      </div>

      {!query && (
        <div className="shelves">
          {SHELVES.map((s) => (
            <button key={s.id} className="chip" aria-pressed={shelf === s.id} onPointerDown={() => setShelf(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
      )}

      {problem && <div className="result result--bad">{problem}</div>}

      <div className="split">
        <div className="split__list">
          {results.map((model, i) => (
            <motion.button
              key={model.id}
              className="mcard"
              aria-current={selected?.id === model.id}
              onPointerDown={() => setSelected(model)}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...SPRING, delay: Math.min(i, 12) * 0.018 }}
            >
              {selected?.id === model.id && (
                <motion.span layoutId="mcard-pill" className="mcard__pill" transition={SPRING} />
              )}
              <Monogram name={model.author} repo={model.id} />
              <span className="mcard__text">
                <b>
                  {model.name}
                  {isDecisionModel(`${model.id} ${model.tags.join(" ")}`) && <span className="tag tag--decide">Decision</span>}
                </b>
                <span>{model.author}</span>
              </span>
              <span className="mcard__stats">
                <span>
                  <Icon.heart /> {formatCount(model.likes)}
                </span>
                <span>
                  <Icon.arrowDown /> {formatCount(model.downloads)}
                </span>
                {model.updated && <span className="mcard__age">{age(model.updated)}</span>}
              </span>
            </motion.button>
          ))}
          {!busy && results.length === 0 && !problem && (
            <div className="empty">No GGUF models match that.</div>
          )}
        </div>

        <div className="split__detail">
          <AnimatePresence mode="wait">
            {selected ? (
              <motion.div
                key={selected.id}
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -4 }}
                transition={{ duration: 0.18 }}
              >
                <ModelDetail model={selected} hw={hw} />
              </motion.div>
            ) : (
              <div className="empty empty--tall">Pick a model to see its sizes and what fits.</div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </>
  );
}

function ModelDetail({ model, hw }: { model: HubModel; hw: Hardware | null }) {
  const [quants, setQuants] = useState<Quant[] | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [card, setCard] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const downloads = useRuntime((s) => s.downloads);
  const library = useRuntime((s) => s.library);

  useEffect(() => {
    let live = true;
    setQuants(null);
    setCard("");
    setProblem(null);
    listFiles(model.id)
      .then((files) => {
        if (!live) return;
        const grouped = groupQuants(files);
        setQuants(grouped);
        const pick = hw ? recommendQuant(grouped, hw) : grouped[0];
        setChoice(pick?.name ?? null);
      })
      .catch((e) => live && setProblem(e instanceof Error ? e.message : String(e)));
    readme(model.id)
      .then((text) => live && setCard(text.slice(0, 24_000)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [model.id, hw]);

  const quant = quants?.find((q) => q.name === choice) ?? null;
  const recommended = quants && hw ? recommendQuant(quants, hw) : null;
  const id = quant ? `${model.id}:${quant.name}` : "";
  const download = id ? downloads[id] : undefined;
  const have = id ? library.find((e) => e.id === id) : undefined;
  const verdict = quant && hw ? fitOf(quant.size, hw) : null;

  return (
    <div className="detail">
      <div className="detail__head">
        <Monogram name={model.author} repo={model.id} large />
        <div>
          <h2 className="detail__title">{model.name}</h2>
          <div className="detail__by">{model.author}</div>
        </div>
      </div>

      <div className="detail__tags">
        {model.pipeline && <span className="pill">{model.pipeline.replace(/-/g, " ")}</span>}
        {model.tags
          .filter((t) => ["vision", "conversational", "code", "reasoning", "multimodal", "tool-use"].includes(t))
          .map((t) => (
            <span key={t} className="pill">
              {t}
            </span>
          ))}
        <span className="pill pill--quiet">
          <Icon.heart /> {formatCount(model.likes)}
        </span>
        <span className="pill pill--quiet">
          <Icon.arrowDown /> {formatCount(model.downloads)}
        </span>
      </div>

      {problem && <div className="result result--bad">{problem}</div>}

      <div className="getbox">
        <div className="getbox__row">
          <div className="quantpick">
            <button className="quantpick__btn" disabled={!quants?.length} onPointerDown={() => setOpen((v) => !v)}>
              {quant ? (
                <>
                  <FitDot fit={verdict?.fit} />
                  <b>{quant.name}</b>
                  <span className="quantpick__size">{formatBytes(quant.size)}</span>
                  {quant.files.length > 1 && <span className="quantpick__parts">{quant.files.length} parts</span>}
                </>
              ) : quants ? (
                <span>No GGUF files here</span>
              ) : (
                <span className="quantpick__loading">Reading files…</span>
              )}
              <Icon.chevron />
            </button>

            <AnimatePresence>
              {open && quants && (
                <motion.div
                  className="quantpick__menu"
                  initial={{ opacity: 0, y: -4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.98 }}
                  transition={SPRING_SNAP}
                >
                  {quants.map((q) => {
                    const fit = hw ? fitOf(q.size, hw) : null;
                    return (
                      <button
                        key={q.name}
                        className="quantpick__item"
                        aria-current={q.name === choice}
                        onPointerDown={() => {
                          setChoice(q.name);
                          setOpen(false);
                        }}
                      >
                        <FitDot fit={fit?.fit} />
                        <b>{q.name}</b>
                        {recommended?.name === q.name && <span className="tag tag--on">Best fit</span>}
                        {library.some((e) => e.id === `${model.id}:${q.name}`) && <span className="tag">Downloaded</span>}
                        <span className="spacer" />
                        <span className="quantpick__fit">{fit?.label}</span>
                        <span className="quantpick__size">{formatBytes(q.size)}</span>
                      </button>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {have ? (
            <LoadButton entry={have} />
          ) : download?.state === "running" ? (
            <button className="btn" onPointerDown={() => void cancelDownload(id)}>
              Cancel
            </button>
          ) : (
            <button
              className="btn btn--accent btn--lg"
              disabled={!quant || verdict?.fit === "no" || !isTauri()}
              onPointerDown={() => {
                if (!quant) return;
                dismissDownload(id);
                void downloadQuant(model.id, quant).catch(() => undefined);
              }}
            >
              <Icon.download />
              Download
            </button>
          )}
        </div>

        {verdict && quant && (
          <p className="getbox__note" data-fit={verdict.fit}>
            {fitSentence(verdict.fit, quant, hw)}
          </p>
        )}

        <AnimatePresence>
          {download && (
            <motion.div
              className="dl"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={SPRING}
            >
              <DownloadBar download={download} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {card ? (
        <div className="modelcard">
          <Markdown text={card} />
        </div>
      ) : (
        <div className="modelcard modelcard--empty">
          <a
            className="ext__link"
            href={`https://huggingface.co/${model.id}`}
            target="_blank"
            rel="noreferrer"
          >
            <Icon.external /> Open on Hugging Face
          </a>
        </div>
      )}
    </div>
  );
}

function fitSentence(fit: string, quant: Quant, hw: Hardware | null): string {
  switch (fit) {
    case "gpu":
      return `Runs entirely on your ${hw?.gpu ?? "GPU"}. This is the fast case.`;
    case "partial":
      return "Too big for the graphics card alone, so part of it runs on the CPU. It works, just slower.";
    case "cpu":
      return "No GPU detected. It will run on the processor, at a few words a second for mid-sized models.";
    default:
      return `Needs about ${formatBytes(fitOf(quant.size, hw ?? { vram: 0, ram: 0, gpu: null, cores: 0, vendor: null }).needed * 1024 * 1024)} of memory, more than this machine has. Pick a smaller quantisation.`;
  }
}

function FitDot({ fit }: { fit?: string }) {
  return <span className="fitdot" data-fit={fit ?? "unknown"} />;
}

function DownloadBar({ download }: { download: ReturnType<typeof useRuntime.getState>["downloads"][string] }) {
  const pct = download.total ? Math.min(100, (download.received / download.total) * 100) : 0;
  const started = useRef(Date.now());
  const elapsed = (Date.now() - started.current) / 1000;
  const rate = elapsed > 1 ? download.received / elapsed : 0;
  const left = rate > 0 ? (download.total - download.received) / rate : 0;

  if (download.state !== "running") {
    return (
      <div className="dl__row">
        <span className={download.state === "failed" ? "dl__bad" : "dl__muted"}>
          {download.state === "cancelled" ? "Download cancelled." : download.error}
        </span>
        <span className="spacer" />
        <button className="btn btn--small" onPointerDown={() => dismissDownload(download.id)}>
          Dismiss
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="dl__row">
        <b>{pct.toFixed(0)}%</b>
        <span className="dl__muted">
          {formatBytes(download.received)} of {formatBytes(download.total)}
          {download.parts > 1 && ` · part ${download.part} of ${download.parts}`}
        </span>
        <span className="spacer" />
        {rate > 0 && (
          <span className="dl__muted">
            {formatBytes(rate)}/s · {duration(left)} left
          </span>
        )}
      </div>
      <div className="bar">
        <motion.span className="bar__fill" animate={{ width: `${pct}%` }} transition={{ duration: 0.25 }} />
      </div>
    </>
  );
}

// --- on this computer --------------------------------------------------------------------

function OnDevice({ onBrowse }: { onBrowse: () => void }) {
  const library = useRuntime((s) => s.library);
  const downloads = useRuntime((s) => s.downloads);
  const running = Object.values(downloads);

  return (
    <div className="device">
      {running.length > 0 && (
        <section className="block">
          <h3 className="block__title">Downloading</h3>
          <div className="cardlist">
            {running.map((d) => (
              <div key={d.id} className="lrow">
                <Monogram name={d.repo.split("/")[0]} repo={d.repo} />
                <div className="lrow__text">
                  <b>{d.repo.split("/").pop()}</b>
                  <span>{d.quant}</span>
                </div>
                <div className="lrow__wide">
                  <DownloadBar download={d} />
                </div>
                {d.state === "running" && (
                  <button className="btn btn--small" onPointerDown={() => void cancelDownload(d.id)}>
                    Cancel
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="block">
        <h3 className="block__title">Models</h3>
        {library.length === 0 ? (
          <div className="emptycard">
            <div className="emptycard__art">
              <Icon.grid />
            </div>
            <b>No models on this computer yet</b>
            <span>Download one from Discover. The best size for your hardware is picked for you.</span>
            <button className="btn btn--ink" onPointerDown={onBrowse}>
              Browse models
            </button>
          </div>
        ) : (
          <div className="cardlist">
            {library.map((entry) => (
              <LibraryRow key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </section>

      <RuntimePanel />
    </div>
  );
}

function LibraryRow({ entry }: { entry: LibraryEntry }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="lrow">
      <Monogram name={entry.repo.split("/")[0]} repo={entry.repo} />
      <div className="lrow__text">
        <b>
          {entry.repo.split("/").pop()?.replace(/-GGUF$/i, "")}
          {isDecisionModel(entry.repo) && <span className="tag tag--decide">Decision model</span>}
        </b>
        <span>
          {entry.quant} · {formatBytes(entry.size)} · {entry.repo.split("/")[0]}
        </span>
      </div>
      <span className="spacer" />
      <LoadButton entry={entry} />
      {confirm ? (
        <>
          <button
            className="btn btn--danger btn--small"
            onPointerDown={() => void removeModel(entry).then(() => setConfirm(false))}
          >
            Delete {formatBytes(entry.size)}
          </button>
          <button className="btn btn--small" onPointerDown={() => setConfirm(false)}>
            Keep
          </button>
        </>
      ) : (
        <button className="iconbtn" aria-label="Delete model" onPointerDown={() => setConfirm(true)}>
          <Icon.trash />
        </button>
      )}
    </div>
  );
}

function LoadButton({ entry }: { entry: LibraryEntry }) {
  const loaded = useRuntime((s) => s.loaded);
  const loading = useRuntime((s) => s.loading);
  const hw = useRuntime((s) => s.hardware);
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState(8192);
  const [layers, setLayers] = useState(999);
  const [flash, setFlash] = useState(true);

  const isLoaded = loaded?.id === entry.id;
  const isLoading = loading === entry.id;
  const verdict = hw ? fitOf(entry.size, hw, context) : null;

  if (isLoaded) {
    return (
      <button className="btn btn--small" onPointerDown={() => void eject()}>
        <Icon.eject /> Eject
      </button>
    );
  }

  return (
    <div className="loadbtn">
      <button
        className="btn btn--ink"
        disabled={Boolean(loading) || !isTauri()}
        onPointerDown={() => void load(entry, { context, gpuLayers: layers, flashAttention: flash }).catch((e) =>
          useRuntime.getState().set({ loading: null, error: e instanceof Error ? e.message : String(e) }),
        )}
      >
        {isLoading ? <span className="spin spin--ink" /> : <Icon.play />}
        {isLoading ? "Loading" : "Load"}
      </button>
      <button className="btn btn--ink loadbtn__more" aria-label="Load options" onPointerDown={() => setOpen((v) => !v)}>
        <Icon.chevron />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="loadopts"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={SPRING_SNAP}
          >
            <label className="loadopts__row">
              <span>
                Context <b>{context.toLocaleString()}</b> tokens
              </span>
              <input
                type="range"
                min={2048}
                max={131072}
                step={2048}
                value={context}
                onChange={(e) => setContext(Number(e.target.value))}
              />
            </label>
            <label className="loadopts__row">
              <span>
                GPU layers <b>{layers >= 999 ? "All" : layers}</b>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.min(layers, 100)}
                onChange={(e) => setLayers(Number(e.target.value) >= 100 ? 999 : Number(e.target.value))}
              />
            </label>
            <label className="loadopts__check">
              <input type="checkbox" checked={flash} onChange={(e) => setFlash(e.target.checked)} />
              Flash attention (faster, less memory)
            </label>
            {verdict && (
              <div className="loadopts__fit" data-fit={verdict.fit}>
                <FitDot fit={verdict.fit} /> {verdict.label} at this context, about {formatBytes(verdict.needed * 1024 * 1024)}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RuntimePanel() {
  const runtimePath = useRuntime((s) => s.runtimePath);
  const backend = useRuntime((s) => s.backend);
  const installing = useRuntime((s) => s.installing);
  const hw = useRuntime((s) => s.hardware);
  const [choices, setChoices] = useState<RuntimeChoice[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    runtimeChoices()
      .then(setChoices)
      .catch((e) => setProblem(e instanceof Error ? e.message : String(e)));
  }, []);

  const recommended: Backend | null = hw ? preferredBackend(hw) : null;

  return (
    <section className="block">
      <h3 className="block__title">Runtime</h3>
      <p className="block__sub">
        Models run on llama.cpp, fetched from its official releases the first time you load one.
        {runtimePath && backend && (
          <>
            {" "}
            Installed: <b>{backend.toUpperCase()}</b>.
          </>
        )}
      </p>
      {problem && <div className="result result--bad">{problem}</div>}
      {installing && (
        <div className="dl dl--card">
          <div className="dl__row">
            <b>Installing {installing.label}</b>
            <span className="spacer" />
            <span className="dl__muted">
              {formatBytes(installing.received)} of {formatBytes(installing.total)}
            </span>
          </div>
          <div className="bar">
            <motion.span
              className="bar__fill"
              animate={{ width: `${installing.total ? (installing.received / installing.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}
      <div className="backends">
        {(choices ?? []).map((choice) => (
          <div key={choice.backend} className="backend" aria-current={backend === choice.backend}>
            <div className="backend__text">
              <b>
                {choice.label}
                {recommended === choice.backend && <span className="tag tag--on">Recommended</span>}
                {backend === choice.backend && runtimePath && <span className="tag">Installed</span>}
              </b>
              <span>{choice.detail}</span>
            </div>
            <span className="backend__size">{formatBytes(choice.size)}</span>
            <button
              className="btn btn--small"
              disabled={Boolean(installing)}
              onPointerDown={() =>
                void installRuntime(choice.backend).catch((e) =>
                  setProblem(e instanceof Error ? e.message : String(e)),
                )
              }
            >
              {backend === choice.backend && runtimePath ? "Reinstall" : "Install"}
            </button>
          </div>
        ))}
        {!choices && !problem && isTauri() && <div className="empty">Checking the latest llama.cpp build…</div>}
      </div>
    </section>
  );
}

// --- small parts --------------------------------------------------------------------------

/**
 * A publisher's tile. Drawn, not fetched: avatars from Hugging Face would mean
 * a request per row from a web view that has no network access, and a stable
 * colour per name reads well enough to find a publisher again.
 */
export function Monogram({ name, large, repo }: { name: string; large?: boolean; repo?: string }) {
  // A model whose family is recognisable gets that family’s mark, with a
  // small Hugging Face badge for where it came from.
  const family = repo ? brandForModel(repo.split("/").pop() ?? "") : null;
  const hue = useMemo(() => {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return h;
  }, [name]);
  if (family) return <BrandMark brand={family} size={large ? 52 : 38} badge={repo ? "huggingface" : null} />;
  return (
    <span
      className={`mono${large ? " mono--lg" : ""}`}
      style={{ ["--h" as string]: String(hue) }}
      aria-hidden="true"
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function age(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function duration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "a moment";
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}
