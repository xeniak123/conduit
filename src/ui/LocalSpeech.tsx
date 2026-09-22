import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "motion/react";
import {
  download,
  localDir,
  localSttRunning,
  machine,
  manualInstructions,
  recommend,
  resolveRuntimeUrl,
  runtimeFor,
  startLocalStt,
  stopLocalStt,
  useLocal,
  waitForLocalStt,
  WHISPER_MODELS,
  type Machine,
  type WhisperModel,
} from "@/stt/local";
import { saveSettings } from "@/core/config";
import { isTauri } from "@/core/host";
import { useApp } from "@/core/store";
import { Icon } from "./icons";
import { Row } from "./Settings";
import { SPRING } from "./motion";

/**
 * Installing speech recognition that runs here.
 *
 * The whole point is that nobody should have to answer "which Whisper size
 * suits my machine" — that is a question about their own hardware, and getting
 * it wrong means either poor accuracy or a computer that swaps while they are
 * talking. So Conduit reads the memory and the core count and recommends, and
 * shows its reasoning so the recommendation can be argued with.
 *
 * What it will not do is start downloading on its own. This fetches a model
 * and a program from the internet and then runs that program; the size, the
 * origin and the destination are all on screen before the button does
 * anything.
 */

type Stage = "idle" | "model" | "runtime" | "starting" | "ready" | "failed";

export function LocalSpeech() {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);

  const [info, setInfo] = useState<Machine | null>(null);
  const [chosen, setChosen] = useState<WhisperModel | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [received, setReceived] = useState(0);
  const [total, setTotal] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [folder, setFolder] = useState("");

  useEffect(() => {
    if (!isTauri()) return;
    void machine().then((m) => {
      setInfo(m);
      setChosen((current) => current ?? recommend(m).model);
    });
    void localDir().then(setFolder).catch(() => undefined);
    void localSttRunning().then(setRunning);
  }, []);

  // Installed already? Then this panel is about running it, not fetching it.
  const installed = Boolean(settings.localStt.modelPath && settings.localStt.serverPath);
  const suggestion = info ? recommend(info) : null;
  const runtime = info ? runtimeFor(info) : null;

  const install = async () => {
    if (!chosen || !info) return;
    setProblem(null);
    setReceived(0);
    setTotal(0);

    try {
      const dir = await localDir();
      await invoke("fs_mkdir", { path: dir }).catch(() => undefined);

      setStage("model");
      const modelPath = await download(
        `whisper-${chosen.id}`,
        chosen.url,
        `${dir}/ggml-${chosen.id}.bin`,
        (p) => {
          setReceived(p.received);
          setTotal(p.total);
        },
      );

      let serverPath = settings.localStt.serverPath;
      if (!serverPath && runtime) {
        setStage("runtime");
        setReceived(0);
        setTotal(0);
        const url = await resolveRuntimeUrl(runtime.asset);
        const ext = runtime.asset.endsWith(".tar.gz") ? "tar.gz" : "zip";
        const archive = await download("whisper-runtime", url, `${dir}/runtime.${ext}`, (p) => {
          setReceived(p.received);
          setTotal(p.total);
        });
        await invoke("unzip_file", { archive, dest: `${dir}/runtime` });
        serverPath = await invoke<string>("find_file", {
          root: `${dir}/runtime`,
          name: runtime.binary,
        });
        // The archive is several times the size of what it unpacks to, and
        // keeping it would double what this feature costs on disk.
        await invoke("fs_remove", { path: archive }).catch(() => undefined);
      }

      if (!serverPath) {
        setStage("failed");
        setProblem(
          `The model is downloaded, but Conduit has no prebuilt runtime for ${info.os}. ${manualInstructions(info)}`,
        );
        return;
      }

      setStage("starting");
      await useLocal(chosen.id, modelPath, serverPath);
      await startLocalStt();

      // whisper.cpp loads the model before it binds, so a large one on a cold
      // cache takes a while. Calling it failed at that point would be wrong in
      // the most common case.
      const up = await waitForLocalStt(settings.localStt.port);
      setRunning(up);
      setStage(up ? "ready" : "failed");
      if (!up) {
        setProblem(
          "The server was started but never answered. Check the log in the folder below, or try a smaller model.",
        );
      }
    } catch (e) {
      setStage("failed");
      setProblem(e instanceof Error ? e.message : String(e));
    }
  };

  const percent = total > 0 ? Math.min(100, (received / total) * 100) : 0;
  const busy = stage === "model" || stage === "runtime" || stage === "starting";

  if (!isTauri()) {
    return <div className="ext__empty">Local speech is only available in the desktop app.</div>;
  }

  return (
    <>
      <div className="panel">
        <Row
          label="This machine"
          help={
            info
              ? `${info.cores || "?"} cores, ${info.memory_mb ? `${Math.round(info.memory_mb / 1024)} GB of memory` : "memory unknown"}, ${info.os} ${info.arch}.`
              : "Checking…"
          }
        />

        {suggestion && (
          <Row label="Recommended" help={suggestion.because}>
            <span className="tag tag--on">{suggestion.model.label}</span>
          </Row>
        )}
      </div>

      <div className="backends backends--speech">
        {WHISPER_MODELS.map((model) => {
          const tight = info?.memory_mb ? model.memory > info.memory_mb * 0.55 : false;
          const current = settings.localStt.model === model.id;
          return (
            <button
              key={model.id}
              className="backend"
              aria-current={chosen?.id === model.id}
              disabled={busy}
              onPointerDown={() => setChosen(model)}
            >
              <span className="backend__text">
                <b>
                  {model.label}
                  {current && <span className="tag tag--on">In use</span>}
                  {suggestion?.model.id === model.id && !current && <span className="tag">Suggested</span>}
                </b>
                <span>{model.quality}</span>
                {tight && (
                  <span className="backend__warn">
                    Wants about {(model.memory / 1024).toFixed(1)} GB while running. Tight here.
                  </span>
                )}
              </span>
              <span className="backend__size">
                {model.size >= 1000 ? `${(model.size / 1024).toFixed(1)} GB` : `${model.size} MB`}
              </span>
            </button>
          );
        })}
      </div>

      <AnimatePresence>
        {busy && (
          <motion.div
            className="progress"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={SPRING}
          >
            <div className="progress__label">
              {stage === "model"
                ? `Downloading ${chosen?.label}`
                : stage === "runtime"
                  ? "Downloading the speech runtime"
                  : "Starting the server. It loads the model before it answers."}
              {total > 0 && (
                <span className="progress__bytes">
                  {mb(received)} of {mb(total)}
                </span>
              )}
            </div>
            <div className="progress__track">
              <motion.div
                className="progress__fill"
                // Indeterminate when the server declared no length, rather
                // than a bar that sits at zero and looks stuck.
                animate={{ width: total > 0 ? `${percent}%` : "100%" }}
                transition={{ type: "spring", bounce: 0, duration: 0.3 }}
                data-indeterminate={total === 0}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {problem && (
          <motion.div
            className="result result--bad"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={SPRING}
          >
            {problem}
          </motion.div>
        )}
        {stage === "ready" && !problem && (
          <motion.div
            className="result result--ok"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={SPRING}
          >
            Running. Speech is now transcribed on this computer. Hold your hotkey and try it.
          </motion.div>
        )}
      </AnimatePresence>

      <div className="panel">
        {!installed ? (
          <Row
            label="Install"
            help={
              chosen
                ? `Downloads ${chosen.size >= 1000 ? `${(chosen.size / 1024).toFixed(1)} GB` : `${chosen.size} MB`} from huggingface.co${runtime ? ", plus the whisper.cpp server from github.com" : ""}, into ${folder || "the Conduit folder"}.`
                : "Pick a model first."
            }
          >
            <button className="btn btn--accent" disabled={!chosen || busy} onPointerDown={install}>
              <Icon.download />
              {busy ? "Working…" : "Download and run"}
            </button>
          </Row>
        ) : (
          <>
            <Row
              label="Installed"
              help={`${settings.localStt.model} · ${settings.localStt.modelPath}`}
            >
              <span className={`tag ${running ? "tag--on" : ""}`}>
                {running ? "Running" : "Stopped"}
              </span>
            </Row>
            <Row label="Server" help={`Listening on 127.0.0.1:${settings.localStt.port}`}>
              <button
                className="btn"
                onPointerDown={async () => {
                  if (running) {
                    await stopLocalStt();
                    setRunning(false);
                  } else {
                    await startLocalStt();
                    setRunning(await waitForLocalStt(settings.localStt.port, 30_000));
                  }
                }}
              >
                {running ? <Icon.pause /> : <Icon.play />}
                {running ? "Stop" : "Start"}
              </button>
            </Row>
            <Row label="Start with Conduit" help="Otherwise it starts the first time you speak.">
              <button
                className="btn"
                onPointerDown={() => {
                  const next = {
                    ...settings,
                    localStt: { ...settings.localStt, autoStart: !settings.localStt.autoStart },
                  };
                  setSettings(next);
                  void saveSettings(next);
                }}
              >
                {settings.localStt.autoStart ? "On" : "Off"}
              </button>
            </Row>
            <Row label="Change model" help="Pick another above, then download it.">
              <button className="btn" disabled={!chosen || busy} onPointerDown={install}>
                Download {chosen?.label}
              </button>
            </Row>
          </>
        )}

        {folder && (
          <Row label="Folder" help={folder}>
            <button
              className="btn"
              onPointerDown={() => void invoke("open_target", { target: folder }).catch(() => undefined)}
            >
              Open
            </button>
          </Row>
        )}

        {info && !runtime && (
          <Row label="This platform" help={manualInstructions(info)}>
            <input
              type="text"
              placeholder="Path to whisper-server"
              value={settings.localStt.serverPath}
              onChange={(e) => {
                const next = {
                  ...settings,
                  localStt: { ...settings.localStt, serverPath: e.target.value },
                };
                setSettings(next);
                void saveSettings(next);
              }}
            />
          </Row>
        )}
      </div>
    </>
  );
}

const mb = (bytes: number): string =>
  bytes >= 1024 * 1024 * 1024
    ? `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
    : `${Math.round(bytes / 1024 / 1024)} MB`;
