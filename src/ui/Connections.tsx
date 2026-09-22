import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BrandMark, brandForProvider, hasBrand } from "./Brand";
import { useCatalog } from "@/llm/catalog";
import { AnimatePresence, motion } from "motion/react";
import { saveSettings, type CustomProvider } from "@/core/config";
import { isTauri } from "@/core/host";
import { keyKnown, refreshKeyStatus } from "@/core/secrets";
import { useApp } from "@/core/store";
import { PROVIDER_CATALOG } from "@/llm";
import { PRESETS, presetFor, type ProviderPreset } from "@/llm/presets";
import { Icon } from "./icons";
import { KeyField } from "./Settings";
import { SPRING, SPRING_SNAP } from "./motion";

/**
 * Cloud and self-hosted providers.
 *
 * Three steps, in the order people think about them: which service, the key,
 * which of its models. The model list is fetched from the provider itself, so
 * nobody has to know that a model is called `deepseek-reasoner` rather than
 * `DeepSeek R1`.
 */
export function Connections() {
  const settings = useApp((s) => s.settings);
  const [adding, setAdding] = useState<string | null>(null);
  const [, bump] = useState(0);

  useEffect(() => {
    void refreshKeyStatus([...PRESETS.map((p) => p.id), ...settings.customProviders.map((p) => p.id)]).then(() =>
      bump((n) => n + 1),
    );
  }, [settings.customProviders]);

  const connected = useMemo(() => {
    const rows: Array<{ id: string; label: string; models: number; local: boolean; hue: number }> = [];
    for (const preset of PRESETS.filter((p) => p.native)) {
      if (!keyKnown(preset.id)) continue;
      const models =
        settings.providerModels[preset.id]?.length ??
        PROVIDER_CATALOG.find((p) => p.id === preset.id)?.models.length ??
        0;
      rows.push({ id: preset.id, label: preset.label, models, local: false, hue: preset.hue });
    }
    for (const custom of settings.customProviders) {
      if (custom.id === "local") continue;
      const preset = presetFor(custom.id);
      rows.push({
        id: custom.id,
        label: custom.label,
        models: custom.models.length,
        local: !custom.needsKey,
        hue: preset?.hue ?? 0,
      });
    }
    return rows;
  }, [settings.customProviders, settings.providerModels]);

  return (
    <div className="conn">
      <AnimatePresence mode="wait" initial={false}>
        {adding ? (
          <motion.div
            key="add"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
            transition={SPRING}
          >
            <AddConnection initial={adding} onDone={() => setAdding(null)} />
          </motion.div>
        ) : (
          <motion.div
            key="list"
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={SPRING}
          >
            <div className="block__head">
              <div>
                <h3 className="block__title">Connected</h3>
                <p className="block__sub">
                  Keys are kept in your system&apos;s credential store. Requests leave from this computer, never
                  through anyone else&apos;s server.
                </p>
              </div>
              <button className="btn btn--ink" onPointerDown={() => setAdding("openai")}>
                <Icon.plus /> Add connection
              </button>
            </div>

            {connected.length === 0 ? (
              <div className="emptycard">
                <div className="emptycard__art">
                  <Icon.cloud />
                </div>
                <b>No providers connected</b>
                <span>Add a key for any of the services below, or run a model on this computer.</span>
              </div>
            ) : (
              <div className="cardlist">
                {connected.map((row) => (
                  <div key={row.id} className="lrow">
                    <ProviderTile id={row.id} label={row.label} hue={row.hue} />
                    <div className="lrow__text">
                      <b>{row.label}</b>
                      <span>
                        {row.models} model{row.models === 1 ? "" : "s"}
                        {row.local ? " · no key needed" : ""}
                      </span>
                    </div>
                    <span className="spacer" />
                    <button className="btn btn--small" onPointerDown={() => setAdding(row.id)}>
                      Edit
                    </button>
                  </div>
                ))}
              </div>
            )}

            <h3 className="block__title block__title--gap">Available</h3>
            <div className="providers">
              {PRESETS.filter((p) => p.id !== "custom").map((preset, i) => (
                <motion.button
                  key={preset.id}
                  className="provider"
                  onPointerDown={() => setAdding(preset.id)}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...SPRING, delay: i * 0.012 }}
                >
                  <ProviderTile id={preset.id} label={preset.label} hue={preset.hue} />
                  <span className="provider__text">
                    <b>{preset.label}</b>
                    <span>{preset.blurb}</span>
                  </span>
                  {preset.local && <span className="tag">Local</span>}
                </motion.button>
              ))}
              <button className="provider provider--custom" onPointerDown={() => setAdding("custom")}>
                <span className="ptile ptile--dashed">
                  <Icon.plus />
                </span>
                <span className="provider__text">
                  <b>Custom endpoint</b>
                  <span>Anything that speaks the OpenAI chat format.</span>
                </span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function ProviderTile({ id, label, hue }: { id: string; label: string; hue: number }) {
  const brand = brandForProvider(id);
  if (hasBrand(brand)) return <BrandMark brand={brand} size={36} />;
  const neutral = id === "xai" || id === "custom" || id === "ollama";
  return (
    <span
      className={`ptile${neutral ? " ptile--ink" : ""}`}
      style={{ ["--h" as string]: String(hue) }}
      aria-hidden="true"
    >
      {label.replace(/[^A-Za-z0-9]/g, "").slice(0, 2)}
    </span>
  );
}

function AddConnection({ initial, onDone }: { initial: string; onDone: () => void }) {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const existing = settings.customProviders.find((p) => p.id === initial);

  const [presetId, setPresetId] = useState(initial);
  const [menu, setMenu] = useState(false);
  const preset: ProviderPreset = presetFor(presetId) ?? PRESETS[PRESETS.length - 1];

  const [label, setLabel] = useState(existing?.label ?? (preset.id === "custom" ? "" : preset.label));
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? preset.baseUrl);
  const [needsKey, setNeedsKey] = useState(existing?.needsKey ?? preset.needsKey);
  const [models, setModels] = useState<string[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(
    new Set(existing?.models ?? settings.providerModels[presetId] ?? []),
  );
  const [filter, setFilter] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "ok" | "bad">("idle");
  const [detail, setDetail] = useState("");
  const [manual, setManual] = useState("");

  // A custom endpoint needs its own credential name, derived from its label.
  const account =
    preset.id === "custom"
      ? `custom-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "endpoint"}`
      : preset.id;

  useEffect(() => {
    const p = presetFor(presetId);
    if (!p) return;
    const saved = settings.customProviders.find((c) => c.id === presetId);
    setLabel(saved?.label ?? (p.id === "custom" ? "" : p.label));
    setBaseUrl(saved?.baseUrl ?? p.baseUrl);
    setNeedsKey(saved?.needsKey ?? p.needsKey);
    setChosen(new Set(saved?.models ?? settings.providerModels[presetId] ?? []));
    setModels([]);
    setState("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetId]);

  const fetchModels = async () => {
    if (!isTauri()) return;
    setState("loading");
    setDetail("");
    try {
      const url = preset.modelsUrl ?? `${baseUrl.replace(/\/$/, "")}/models`;
      const auth = needsKey
        ? preset.auth
          ? { account, header: preset.auth.header, template: preset.auth.template }
          : { account, header: "authorization", template: "Bearer {key}" }
        : null;
      const response = await invoke<{ status: number; body: string }>("proxy_send", {
        request: { url, method: "GET", headers: preset.auth?.extra ?? {}, body: null, auth },
      });
      if (response.status === 401 || response.status === 403) {
        throw new Error("The key was refused. Check it and try again.");
      }
      if (response.status !== 200) throw new Error(`The endpoint answered ${response.status}.`);
      const parsed = JSON.parse(response.body) as { data?: Array<{ id: string }>; models?: Array<{ id?: string; name?: string }> };
      const list = (parsed.data ?? parsed.models ?? [])
        .map((m) => (m as { id?: string }).id ?? (m as { name?: string }).name ?? "")
        .map((id) => id.replace(/^models\//, ""))
        .filter(Boolean)
        .sort();
      if (!list.length) throw new Error("Connected, but it listed no models. Add model names by hand below.");
      setModels(list);
      setState("ok");
      setDetail(`${list.length} models available.`);
      if (chosen.size === 0) setChosen(new Set(list.slice(0, Math.min(3, list.length))));
    } catch (e) {
      setState("bad");
      setDetail(e instanceof Error ? e.message : String(e));
    }
  };

  const visible = models.filter((m) => m.toLowerCase().includes(filter.trim().toLowerCase()));
  const canSave = (chosen.size > 0 || models.length > 0) && (preset.native || baseUrl.trim()) && (preset.id !== "custom" || label.trim());

  const save = async () => {
    // Every model the key reaches shows up in the switcher anyway; the
    // picks are only the short list pinned at the top.
    const picked = chosen.size ? [...chosen] : models.slice(0, 3);
    let next = settings;
    if (preset.native) {
      next = { ...settings, providerModels: { ...settings.providerModels, [preset.id]: picked } };
    } else {
      const provider: CustomProvider = {
        id: preset.id === "custom" ? account : preset.id,
        label: label.trim() || preset.label,
        baseUrl: baseUrl.trim(),
        needsKey,
        models: picked,
      };
      next = {
        ...settings,
        customProviders: [...settings.customProviders.filter((p) => p.id !== provider.id), provider],
      };
    }
    // The first provider anybody connects should be the one chat uses.
    const current = next.command.provider;
    const currentWorks =
      next.customProviders.some((p) => p.id === current) || keyKnown(current) || current === "ollama";
    if (!currentWorks) next = { ...next, command: { provider: preset.id === "custom" ? account : preset.id, model: picked[0] } };

    setSettings(next);
    await saveSettings(next);
    void useCatalog.getState().refresh(preset.id === "custom" ? account : preset.id, next, true);
    onDone();
  };

  const remove = async () => {
    const next = {
      ...settings,
      customProviders: settings.customProviders.filter((p) => p.id !== presetId),
      providerModels: Object.fromEntries(Object.entries(settings.providerModels).filter(([k]) => k !== presetId)),
    };
    setSettings(next);
    await saveSettings(next);
    onDone();
  };

  return (
    <div className="addconn">
      <div className="crumbs">
        <button className="iconbtn" aria-label="Back" onPointerDown={onDone}>
          <Icon.arrowLeft />
        </button>
        <span>Connections</span>
        <span className="crumbs__sep">/</span>
        <b>{existing || settings.providerModels[presetId] ? "Edit" : "New"}</b>
      </div>

      <section className="card">
        <div className="card__row">
          <div className="card__text">
            <b>Provider</b>
            <span>{preset.blurb}</span>
          </div>
          <div className="dropdown">
            <button className="dropdown__btn" onPointerDown={() => setMenu((v) => !v)}>
              <ProviderTile id={preset.id} label={preset.label} hue={preset.hue} />
              {preset.label}
              <Icon.chevron />
            </button>
            <AnimatePresence>
              {menu && (
                <motion.div
                  className="dropdown__menu"
                  initial={{ opacity: 0, y: -4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.98 }}
                  transition={SPRING_SNAP}
                >
                  <div className="dropdown__label">On your machine</div>
                  {PRESETS.filter((p) => p.local).map((p) => (
                    <PresetItem key={p.id} preset={p} active={p.id === presetId} onPick={() => { setPresetId(p.id); setMenu(false); }} />
                  ))}
                  <div className="dropdown__label">Cloud</div>
                  {PRESETS.filter((p) => !p.local).map((p) => (
                    <PresetItem key={p.id} preset={p} active={p.id === presetId} onPick={() => { setPresetId(p.id); setMenu(false); }} />
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {preset.id === "custom" && (
          <div className="card__row">
            <div className="card__text">
              <b>Name</b>
              <span>Shown in the model picker.</span>
            </div>
            <input className="input" value={label} placeholder="My server" onChange={(e) => setLabel(e.target.value)} />
          </div>
        )}

        {!preset.native && (
          <div className="card__row">
            <div className="card__text">
              <b>Address</b>
              <span>{preset.local ? "Change it if you moved the server to another port." : "The API base URL."}</span>
            </div>
            <input
              className="input input--mono"
              value={baseUrl}
              placeholder="https://example.com/v1"
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>
        )}

        {(preset.id === "custom" || preset.local) && (
          <div className="card__row">
            <div className="card__text">
              <b>Needs a key</b>
              <span>Most local servers do not.</span>
            </div>
            <input type="checkbox" checked={needsKey} onChange={(e) => setNeedsKey(e.target.checked)} />
          </div>
        )}
      </section>

      {needsKey && (
        <section className="card">
          <KeyField account={account} label={`${label.trim() || preset.label} key`} keyUrl={preset.keyUrl} />
        </section>
      )}

      <section className="card">
        <div className="card__row">
          <div className="card__text">
            <b>Models</b>
            <span>{chosen.size} selected</span>
          </div>
          <button className="btn btn--small" disabled={state === "loading"} onPointerDown={() => void fetchModels()}>
            {state === "loading" ? <span className="spin" /> : <Icon.refresh />}
            {models.length ? "Reload models" : "Fetch models"}
          </button>
        </div>

        {detail && <div className={`result ${state === "bad" ? "result--bad" : "result--ok"}`}>{detail}</div>}

        {models.length > 0 && (
          <div className="picklist">
            <div className="picklist__bar">
              <span>{models.length} models</span>
              <input className="input input--small" placeholder="Search" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <button className="linkbtn" onPointerDown={() => setChosen(new Set([...chosen, ...visible]))}>
                Select all
              </button>
              <button className="linkbtn" onPointerDown={() => setChosen(new Set())}>
                Clear
              </button>
            </div>
            <div className="picklist__rows">
              {visible.slice(0, 400).map((m) => (
                <label key={m} className="picklist__row">
                  <input
                    type="checkbox"
                    checked={chosen.has(m)}
                    onChange={(e) => {
                      const next = new Set(chosen);
                      if (e.target.checked) next.add(m);
                      else next.delete(m);
                      setChosen(next);
                    }}
                  />
                  <span>{m}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="card__row">
          <input
            className="input input--mono"
            placeholder="Or type a model id and press Enter"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && manual.trim()) {
                setChosen(new Set([...chosen, manual.trim()]));
                setManual("");
              }
            }}
          />
        </div>
        {chosen.size > 0 && (
          <div className="chosen">
            {[...chosen].map((m) => (
              <button
                key={m}
                className="pill pill--removable"
                onPointerDown={() => {
                  const next = new Set(chosen);
                  next.delete(m);
                  setChosen(next);
                }}
              >
                {m}
                <Icon.close />
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="addconn__foot">
        {(existing || settings.providerModels[presetId]) && (
          <button className="btn btn--danger" onPointerDown={() => void remove()}>
            Remove connection
          </button>
        )}
        <span className="spacer" />
        <button className="btn" onPointerDown={onDone}>
          Cancel
        </button>
        <button className="btn btn--accent" disabled={!canSave} onPointerDown={() => void save()}>
          {existing ? "Save" : "Add connection"}
        </button>
      </div>
    </div>
  );
}

function PresetItem({ preset, active, onPick }: { preset: ProviderPreset; active: boolean; onPick: () => void }) {
  return (
    <button className="dropdown__item" aria-current={active} onPointerDown={onPick}>
      <ProviderTile id={preset.id} label={preset.label} hue={preset.hue} />
      {preset.label}
      <span className="spacer" />
      {active && <Icon.check />}
    </button>
  );
}
