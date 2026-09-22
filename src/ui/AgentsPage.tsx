import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { motion } from "motion/react";
import { apiPort, createToken, routes, startApi } from "@/api/server";
import { saveSettings } from "@/core/config";
import { isTauri } from "@/core/host";
import { useApp } from "@/core/store";
import { useRuntime } from "@/models/runtime";
import { BrandMark, brandForModel } from "./Brand";
import { Icon } from "./icons";
import { SPRING_SNAP } from "./motion";

/**
 * Point coding agents at Conduit.
 *
 * Claude Code, Codex, OpenCode and the rest each want a base URL, a key and a
 * model name, in their own dialect and their own variable names. Conduit
 * already serves every model it can reach behind one local API, so this page
 * only has to translate: pick an agent and a model, and it writes the
 * environment, shows the exact command, and can open it in a terminal.
 *
 * The agents' own config files are never edited. Everything travels as
 * environment variables, or as a config file in Conduit's own folder that the
 * agent is pointed at for that one session.
 */

type Shell = "powershell" | "bash";

interface Agent {
  id: string;
  program?: string;
  name: string;
  brand: string;
  blurb: string;
  install?: string;
  docs: string;
  /** Speaks Anthropic Messages or OpenAI Responses rather than Chat Completions. */
  dialect: "messages" | "responses" | "chat";
  ide?: boolean;
}

const AGENTS: Agent[] = [
  {
    id: "claude",
    program: "claude",
    name: "Claude Code",
    brand: "claudecode",
    blurb: "Anthropic's terminal coding agent.",
    install: "npm install -g @anthropic-ai/claude-code",
    docs: "https://docs.anthropic.com/en/docs/claude-code",
    dialect: "messages",
  },
  {
    id: "codex",
    program: "codex",
    name: "Codex",
    brand: "codex",
    blurb: "OpenAI's coding agent for the terminal.",
    install: "npm install -g @openai/codex",
    docs: "https://github.com/openai/codex",
    dialect: "responses",
  },
  {
    id: "opencode",
    program: "opencode",
    name: "OpenCode",
    brand: "opencode",
    blurb: "Open-source agent that works with any model.",
    install: "npm install -g opencode-ai",
    docs: "https://opencode.ai/docs",
    dialect: "chat",
  },
  {
    id: "aider",
    program: "aider",
    name: "Aider",
    brand: "aider",
    blurb: "Pair programming in your terminal, git-aware.",
    install: "python -m pip install aider-install && aider-install",
    docs: "https://aider.chat/docs",
    dialect: "chat",
  },
  {
    id: "goose",
    program: "goose",
    name: "Goose",
    brand: "goose",
    blurb: "Block's open agent with extensions.",
    install: "See block.github.io/goose for the installer",
    docs: "https://block.github.io/goose",
    dialect: "chat",
  },
  {
    id: "ide",
    name: "Cursor, Continue, Cline…",
    brand: "cursor",
    blurb: "Any editor or app with an OpenAI-compatible setting.",
    docs: "",
    dialect: "chat",
    ide: true,
  },
];

let sessionToken: string | null = null;

export function AgentsPage() {
  const settings = useApp((s) => s.settings);
  const loaded = useRuntime((s) => s.loaded);
  const [agentId, setAgentId] = useState("claude");
  const [port, setPort] = useState<number | null>(null);
  const [shell, setShell] = useState<Shell>(navigator.userAgent.includes("Windows") ? "powershell" : "bash");
  const [installed, setInstalled] = useState<Record<string, boolean>>({});
  const [dataDir, setDataDir] = useState("~/.conduit");
  const [token, setToken] = useState<string | null>(sessionToken);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [cwd, setCwd] = useState(() => settings.projects.find((p) => p.id === settings.activeProjectId)?.root ?? "");

  const models = useMemo(() => routes(settings), [settings, loaded]);
  const [model, setModel] = useState<string>("");
  useEffect(() => {
    if (!model || !models.some((m) => m.id === model)) setModel(models[0]?.id ?? "");
  }, [models, model]);

  const agent = AGENTS.find((a) => a.id === agentId)!;
  const apiOn = settings.api.enabled && port !== null;

  useEffect(() => {
    if (!isTauri()) return;
    void apiPort().then(setPort);
    void invoke<string>("data_dir").then((d) => setDataDir(d.replace(/\\/g, "/")));
    for (const a of AGENTS) {
      if (!a.program) continue;
      void invoke<string | null>("agent_which", { program: a.program }).then((path) =>
        setInstalled((cur) => ({ ...cur, [a.id]: Boolean(path) })),
      );
    }
  }, [settings.api.enabled]);

  const turnOnApi = async () => {
    const next = { ...settings, api: { ...settings.api, enabled: true } };
    useApp.getState().setSettings(next);
    await saveSettings(next);
    setPort(await startApi());
  };

  const key = settings.api.keylessLocal ? "conduit-local" : (token ?? "<create a token below>");
  const base = `http://127.0.0.1:${port ?? settings.api.port}`;
  const plan = useMemo(() => build(agent, { base, key, model, dataDir }), [agent, base, key, model, dataDir]);

  const upstreamOk =
    agent.dialect === "chat" ||
    model.startsWith("local/") ||
    (agent.dialect === "messages" && model.startsWith("anthropic/")) ||
    (agent.dialect === "responses" && model.startsWith("openai/"));

  const launch = async () => {
    setResult(null);
    try {
      for (const f of plan.files) {
        await invoke("fs_mkdir", { path: f.path.replace(/\/[^/]+$/, "") }).catch(() => undefined);
        await invoke("fs_write", { path: f.path, contents: f.contents });
      }
      await invoke("agent_launch", {
        program: agent.program,
        args: plan.args,
        env: plan.env,
        cwd: cwd.trim() || null,
      });
      setResult({ ok: true, text: `${agent.name} opened in a new terminal, talking to ${model}.` });
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="page page--wide">
      <header className="page__head">
        <div>
          <h1 className="page__title">Agents</h1>
          <p className="page__sub">
            Run Claude Code, Codex, OpenCode and other coding agents on any model in Conduit, including one on your own GPU. Their own settings are never touched.
          </p>
        </div>
      </header>

      {!apiOn && (
        <div className="agents__gate">
          <div>
            <b>The local API is off.</b>
            <span>Agents reach your models through it. It only listens on this computer unless you change that.</span>
          </div>
          <button className="btn btn--ink" disabled={!isTauri()} onPointerDown={() => void turnOnApi()}>
            Turn on
          </button>
        </div>
      )}

      <div className="agents__layout">
        <div className="agents__main">
          <h3 className="block__title">Coding agent</h3>
          <div className="agents__grid">
            {AGENTS.map((a) => (
              <button key={a.id} className="agentcard" aria-current={a.id === agentId} onPointerDown={() => setAgentId(a.id)}>
                {a.id === agentId && <motion.span layoutId="agent-pill" className="agentcard__ring" transition={SPRING_SNAP} />}
                <BrandMark brand={a.brand} size={34} fallback={a.name} />
                <span className="agentcard__text">
                  <b>{a.name}</b>
                  <span>{a.blurb}</span>
                </span>
                {a.program && installed[a.id] !== undefined && (
                  <span className={`tag${installed[a.id] ? " tag--on" : ""}`}>{installed[a.id] ? "Installed" : "Not found"}</span>
                )}
              </button>
            ))}
          </div>

          <h3 className="block__title block__title--gap">Model</h3>
          {models.length === 0 ? (
            <div className="emptyline">
              No models yet. Load one in the{" "}
              <button className="linkbtn" onPointerDown={() => useApp.getState().openHub("device")}>
                Model hub
              </button>{" "}
              or connect a provider.
            </div>
          ) : (
            <div className="agents__models">
              {models.slice(0, 40).map((m) => (
                <button key={m.id} className="agents__model" aria-current={m.id === model} onPointerDown={() => setModel(m.id)}>
                  <BrandMark brand={brandForModel(m.upstream, m.id.split("/")[0])} size={22} fallback={m.id} />
                  <span>{m.id}</span>
                  {m.id.startsWith("local/") && <span className="tag tag--on">This computer</span>}
                </button>
              ))}
            </div>
          )}
          {!upstreamOk && model && (
            <div className="agents__warn">
              {agent.name} speaks the {agent.dialect === "messages" ? "Anthropic Messages" : "OpenAI Responses"} API.
              That works with a model running on this computer{agent.dialect === "messages" ? " or an Anthropic model" : " or an OpenAI model"}. Other providers may refuse it.
            </div>
          )}

          {!agent.ide && (
            <>
              <h3 className="block__title block__title--gap">Folder</h3>
              <input
                className="input input--mono"
                placeholder="Where the agent starts, e.g. C:\code\my-app"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
              />
            </>
          )}
        </div>

        <aside className="agents__side">
          <div className="agents__sidehead">
            <BrandMark brand={agent.brand} size={40} fallback={agent.name} />
            <div>
              <b>{agent.name}</b>
              <span>{model || "Pick a model"}</span>
            </div>
          </div>

          {agent.ide ? (
            <div className="agents__fields">
              <Field label="Base URL" value={`${base}/v1`} />
              <Field label="API key" value={key} />
              <Field label="Model" value={model} />
              <p className="muted">Choose “OpenAI compatible” or “Custom OpenAI” as the provider in your editor and paste these three.</p>
            </div>
          ) : (
            <>
              <div className="seg agents__shell">
                {(["powershell", "bash"] as Shell[]).map((s) => (
                  <button key={s} className="seg__item" aria-current={shell === s} onPointerDown={() => setShell(s)}>
                    {shell === s && <motion.span layoutId="shell-pill" className="seg__pill" transition={SPRING_SNAP} />}
                    <span>{s === "powershell" ? "Windows" : "macOS / Linux"}</span>
                  </button>
                ))}
              </div>
              <Code text={script(plan, agent, shell)} />
              {plan.files.length > 0 && (
                <p className="muted">
                  Also writes {plan.files.map((f) => f.path.split("/").pop()).join(", ")} into Conduit's folder, not the agent's.
                </p>
              )}
              <button
                className="btn btn--ink btn--lg agents__launch"
                disabled={!isTauri() || !apiOn || !model || installed[agent.id] === false}
                onPointerDown={() => void launch()}
              >
                <Icon.terminal /> Open {agent.name}
              </button>
              {installed[agent.id] === false && agent.install && (
                <div className="agents__install">
                  <span>Not installed. Install it with:</span>
                  <Code text={agent.install} />
                </div>
              )}
              {result && <div className={`result result--${result.ok ? "ok" : "bad"}`}>{result.text}</div>}
            </>
          )}

          {!settings.api.keylessLocal && (
            <div className="agents__token">
              {token ? (
                <span className="muted">Using a token made for this session. It is shown once, in the command.</span>
              ) : (
                <button
                  className="btn"
                  onPointerDown={async () => {
                    sessionToken = await createToken("Coding agents", 90);
                    setToken(sessionToken);
                  }}
                >
                  <Icon.key /> Create a token for agents
                </button>
              )}
            </div>
          )}
          {agent.docs && (
            <a className="linkbtn" href={agent.docs} target="_blank" rel="noreferrer">
              {agent.name} documentation
            </a>
          )}
        </aside>
      </div>
    </div>
  );
}

interface Plan {
  env: Record<string, string>;
  args: string[];
  files: Array<{ path: string; contents: string }>;
}

function build(agent: Agent, o: { base: string; key: string; model: string; dataDir: string }): Plan {
  const { base, key, model, dataDir } = o;
  switch (agent.id) {
    case "claude":
      return {
        env: {
          ANTHROPIC_BASE_URL: base,
          ANTHROPIC_AUTH_TOKEN: key,
          ANTHROPIC_MODEL: model,
          ANTHROPIC_DEFAULT_OPUS_MODEL: model,
          ANTHROPIC_DEFAULT_SONNET_MODEL: model,
          ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
          ANTHROPIC_SMALL_FAST_MODEL: model,
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        },
        args: [],
        files: [],
      };
    case "codex": {
      const home = `${dataDir}/agents/codex`;
      return {
        env: { CODEX_HOME: home, CONDUIT_API_KEY: key },
        args: [],
        files: [
          {
            path: `${home}/config.toml`,
            contents: [
              "# Written by Conduit. Used only when Codex is opened from Conduit.",
              `model = "${model}"`,
              `model_provider = "conduit"`,
              "",
              "[model_providers.conduit]",
              `name = "Conduit"`,
              `base_url = "${base}/v1"`,
              `env_key = "CONDUIT_API_KEY"`,
              `wire_api = "responses"`,
              "",
            ].join("\n"),
          },
        ],
      };
    }
    case "opencode": {
      const path = `${dataDir}/agents/opencode.json`;
      return {
        env: { OPENCODE_CONFIG: path, CONDUIT_API_KEY: key },
        args: [],
        files: [
          {
            path,
            contents: JSON.stringify(
              {
                $schema: "https://opencode.ai/config.json",
                model: `conduit/${model}`,
                provider: {
                  conduit: {
                    npm: "@ai-sdk/openai-compatible",
                    name: "Conduit",
                    options: { baseURL: `${base}/v1`, apiKey: "{env:CONDUIT_API_KEY}" },
                    models: { [model]: { name: model } },
                  },
                },
              },
              null,
              2,
            ),
          },
        ],
      };
    }
    case "aider":
      return { env: { OPENAI_API_BASE: `${base}/v1`, OPENAI_API_KEY: key }, args: ["--model", `openai/${model}`], files: [] };
    case "goose":
      return {
        env: {
          GOOSE_PROVIDER: "openai",
          GOOSE_MODEL: model,
          OPENAI_HOST: base,
          OPENAI_BASE_PATH: "v1/chat/completions",
          OPENAI_API_KEY: key,
        },
        args: ["session"],
        files: [],
      };
    default:
      return { env: {}, args: [], files: [] };
  }
}

function script(plan: Plan, agent: Agent, shell: Shell): string {
  const lines = Object.entries(plan.env).map(([k, v]) =>
    shell === "powershell" ? `$env:${k} = "${v}"` : `export ${k}="${v}"`,
  );
  lines.push([agent.program, ...plan.args].join(" "));
  return lines.join("\n");
}

function Code({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="agents__code">
      <pre>{text}</pre>
      <button
        className="nav__icon"
        aria-label="Copy"
        onPointerDown={() => {
          void navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        }}
      >
        {copied ? <Icon.check /> : <Icon.copy />}
      </button>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="agents__field">
      <span>{label}</span>
      <Code text={value} />
    </div>
  );
}
