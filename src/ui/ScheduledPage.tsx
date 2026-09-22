import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { saveSettings } from "@/core/config";
import {
  describe,
  isRunning,
  nextRun,
  relative,
  runTask,
  TEMPLATES,
  type Cadence,
  type ScheduledTask,
} from "@/core/schedule";
import { useApp } from "@/core/store";
import { Switch } from "./CompanionPage";
import { Icon } from "./icons";
import { SPRING } from "./motion";

/**
 * Scheduled tasks: a prompt, a time, and a model.
 *
 * Laid out like a calendar's agenda rather than a settings form. The next
 * run is the most useful fact on each row, so it is the second thing you read.
 */

type Draft = Omit<ScheduledTask, "id" | "created" | "lastRun" | "lastConversationId">;

const blank = (): Draft => ({
  name: "",
  prompt: "",
  cadence: { kind: "daily", time: "09:00" },
  enabled: true,
  model: null,
  search: true,
  projectId: null,
});

const GLYPH: Record<string, JSX.Element> = {
  sun: <path d="M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z" />,
  grid: <path d="M5 5h5v5H5zM14 5h5v5h-5zM5 14h5v5H5zM14 14h5v5h-5z" />,
  eye: <path d="M3 12s3.2-6 9-6 9 6 9 6-3.2 6-9 6-9-6-9-6zM12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z" />,
  code: <path d="M8 7l-5 5 5 5M16 7l5 5-5 5" />,
  list: <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />,
  spark: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M12 8l1.4 2.6L16 12l-2.6 1.4L12 16l-1.4-2.6L8 12l2.6-1.4z" />,
  clock: <path d="M12 7v5l3 2M12 3.5a8.5 8.5 0 1 1 0 17 8.5 8.5 0 0 1 0-17z" />,
};

function Glyph({ name }: { name: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {GLYPH[name] ?? GLYPH.clock}
    </svg>
  );
}

export function ScheduledPage() {
  const tasks = useApp((s) => s.settings.schedules ?? []);
  useApp((s) => s.scheduleTick);
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [sort, setSort] = useState<"next" | "name">("next");

  const sorted = useMemo(() => {
    const list = [...tasks];
    if (sort === "name") return list.sort((a, b) => a.name.localeCompare(b.name));
    return list.sort((a, b) => (nextRun(a)?.getTime() ?? Infinity) - (nextRun(b)?.getTime() ?? Infinity));
  }, [tasks, sort]);

  const save = (id: string | null, draft: Draft) => {
    const { settings, setSettings } = useApp.getState();
    const schedules = id
      ? settings.schedules.map((t) => (t.id === id ? { ...t, ...draft } : t))
      : [
          ...settings.schedules,
          { ...draft, id: crypto.randomUUID(), created: Date.now(), lastRun: null, lastConversationId: null },
        ];
    const next = { ...settings, schedules };
    setSettings(next);
    void saveSettings(next);
    setEditing(null);
  };

  const patch = (id: string, p: Partial<ScheduledTask>) => {
    const { settings, setSettings } = useApp.getState();
    const next = { ...settings, schedules: settings.schedules.map((t) => (t.id === id ? { ...t, ...p } : t)) };
    setSettings(next);
    void saveSettings(next);
  };

  const remove = (id: string) => {
    const { settings, setSettings } = useApp.getState();
    const next = { ...settings, schedules: settings.schedules.filter((t) => t.id !== id) };
    setSettings(next);
    void saveSettings(next);
  };

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <h1 className="page__title">Scheduled</h1>
          <p className="page__sub">Tasks that run on their own at the times you pick. Each run lands as a new chat, with a notification.</p>
        </div>
        <div className="page__tools">
          {tasks.length > 1 && (
            <select className="select" value={sort} onChange={(e) => setSort(e.target.value as "next" | "name")}>
              <option value="next">Sort by next run</option>
              <option value="name">Sort by name</option>
            </select>
          )}
          <button className="btn btn--ink" onPointerDown={() => setEditing({ id: null, draft: blank() })}>
            <Icon.plus /> New task
          </button>
        </div>
      </header>

      <div className="notice--soft sched__note">
        Runs while Conduit is open or in the tray. Anything that would need your approval is skipped and listed in the result.
      </div>

      {tasks.length === 0 ? (
        <div className="sched__empty">
          <div className="sched__clock">
            <Glyph name="clock" />
          </div>
          <b>No scheduled tasks yet.</b>
          <span>Start from one of these, or write your own.</span>
        </div>
      ) : (
        <div className="cardlist">
          {sorted.map((task) => {
            const next = nextRun(task);
            const busy = isRunning(task.id);
            return (
              <div key={task.id} className="lrow sched__row" data-off={!task.enabled}>
                <span className="sched__icon">
                  {busy ? <span className="spin" /> : <Glyph name="clock" />}
                </span>
                <button className="lrow__text sched__main" onPointerDown={() => setEditing({ id: task.id, draft: { ...task } })}>
                  <b>{task.name}</b>
                  <span>
                    {describe(task.cadence)}
                    {task.lastRun && ` · last ran ${new Date(task.lastRun).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" })}`}
                    {task.lastStatus === "failed" && " · failed"}
                  </span>
                </button>
                <span className="sched__next">{busy ? "Running…" : relative(next)}</span>
                {task.lastConversationId && (
                  <button className="btn btn--small" onPointerDown={() => useApp.getState().selectConversation(task.lastConversationId!)}>
                    Last result
                  </button>
                )}
                <button className="btn btn--small" disabled={busy} onPointerDown={() => void runTask(task)}>
                  <Icon.play /> Run now
                </button>
                <Switch checked={task.enabled} label="Enabled" onChange={(enabled) => patch(task.id, { enabled })} />
                <button className="nav__icon" aria-label={`Delete ${task.name}`} onPointerDown={() => remove(task.id)}>
                  <Icon.trash />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="sched__divider" />
      <h3 className="block__title">Ideas</h3>
      <div className="sched__templates">
        {TEMPLATES.map((t) => (
          <button
            key={t.name}
            className="sched__tpl"
            onPointerDown={() =>
              setEditing({
                id: null,
                draft: { ...blank(), name: t.name, prompt: t.prompt, cadence: t.cadence, search: t.search },
              })
            }
          >
            <span className="sched__tplicon">
              <Glyph name={t.icon} />
            </span>
            <span className="sched__tpltext">
              <b>{t.name}</b>
              <span>{t.blurb}</span>
              <em>
                <Glyph name="clock" /> {describe(t.cadence)}
              </em>
            </span>
          </button>
        ))}
      </div>

      <AnimatePresence>
        {editing && (
          <Editor
            initial={editing.draft}
            isNew={editing.id === null}
            onCancel={() => setEditing(null)}
            onSave={(d) => save(editing.id, d)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function Editor({
  initial,
  isNew,
  onCancel,
  onSave,
}: {
  initial: Draft;
  isNew: boolean;
  onCancel: () => void;
  onSave: (d: Draft) => void;
}) {
  const [d, setD] = useState<Draft>(initial);
  const settings = useApp((s) => s.settings);
  const set = (p: Partial<Draft>) => setD((cur) => ({ ...cur, ...p }));
  const time = "time" in d.cadence ? d.cadence.time : "09:00";

  const setKind = (kind: Cadence["kind"]) => {
    const cadence: Cadence =
      kind === "hourly"
        ? { kind, every: 1 }
        : kind === "weekly"
          ? { kind, day: 1, time }
          : kind === "manual"
            ? { kind }
            : { kind, time };
    set({ cadence });
  };

  const models = [
    ...settings.customProviders.flatMap((p) => p.models.map((m) => ({ provider: p.id, model: m, label: p.label }))),
    ...Object.entries(settings.providerModels ?? {}).flatMap(([provider, list]) =>
      list.map((m) => ({ provider, model: m, label: provider })),
    ),
  ];

  return (
    <motion.div className="dialog-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onPointerDown={onCancel}>
      <motion.div
        className="dialog dialog--wide"
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 6 }}
        transition={SPRING}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <h2 className="dialog__title">{isNew ? "New scheduled task" : "Edit task"}</h2>
        <label className="form">
          <span>Name</span>
          <input className="input" autoFocus placeholder="Morning briefing" value={d.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className="form">
          <span>What should it do?</span>
          <textarea
            className="textarea"
            rows={5}
            placeholder="Search the web for…"
            value={d.prompt}
            onChange={(e) => set({ prompt: e.target.value })}
          />
        </label>
        <div className="form">
          <span>When</span>
          <div className="sched__when">
            <select className="select" value={d.cadence.kind} onChange={(e) => setKind(e.target.value as Cadence["kind"])}>
              <option value="daily">Every day</option>
              <option value="weekdays">Weekdays</option>
              <option value="weekly">Once a week</option>
              <option value="hourly">Every few hours</option>
              <option value="manual">Only when I run it</option>
            </select>
            {d.cadence.kind === "weekly" && (
              <select
                className="select"
                value={d.cadence.day}
                onChange={(e) => set({ cadence: { kind: "weekly", day: Number(e.target.value), time } })}
              >
                {DAYS.map((day, i) => (
                  <option key={day} value={i}>
                    {day}
                  </option>
                ))}
              </select>
            )}
            {d.cadence.kind === "hourly" && (
              <select
                className="select"
                value={d.cadence.every}
                onChange={(e) => set({ cadence: { kind: "hourly", every: Number(e.target.value) } })}
              >
                {[1, 2, 3, 4, 6, 8, 12].map((n) => (
                  <option key={n} value={n}>
                    every {n} {n === 1 ? "hour" : "hours"}
                  </option>
                ))}
              </select>
            )}
            {"time" in d.cadence && (
              <input
                className="input sched__time"
                type="time"
                value={time}
                onChange={(e) => set({ cadence: { ...(d.cadence as { kind: "daily"; time: string }), time: e.target.value } })}
              />
            )}
          </div>
        </div>
        <div className="sched__grid2">
          <label className="form">
            <span>Model</span>
            <select
              className="select"
              value={d.model ? `${d.model.provider}::${d.model.model}` : ""}
              onChange={(e) => {
                const [provider, model] = e.target.value.split("::");
                set({ model: e.target.value ? { provider, model } : null });
              }}
            >
              <option value="">The one chat is using</option>
              {models.map((m) => (
                <option key={`${m.provider}::${m.model}`} value={`${m.provider}::${m.model}`}>
                  {m.model} · {m.label}
                </option>
              ))}
            </select>
          </label>
          <label className="form">
            <span>Project</span>
            <select className="select" value={d.projectId ?? ""} onChange={(e) => set({ projectId: e.target.value || null })}>
              <option value="">None</option>
              {settings.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="sched__check">
          <input type="checkbox" checked={d.search} onChange={(e) => set({ search: e.target.checked })} />
          Allow web search
        </label>
        <div className="dialog__foot">
          <button className="btn" onPointerDown={onCancel}>
            Cancel
          </button>
          <button className="btn btn--ink" disabled={!d.name.trim() || !d.prompt.trim()} onPointerDown={() => onSave(d)}>
            {isNew ? "Create task" : "Save"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
