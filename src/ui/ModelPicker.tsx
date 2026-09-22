import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { invoke } from "@tauri-apps/api/core";
import { saveSettings, type CustomProvider, type ProviderId, type Settings } from "@/core/config";
import { isTauri } from "@/core/host";
import { refreshKeyStatus } from "@/core/secrets";
import { useApp } from "@/core/store";
import { PROVIDER_CATALOG } from "@/llm";
import { readyProviders, useCatalog, type ModelInfo } from "@/llm/catalog";
import { BrandMark, brandForModel, brandForProvider } from "./Brand";
import { contenders } from "@/core/arena";
import { tiers } from "@/core/router";
import { Switch } from "./CompanionPage";
import { Icon } from "./icons";
import { SPRING, SPRING_SNAP } from "./motion";

/**
 * Choosing a model, and adding somewhere to get one from.
 *
 * Switching model was previously a trip into Settings, two dropdowns and a
 * free-text field — for the thing people change most often. It belongs one
 * click from where the current model is displayed.
 *
 * Adding a provider is the same problem one level up. Anything that speaks the
 * OpenAI chat shape works, so the form asks for a name and a URL and nothing
 * else; local runtimes are found by looking, because asking somebody to type
 * `http://localhost:11434/v1` is asking them to remember a port number.
 */

interface Local {
  id: string;
  label: string;
  baseUrl: string;
  models: string[];
}

/** Where local runtimes listen by default. Probing beats asking. */
const LOCAL_CANDIDATES: Array<{ id: string; label: string; baseUrl: string }> = [
  { id: "ollama", label: "Ollama", baseUrl: "http://localhost:11434/v1" },
  { id: "lmstudio", label: "LM Studio", baseUrl: "http://localhost:1234/v1" },
  { id: "llamacpp", label: "llama.cpp", baseUrl: "http://localhost:8080/v1" },
  { id: "jan", label: "Jan", baseUrl: "http://localhost:1337/v1" },
];

interface Row {
  provider: ProviderId;
  label: string;
  model: string;
  info?: ModelInfo;
  pinned: boolean;
  local?: boolean;
  /** A provider with no key yet: the row leads to adding one. */
  missing?: boolean;
}

export function ModelPicker({ onClose }: { onClose: () => void }) {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);

  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Local[]>([]);
  const [scanning, setScanning] = useState(false);
  const [tick, force] = useState(0);

  useEffect(() => {
    void refreshKeyStatus([
      ...PROVIDER_CATALOG.map((p) => p.id),
      ...settings.customProviders.map((p) => p.id),
      "groq",
    ]).then(() =>
      force((n) => n + 1),
    );
    void scan();
  }, []);

  /**
   * Asks each known local port what models it has.
   *
   * A runtime that is not running simply does not answer, so this needs no
   * configuration and produces no error — an absent entry is the answer.
   */
  const scan = async () => {
    if (!isTauri()) return;
    setScanning(true);

    const results = await Promise.all(
      LOCAL_CANDIDATES.map(async (candidate) => {
        try {
          const response = await invoke<{ status: number; body: string }>("proxy_send", {
            request: {
              url: `${candidate.baseUrl}/models`,
              method: "GET",
              headers: {},
              body: null,
              auth: null,
            },
          });
          if (response.status !== 200) return null;

          const parsed = JSON.parse(response.body) as { data?: Array<{ id: string }> };
          const models = (parsed.data ?? []).map((m) => m.id).filter(Boolean);
          return models.length ? { ...candidate, models } : null;
        } catch {
          return null;
        }
      }),
    );

    setFound(results.filter((r): r is Local => r !== null));
    setScanning(false);
  };

  const addLocal = (local: Local) => {
    const custom: CustomProvider = {
      id: local.id,
      label: local.label,
      baseUrl: local.baseUrl,
      needsKey: false,
      models: local.models,
    };
    const next = {
      ...settings,
      customProviders: [...settings.customProviders.filter((p) => p.id !== local.id), custom],
      command: { provider: local.id, model: local.models[0] },
    };
    setSettings(next);
    void saveSettings(next);
    onClose();
  };

  const lists = useCatalog((s) => s.lists);
  const loading = useCatalog((s) => s.loading);
  const refreshList = useCatalog((s) => s.refresh);
  const [only, setOnly] = useState<string | null>(null);

  const ready = useMemo(() => readyProviders(settings), [settings, found, tick]);

  // Ask every provider with a key what it has. Cached for an hour, so this is
  // usually free.
  useEffect(() => {
    for (const p of ready) void refreshList(p.id, settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready.map((p) => p.id).join()]);

  const pinnedFor = (id: string): string[] => {
    const custom = settings.customProviders.find((p) => p.id === id);
    if (custom) return custom.models;
    if (settings.providerModels?.[id]?.length) return settings.providerModels[id];
    return [...(PROVIDER_CATALOG.find((p) => p.id === id)?.models ?? [])];
  };

  const entries = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows: Row[] = [];
    const browsing = Boolean(q || only);

    for (const p of ready) {
      if (only && p.id !== only) continue;
      const pinned = pinnedFor(p.id);
      const live = lists[p.id]?.models ?? [];
      const byId = new Map(live.map((m) => [m.id, m]));
      const source: ModelInfo[] = browsing
        ? [...pinned.filter((m) => !byId.has(m)).map((id) => ({ id })), ...live]
        : pinned.map((id) => byId.get(id) ?? { id });
      for (const m of source) {
        rows.push({ provider: p.id, label: p.label, model: m.id, info: m, pinned: pinned.includes(m.id), local: p.local });
      }
    }

    // Providers that still need a key are shown once, so the way to add one is obvious.
    if (!browsing) {
      const readyIds = new Set(ready.map((p) => p.id));
      for (const p of PROVIDER_CATALOG) {
        if (!p.needsKey || readyIds.has(p.id)) continue;
        rows.push({ provider: p.id, label: p.label, model: p.models[0], pinned: false, missing: true });
      }
    }

    const filtered = q
      ? rows.filter(
          (r) =>
            r.model.toLowerCase().includes(q) ||
            r.label.toLowerCase().includes(q) ||
            (r.info?.name ?? "").toLowerCase().includes(q),
        )
      : rows;
    // Pinned first, then everything else; a list of 400 renders in pages.
    return filtered.sort((a, b) => Number(b.pinned) - Number(a.pinned)).slice(0, 300);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, only, ready, lists, settings.customProviders, settings.providerModels]);

  const apply = (provider: ProviderId, model: string) => {
    // A model picked from the full list joins the short list, so next time it
    // is one click away instead of a search.
    let next: Settings = { ...settings, command: { provider, model } };
    const custom = settings.customProviders.find((p) => p.id === provider);
    if (custom && !custom.models.includes(model)) {
      next = {
        ...next,
        customProviders: settings.customProviders.map((p) =>
          p.id === provider ? { ...p, models: [model, ...p.models].slice(0, 16) } : p,
        ),
      };
    } else if (!custom) {
      const pinned = pinnedFor(provider);
      if (!pinned.includes(model)) {
        next = { ...next, providerModels: { ...settings.providerModels, [provider]: [model, ...pinned].slice(0, 16) } };
      }
    }
    setSettings(next);
    void saveSettings(next);
    onClose();
  };

  return (
    <motion.div
      className="picker-scrim"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.14 }}
      onPointerDown={onClose}
    >
      <motion.div
        className="picker"
        initial={{ opacity: 0, y: 14, scale: 0.98, filter: "blur(8px)" }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
        exit={{ opacity: 0, y: 8, scale: 0.98, filter: "blur(6px)" }}
        transition={SPRING}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="picker__search">
          <Icon.search />
          <input
            autoFocus
            className="picker__input"
            placeholder="Search models"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "Enter" && entries[0] && !entries[0].missing) apply(entries[0].provider, entries[0].model);
            }}
          />
          <span className="kbd kbd--dim">Esc</span>
        </div>

        <AutoRow />

        {ready.length > 0 && (
          <div className="picker__chips">
            <button className="picker__chip" aria-pressed={only === null} onPointerDown={() => setOnly(null)}>
              Pinned
            </button>
            {ready.map((p) => {
              const n = lists[p.id]?.models.length;
              return (
                <button
                  key={p.id}
                  className="picker__chip"
                  aria-pressed={only === p.id}
                  onPointerDown={() => setOnly(only === p.id ? null : p.id)}
                >
                  {p.label}
                  {loading[p.id] ? <span className="spin" /> : n ? <span className="picker__count">{n}</span> : null}
                </button>
              );
            })}
          </div>
        )}

        <div className="picker__list">
          {entries.map((entry) => {
            const active =
              entry.provider === settings.command.provider && entry.model === settings.command.model;
            if (entry.missing) {
              return (
                <button
                  key={`missing:${entry.provider}`}
                  className="picker__item"
                  data-ready={false}
                  onPointerDown={() => {
                    onClose();
                    useApp.getState().openHub("cloud");
                  }}
                >
                  <span className="picker__row">
                    <BrandMark brand={brandForProvider(entry.provider)} size={24} fallback={entry.label} />
                    <span className="picker__model">{entry.label}</span>
                    <span className="picker__vendor">Add a key to use every {entry.label} model</span>
                    <span className="picker__tag picker__tag--warn">needs a key</span>
                  </span>
                </button>
              );
            }
            return (
              <button
                key={`${entry.provider}:${entry.model}`}
                className="picker__item"
                data-ready
                aria-current={active}
                onPointerDown={() => apply(entry.provider, entry.model)}
              >
                {active && (
                  <motion.span layoutId="picker-pill" className="picker__pill" transition={SPRING_SNAP} />
                )}
                <span className="picker__row">
                  <BrandMark
                    brand={brandForModel(entry.model, entry.provider)}
                    size={24}
                    fallback={entry.label}
                    badge={entry.provider === "huggingface" ? "huggingface" : null}
                  />
                  <span className="picker__model">{entry.info?.name ?? entry.model}</span>
                  <span className="picker__vendor">
                    {entry.info?.name ? `${entry.model} · ` : ""}
                    {entry.label}
                  </span>
                  {entry.info?.context ? (
                    <span className="picker__tag">{formatContext(entry.info.context)}</span>
                  ) : null}
                  {entry.info?.free && <span className="picker__tag picker__tag--good">free</span>}
                  {entry.local && <span className="picker__tag">local</span>}
                  {entry.pinned && !only && !query && <Pin />}
                </span>
              </button>
            );
          })}

          {entries.length === 0 && (
            <div className="picker__empty">
              {ready.length === 0 ? "Add a key or load a local model to start." : "Nothing matches."}
            </div>
          )}
        </div>

        <div className="picker__foot">
          <button className="btn" onPointerDown={() => void scan()} disabled={scanning}>
            {scanning ? "Looking…" : "Find local models"}
          </button>
          <span className="spacer" />
          <button
            className="btn btn--ink"
            onPointerDown={() => {
              onClose();
              useApp.getState().openHub("cloud");
            }}
          >
            Add a provider
          </button>
        </div>

        <AnimatePresence>
          {found.length > 0 && (
            <motion.div
              className="picker__found"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={SPRING}
            >
              <div className="picker__foundhead">Running on this machine</div>
              {found.map((local) => (
                <button key={local.id} className="picker__local" onPointerDown={() => addLocal(local)}>
                  <Icon.cpu />
                  <span>
                    <b>{local.label}</b>
                    <span className="picker__vendor">
                      {local.models.length} model{local.models.length === 1 ? "" : "s"} · {local.baseUrl}
                    </span>
                  </span>
                  <span className="picker__add">Use</span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

      </motion.div>
    </motion.div>
  );
}

function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`;
  return `${Math.round(tokens / 1000)}K`;
}

function Pin() {
  return (
    <svg className="picker__pin" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-label="Pinned">
      <path d="M16 3l5 5-3 1-4 4 1 5-2 2-4-4-5 5-1-1 5-5-4-4 2-2 5 1 4-4z" />
    </svg>
  );
}

/**
 * Auto: the router picks per message. The two ends are shown and can be
 * changed here, so "which model will answer" is never a mystery.
 */
function AutoRow() {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const on = settings.router?.enabled ?? false;
  const t = tiers(settings);
  const options = contenders(settings);
  const set = (router: Settings["router"]) => {
    const next = { ...settings, router };
    setSettings(next);
    void saveSettings(next);
  };
  const value = (m: { provider: string; model: string } | null) => (m ? `${m.provider}::${m.model}` : "");
  const parse = (v: string) => (v ? { provider: v.split("::")[0], model: v.split("::").slice(1).join("::") } : null);
  return (
    <>
      <div className="picker__auto" data-on={on}>
        <div>
          <b>Auto</b>
          <span>
            {on
              ? `Easy messages go to ${t.fast?.model ?? "a faster model"}, the rest to ${t.strong.model}.`
              : "Conduit picks the model for each message, and shows what it saved."}
          </span>
        </div>
        <Switch checked={on} label="Auto" onChange={(enabled) => set({ ...settings.router, enabled, strong: settings.router.strong ?? settings.command })} />
      </div>
      {on && (
        <div className="picker__tiers">
          <span>Easy</span>
          <select className="select" value={value(t.fast)} onChange={(e) => set({ ...settings.router, fast: parse(e.target.value) })}>
            {!t.fast && <option value="">None available</option>}
            {options.map((c) => (
              <option key={value(c)} value={value(c)}>
                {c.model} · {c.label}
              </option>
            ))}
          </select>
          <span>Hard</span>
          <select className="select" value={value(t.strong)} onChange={(e) => set({ ...settings.router, strong: parse(e.target.value) })}>
            {options.map((c) => (
              <option key={value(c)} value={value(c)}>
                {c.model} · {c.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
}
