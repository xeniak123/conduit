import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "motion/react";
import {
  ACTIVITIES,
  ACTIVITY_LABEL,
  companionDir,
  companionOr,
  companionTemplate,
  listCompanions,
  loadCompanions,
  removeCompanion,
  type Activity,
  type LoadReport,
} from "@/companion";
import { Creature } from "@/companion/Creature";
import { saveSettings, type CompanionSettings, type Settings } from "@/core/config";
import { isTauri } from "@/core/host";
import { useApp } from "@/core/store";
import { CompanionBody, GooFilter } from "./CompanionBody";
import { Icon } from "./icons";
import { SPRING, SPRING_SNAP } from "./motion";

/**
 * The pet on your desktop and the bead beside your cursor.
 *
 * Both are previewed live, in every state, because neither can be judged from
 * a description: a pet is its animations, and glass is whatever is behind it.
 */

const MODES: Array<{ id: CompanionSettings["mode"]; label: string; detail: string }> = [
  { id: "pet", label: "Pet", detail: "Lives on your taskbar." },
  { id: "droplet", label: "Bead", detail: "Follows your cursor." },
  { id: "both", label: "Both", detail: "A pet and a bead." },
  { id: "off", label: "Neither", detail: "Nothing on screen." },
];

const SCENES = [
  { id: "desk", label: "Desktop", css: "linear-gradient(160deg, #cfe3ff 0%, #f6d6e8 55%, #ffe4c4 100%)" },
  { id: "dark", label: "Dark", css: "linear-gradient(160deg, #1b1c24, #2a2b36 60%, #16171d)" },
  { id: "busy", label: "Busy", css: "radial-gradient(60% 80% at 20% 20%, #4d6ea8, transparent 60%), radial-gradient(50% 70% at 80% 30%, #b0673f, transparent 60%), radial-gradient(70% 90% at 50% 100%, #2f7a63, transparent 60%), #1a1a22" },
] as const;

export function CompanionPage() {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const companion = settings.companion;

  const patch = (next: Partial<CompanionSettings>) => {
    const merged: Settings = { ...settings, companion: { ...companion, ...next } };
    setSettings(merged);
    void saveSettings(merged);
  };

  const [activity, setActivity] = useState<Activity>("coding");
  const [scene, setScene] = useState<(typeof SCENES)[number]["id"]>("desk");
  const [tour, setTour] = useState(false);
  const [appearKey, setAppearKey] = useState(0);
  const [emitCursor, setEmitCursor] = useState(0);
  const [report, setReport] = useState<LoadReport | null>(null);
  const [registry, setRegistry] = useState(0);
  const [folder, setFolder] = useState("");

  useEffect(() => {
    void loadCompanions(true).then((r) => {
      setReport(r);
      setRegistry((n) => n + 1);
    });
    if (isTauri()) void companionDir().then(setFolder).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!tour) return;
    const order: Activity[] = ACTIVITIES.filter((a) => a !== "held");
    let i = order.indexOf(activity);
    const t = window.setInterval(() => {
      i = (i + 1) % order.length;
      setActivity(order[i]);
    }, 2200);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tour]);

  const all = useMemo(() => listCompanions(), [registry]);
  const pets = all.filter((c) => c.spec.kind === "pet");
  const beads = all.filter((c) => c.spec.kind === "droplet");
  const pet = companionOr(companion.desktopPetId, "pet");
  const showsPet = companion.mode === "pet" || companion.mode === "both";
  const showsBead = companion.mode === "droplet" || companion.mode === "both";
  const backdrop = SCENES.find((s) => s.id === scene) ?? SCENES[0];

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <h1 className="page__title">Companion</h1>
          <p className="page__sub">
            A pet that lives on your desktop and tells you what Conduit is doing, a bead that follows your cursor, or
            both.
          </p>
        </div>
      </header>

      <GooFilter />

      <div className="modes">
        {MODES.map((m) => (
          <button key={m.id} className="mode" aria-pressed={companion.mode === m.id} onPointerDown={() => patch({ mode: m.id })}>
            {companion.mode === m.id && <motion.span layoutId="mode-ring" className="mode__ring" transition={SPRING} />}
            <span className="mode__art">
              {m.id === "pet" || m.id === "both" ? (
                <Creature spec={pet} activity="idle" size={44} />
              ) : m.id === "droplet" ? (
                <span className="mode__bead" />
              ) : (
                <Icon.close />
              )}
            </span>
            <b>{m.label}</b>
            <span>{m.detail}</span>
          </button>
        ))}
      </div>

      <div className="stagebox" style={{ background: backdrop.css }} data-scene={scene}>
        <div className="stagebox__floor" />
        <div className="stagebox__actors">
          {showsPet && (
            <div className="stagebox__pet">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activity}
                  className="pet__bubble pet__bubble--static"
                  initial={{ opacity: 0, y: 6, scale: 0.92 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 3 }}
                  transition={{ type: "spring", bounce: 0.3, duration: 0.4 }}
                >
                  {ACTIVITY_LABEL[activity]}
                </motion.div>
              </AnimatePresence>
              <Creature spec={pet} activity={activity} size={132 * companion.petSize} />
            </div>
          )}
          {showsBead && (
            <div className="companion stagebox__bead" data-activity={activity} data-side="right">
              <CompanionBody
                settings={companion}
                activity={activity}
                level={activity === "listening" ? 0.45 : 0}
                appearKey={appearKey}
                emitCursor={emitCursor}
              />
            </div>
          )}
          {!showsPet && !showsBead && <div className="stagebox__empty">Nothing will appear on screen.</div>}
        </div>

        <div className="showcase__tools">
          <div className="seg seg--tiny">
            {SCENES.map((s) => (
              <button key={s.id} className="seg__item" aria-current={scene === s.id} onPointerDown={() => setScene(s.id)}>
                {scene === s.id && <motion.span layoutId="scene-pill" className="seg__pill" transition={SPRING_SNAP} />}
                <span>{s.label}</span>
              </button>
            ))}
          </div>
          <span className="spacer" />
          {showsBead && (
            <>
              <button className="btn btn--small" onPointerDown={() => setAppearKey((n) => n + 1)}>
                Replay entrance
              </button>
              <button className="btn btn--small" onPointerDown={() => setEmitCursor(Date.now())}>
                Hand over the cursor
              </button>
            </>
          )}
          <button className="btn btn--small" aria-pressed={tour} onPointerDown={() => setTour((v) => !v)}>
            {tour ? <Icon.pause /> : <Icon.play />}
            {tour ? "Stop" : "Play every state"}
          </button>
        </div>
      </div>

      <div className="chips chips--wrap">
        {ACTIVITIES.map((a) => (
          <button
            key={a}
            className="chip"
            aria-pressed={activity === a}
            onPointerDown={() => {
              setTour(false);
              setActivity(a);
            }}
          >
            {ACTIVITY_LABEL[a]}
          </button>
        ))}
      </div>

      {showsPet && (
        <section className="block">
          <h3 className="block__title">Pet</h3>
          <div className="petgrid">
            {pets.map(({ spec, builtin }) => (
              <button
                key={spec.id}
                className="petcard"
                aria-pressed={companion.desktopPetId === spec.id}
                onPointerDown={() => patch({ desktopPetId: spec.id })}
              >
                {companion.desktopPetId === spec.id && (
                  <motion.span layoutId="pet-ring" className="petcard__ring" transition={SPRING} />
                )}
                <span className="petcard__art">
                  <Creature spec={spec} activity={activity} size={78} />
                </span>
                <b>{spec.name}</b>
                <span>{spec.description ?? (builtin ? "Built in" : spec.author)}</span>
                {!builtin && (
                  <span
                    className="petcard__remove"
                    role="button"
                    aria-label={`Remove ${spec.name}`}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      void removeCompanion(spec.id).then(() => setRegistry((n) => n + 1));
                    }}
                  >
                    <Icon.close />
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="card">
            <Setting label="Show the pet" help="All the time, or only while Conduit's window is closed or minimised.">
              <div className="seg">
                {(["always", "away"] as const).map((w) => (
                  <button key={w} className="seg__item" aria-current={companion.petWhen === w} onPointerDown={() => patch({ petWhen: w })}>
                    {companion.petWhen === w && <motion.span layoutId="when-pill" className="seg__pill" transition={SPRING_SNAP} />}
                    <span>{w === "always" ? "Always" : "When the window is away"}</span>
                  </button>
                ))}
              </div>
            </Setting>
            <Setting label="Wander around" help="Walks along the taskbar when nothing is happening.">
              <Switch checked={companion.petWander} onChange={(petWander) => patch({ petWander })} />
            </Setting>
            <Setting label="Size" help={`${Math.round(companion.petSize * 100)}%`}>
              <input
                type="range"
                min={0.7}
                max={1.6}
                step={0.05}
                value={companion.petSize}
                onChange={(e) => patch({ petSize: Number(e.target.value) })}
              />
            </Setting>
          </div>
        </section>
      )}

      {showsBead && (
        <section className="block">
          <h3 className="block__title">Bead</h3>
          {beads.length > 1 && (
            <div className="petgrid petgrid--small">
              {beads.map(({ spec }) => (
                <button
                  key={spec.id}
                  className="petcard"
                  aria-pressed={companion.dropletId === spec.id}
                  onPointerDown={() => patch({ dropletId: spec.id })}
                >
                  <span className="petcard__art petcard__art--bead">
                    <Creature spec={spec} activity={activity} size={40} />
                  </span>
                  <b>{spec.name}</b>
                </button>
              ))}
            </div>
          )}
          <div className="card">
            <Setting
              label="Wait before appearing"
              help={`${(companion.delay / 1000).toFixed(1)} s after the window goes away. It appears at once when Conduit starts working.`}
            >
              <input
                type="range"
                min={0}
                max={8000}
                step={200}
                value={companion.delay}
                onChange={(e) => patch({ delay: Number(e.target.value) })}
              />
            </Setting>
            <Setting label="Size" help={`${Math.round(companion.scale * 100)}%`}>
              <input
                type="range"
                min={0.75}
                max={1.6}
                step={0.05}
                value={companion.scale}
                onChange={(e) => patch({ scale: Number(e.target.value) })}
              />
            </Setting>
            <Setting label="Say what it is doing" help="A short caption beside the bead.">
              <Switch checked={companion.showCaption} onChange={(showCaption) => patch({ showCaption })} />
            </Setting>
            <Setting label="Stretch with movement" help="Leans and stretches as the cursor moves.">
              <Switch checked={companion.lean} onChange={(lean) => patch({ lean })} />
            </Setting>
            <Setting label="Also over Conduit's window" help="Off by default so it never covers the reply you are reading.">
              <Switch checked={companion.alwaysDuringWork} onChange={(alwaysDuringWork) => patch({ alwaysDuringWork })} />
            </Setting>
          </div>
        </section>
      )}

      <section className="block">
        <h3 className="block__title">Make your own</h3>
        <p className="block__sub">
          A pet is one JSON file: shapes, colours, and keyframes for each state. There is no code in it, which is why
          anyone&apos;s pet is safe to install. Share yours by sending a pull request to the store repository.
        </p>
        <div className="card">
          <Setting label="Start from a template" help="Writes a working pet you can edit, and opens the folder.">
            <button
              className="btn"
              disabled={!isTauri()}
              onPointerDown={async () => {
                const dir = await companionDir();
                await invoke("fs_mkdir", { path: dir }).catch(() => undefined);
                await invoke("fs_write", { path: `${dir}/my-pet.json`, contents: JSON.stringify(companionTemplate(), null, 2) });
                await invoke("open_target", { target: dir }).catch(() => undefined);
                setReport(await loadCompanions(true));
                setRegistry((n) => n + 1);
              }}
            >
              Create template
            </button>
          </Setting>
          <Setting label="Reload" help={folder || "Pick up edits without restarting."}>
            <button
              className="btn"
              onPointerDown={async () => {
                setReport(await loadCompanions(true));
                setRegistry((n) => n + 1);
              }}
            >
              <Icon.refresh /> Reload
            </button>
          </Setting>
        </div>
        <AnimatePresence>
          {report && report.rejected.length > 0 && (
            <motion.div
              className="card card--warn"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
            >
              <b>These files did not load</b>
              {report.rejected.map((r) => (
                <div key={r.file} className="rejected">
                  <code>{r.file}</code>
                  <span>{r.reason}</span>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </div>
  );
}

export function Setting({ label, help, children }: { label: string; help?: string; children?: React.ReactNode }) {
  return (
    <div className="setting">
      <div className="setting__text">
        <b>{label}</b>
        {help && <span>{help}</span>}
      </div>
      {children && <div className="setting__control">{children}</div>}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="switch" aria-label={label}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  );
}
