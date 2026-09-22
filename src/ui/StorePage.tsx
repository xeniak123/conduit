import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { saveSettings } from "@/core/config";
import { keyKnown, refreshKeyStatus } from "@/core/secrets";
import { useApp } from "@/core/store";
import {
  install,
  isInstalled,
  loadCatalog,
  uninstall,
  type CatalogResult,
  type ItemKind,
  type RegistryItem,
} from "@/market";
import { statuses, subscribe, syncServers, type ServerStatus } from "@/mcp";
import { listSkills, loadSkills } from "@/skills";
import { AppIcon, iconFor } from "./AppIcon";
import { Icon } from "./icons";
import { KeyField } from "./Settings";
import { SPRING, SPRING_SNAP } from "./motion";

const CATEGORIES: Array<{ id: ItemKind | "all"; label: string }> = [
  { id: "all", label: "All" },
  { id: "mcp", label: "Tools" },
  { id: "skill", label: "Skills" },
  { id: "companion", label: "Pets" },
  { id: "prompt-pack", label: "Prompts" },
];

const KIND_LABEL: Record<ItemKind, string> = {
  mcp: "Tool server",
  skill: "Skill",
  companion: "Pet",
  "prompt-pack": "Prompts",
};

export function StorePage() {
  const settings = useApp((s) => s.settings);
  const [catalog, setCatalog] = useState<CatalogResult | null>(null);
  const [kind, setKind] = useState<ItemKind | "all">("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<RegistryItem | null>(null);
  const [tab, setTab] = useState<"browse" | "installed">("browse");
  const [servers, setServers] = useState<ServerStatus[]>(statuses());
  const [, bump] = useState(0);

  useEffect(() => {
    void loadCatalog().then(setCatalog);
    void loadSkills().then(() => bump((n) => n + 1));
    return subscribe(setServers);
  }, []);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (catalog?.items ?? []).filter(
      (item) =>
        (kind === "all" || item.kind === kind) &&
        (!q ||
          item.name.toLowerCase().includes(q) ||
          item.summary.toLowerCase().includes(q) ||
          (item.tags ?? []).some((t) => t.includes(q))),
    );
  }, [catalog, kind, query]);

  const featured = (catalog?.items ?? []).filter((i) => i.featured).slice(0, 3);
  const installedCount = settings.market.installed.length;

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <h1 className="page__title">Store</h1>
          <p className="page__sub">Tools, skills and pets. Everything here is open source and listed in a public repository.</p>
        </div>
        <div className="seg">
          {(["browse", "installed"] as const).map((t) => (
            <button key={t} className="seg__item" aria-current={tab === t} onPointerDown={() => setTab(t)}>
              {tab === t && <motion.span layoutId="store-tab" className="seg__pill" transition={SPRING_SNAP} />}
              <span>{t === "browse" ? "Browse" : `Installed${installedCount ? ` · ${installedCount}` : ""}`}</span>
            </button>
          ))}
        </div>
      </header>

      {tab === "browse" ? (
        <>
          {!query && kind === "all" && featured.length > 0 && (
            <div className="featured">
              {featured.map((item, i) => {
                const { glyph, tint, brand } = iconFor(item);
                return (
                  <motion.button
                    key={item.id}
                    className="feature"
                    data-tint={tint}
                    onPointerDown={() => setOpen(item)}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ ...SPRING, delay: i * 0.05 }}
                    whileHover={{ y: -2 }}
                  >
                    <span className="feature__eyebrow">{KIND_LABEL[item.kind]}</span>
                    <AppIcon glyph={glyph} tint={tint} brand={brand} size={56} />
                    <b>{item.name}</b>
                    <span>{item.summary}</span>
                  </motion.button>
                );
              })}
            </div>
          )}

          <div className="hub__filters">
            <label className="searchbox">
              <Icon.search />
              <input placeholder="Search the store" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
          </div>
          <div className="shelves">
            {CATEGORIES.map((c) => (
              <button key={c.id} className="chip" aria-pressed={kind === c.id} onPointerDown={() => setKind(c.id)}>
                {c.label}
              </button>
            ))}
          </div>

          {catalog?.remoteError && (
            <div className="notice notice--soft">
              Showing what comes with Conduit. Community additions from <code>{settings.market.registry}</code> will
              appear here once it can be reached.
            </div>
          )}

          <div className="apps">
            {items.map((item, i) => (
              <AppCard key={item.id} item={item} index={i} onOpen={() => setOpen(item)} />
            ))}
            {items.length === 0 && catalog && <div className="empty">Nothing matches that.</div>}
          </div>
        </>
      ) : (
        <Installed servers={servers} onOpen={setOpen} catalog={catalog?.items ?? []} />
      )}

      <AnimatePresence>
        {open && <Sheet item={open} servers={servers} onClose={() => setOpen(null)} />}
      </AnimatePresence>
    </div>
  );
}

function AppCard({ item, index, onOpen }: { item: RegistryItem; index: number; onOpen: () => void }) {
  const installed = useApp((s) => s.settings.market.installed.some((i) => i.id === item.id));
  const { glyph, tint, brand } = iconFor(item);
  return (
    <motion.button
      className="appcard"
      onPointerDown={onOpen}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING, delay: Math.min(index, 16) * 0.015 }}
    >
      <AppIcon glyph={glyph} tint={tint} brand={brand} size={48} />
      <span className="appcard__text">
        <b>{item.name}</b>
        <span className="appcard__kind">
          {KIND_LABEL[item.kind]}
          {item.author ? ` · ${item.author}` : ""}
        </span>
        <span className="appcard__summary">{item.summary}</span>
      </span>
      <span className={`appcard__get${installed ? " appcard__get--on" : ""}`}>{installed ? "Open" : "Get"}</span>
    </motion.button>
  );
}

function Sheet({ item, servers, onClose }: { item: RegistryItem; servers: ServerStatus[]; onClose: () => void }) {
  const installed = useApp((s) => s.settings.market.installed.some((i) => i.id === item.id));
  const server = useApp((s) => s.settings.mcp.servers.find((x) => x.id === item.id));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [, bump] = useState(0);
  const status = servers.find((s) => s.id === item.id);
  const { glyph, tint, brand } = iconFor(item);

  useEffect(() => {
    const secrets = (item.mcp?.env ?? []).map((e) => e.secret).filter(Boolean) as string[];
    if (secrets.length) void refreshKeyStatus(secrets).then(() => bump((n) => n + 1));
  }, [item]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setProblem(null);
    try {
      await work();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const doInstall = () =>
    run(async () => {
      await install(item);
      if (item.kind === "mcp") await syncServers();
      if (item.kind === "skill") await loadSkills();
    });

  const doRemove = () =>
    run(async () => {
      await uninstall(item.id);
      if (item.kind === "mcp") await syncServers();
      if (item.kind === "skill") await loadSkills();
    });

  const missing = (item.mcp?.env ?? []).filter((e) => e.secret && !keyKnown(e.secret));

  return (
    <motion.div
      className="sheet-scrim"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onPointerDown={onClose}
    >
      <motion.aside
        className="sheet"
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 40, opacity: 0 }}
        transition={SPRING}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button className="iconbtn sheet__close" aria-label="Close" onPointerDown={onClose}>
          <Icon.close />
        </button>

        <div className="sheet__hero" data-tint={tint}>
          <AppIcon glyph={glyph} tint={tint} brand={brand} size={72} />
          <div>
            <h2>{item.name}</h2>
            <span>
              {KIND_LABEL[item.kind]}
              {item.author ? ` · ${item.author}` : ""}
              {item.license ? ` · ${item.license}` : ""}
            </span>
          </div>
        </div>

        <div className="sheet__actions">
          {installed ? (
            <button className="btn" disabled={busy} onPointerDown={() => void doRemove()}>
              Remove
            </button>
          ) : (
            <button className="btn btn--accent btn--lg" disabled={busy} onPointerDown={() => void doInstall()}>
              {busy ? <span className="spin spin--ink" /> : <Icon.download />}
              Install
            </button>
          )}
          {item.homepage && (
            <a className="btn btn--ghost" href={item.homepage} target="_blank" rel="noreferrer">
              <Icon.external /> Source
            </a>
          )}
        </div>

        {problem && <div className="result result--bad">{problem}</div>}

        <p className="sheet__about">{item.about ?? item.summary}</p>

        {item.mcp && (
          <section className="sheet__section">
            <h4>What it runs</h4>
            <code className="ext__cmd">
              {item.mcp.command} {item.mcp.args.join(" ")}
            </code>
            {item.mcp.note && <p className="sheet__note">{item.mcp.note}</p>}
            <p className="sheet__note">
              A tool server is a separate program. Every tool it offers asks before it runs, unless you exempt it in
              Settings, Permissions.
            </p>
          </section>
        )}

        {installed && missing.length > 0 && (
          <section className="sheet__section">
            <h4>Needs</h4>
            {missing.map((field) => (
              <div key={field.name} className="panel">
                <KeyField account={field.secret!} label={field.label} />
              </div>
            ))}
            {server && !server.enabled && (
              <button
                className="btn btn--ink"
                onPointerDown={async () => {
                  const settings = useApp.getState().settings;
                  const next = {
                    ...settings,
                    mcp: { servers: settings.mcp.servers.map((s) => (s.id === item.id ? { ...s, enabled: true } : s)) },
                  };
                  useApp.getState().setSettings(next);
                  await saveSettings(next);
                  await syncServers();
                }}
              >
                Start it
              </button>
            )}
          </section>
        )}

        {installed && status && (
          <section className="sheet__section">
            <h4>Status</h4>
            <div className="srv__row">
              <span className="srv__dot" data-state={status.state} />
              <span>
                {status.state === "ready"
                  ? `Running, ${status.tools} tool${status.tools === 1 ? "" : "s"}`
                  : status.state === "starting"
                    ? "Starting"
                    : status.state === "failed"
                      ? status.error
                      : "Stopped"}
              </span>
            </div>
            {status.state === "failed" && status.log.length > 0 && <pre className="srv__log">{status.log.join("\n")}</pre>}
          </section>
        )}

        {item.tags && item.tags.length > 0 && (
          <div className="sheet__tags">
            {item.tags.map((t) => (
              <span key={t} className="pill pill--quiet">
                {t}
              </span>
            ))}
          </div>
        )}
      </motion.aside>
    </motion.div>
  );
}

function Installed({
  servers,
  onOpen,
  catalog,
}: {
  servers: ServerStatus[];
  onOpen: (item: RegistryItem) => void;
  catalog: RegistryItem[];
}) {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const skills = listSkills();

  const toggleServer = async (id: string, enabled: boolean) => {
    const next = { ...settings, mcp: { servers: settings.mcp.servers.map((s) => (s.id === id ? { ...s, enabled } : s)) } };
    setSettings(next);
    await saveSettings(next);
    await syncServers();
  };

  const toggleSkill = async (id: string, on: boolean) => {
    const enabledSkills = on
      ? [...new Set([...settings.market.enabledSkills, id])]
      : settings.market.enabledSkills.filter((s) => s !== id);
    const next = { ...settings, market: { ...settings.market, enabledSkills } };
    setSettings(next);
    await saveSettings(next);
  };

  if (settings.market.installed.length === 0) {
    return (
      <div className="emptycard">
        <div className="emptycard__art">
          <Icon.store />
        </div>
        <b>Nothing installed yet</b>
        <span>Tool servers give the agent new abilities. Skills teach it how to do a kind of task well.</span>
      </div>
    );
  }

  return (
    <div className="cardlist">
      {settings.market.installed.map((rec) => {
        const item = catalog.find((c) => c.id === rec.id);
        const { glyph, tint, brand } = iconFor(item ?? { id: rec.id, kind: rec.kind });
        const server = settings.mcp.servers.find((s) => s.id === rec.id);
        const status = servers.find((s) => s.id === rec.id);
        const skill = skills.find((s) => s.id === rec.id);
        return (
          <div key={rec.id} className="lrow">
            <AppIcon glyph={glyph} tint={tint} brand={brand} size={40} />
            <div className="lrow__text">
              <b>{rec.name}</b>
              <span>
                {KIND_LABEL[rec.kind]}
                {server && ` · ${status?.state === "ready" ? `${status.tools} tools` : (status?.state ?? "stopped")}`}
                {skill && ` · ${skill.name}`}
              </span>
            </div>
            <span className="spacer" />
            {server && (
              <label className="switch">
                <input type="checkbox" checked={server.enabled} onChange={(e) => void toggleServer(rec.id, e.target.checked)} />
                <span />
              </label>
            )}
            {rec.kind === "skill" && (
              <label className="switch">
                <input
                  type="checkbox"
                  checked={settings.market.enabledSkills.includes(rec.id)}
                  onChange={(e) => void toggleSkill(rec.id, e.target.checked)}
                />
                <span />
              </label>
            )}
            {item && (
              <button className="btn btn--small" onPointerDown={() => onOpen(item)}>
                Details
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export { isInstalled };
