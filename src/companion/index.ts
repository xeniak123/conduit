import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/core/host";
import { BUILTIN_COMPANIONS } from "./builtin";
import { parseSpec, SpecError, type CompanionSpec } from "./spec";

export * from "./spec";
export { Creature } from "./Creature";
export { activityForTool } from "./runtime";
export { BUILTIN_COMPANIONS } from "./builtin";

/**
 * Where companions come from.
 *
 * Built-ins and downloads live in one list and are told apart by a flag, not
 * by a separate code path. A community pet that could not be selected the same
 * way, animated the same way, or previewed the same way would be a demo of
 * openness rather than the real thing.
 */

export interface LoadedCompanion {
  spec: CompanionSpec;
  builtin: boolean;
  /** Absolute path, for installed ones — shown so people can find and edit them. */
  path?: string;
}

let cache: LoadedCompanion[] = BUILTIN_COMPANIONS.map((spec) => ({ spec, builtin: true }));
let loaded = false;

export function listCompanions(): LoadedCompanion[] {
  return cache;
}

export function getCompanion(id: string): CompanionSpec | undefined {
  return cache.find((c) => c.spec.id === id)?.spec;
}

/** Falls back to the droplet rather than to nothing: an absent pet is a bug
 *  the user did not cause, and an empty companion window looks like a crash. */
export function companionOr(id: string | undefined, kind: "droplet" | "pet"): CompanionSpec {
  const found = id ? getCompanion(id) : undefined;
  if (found) return found;
  return (
    cache.find((c) => c.spec.kind === kind)?.spec ?? BUILTIN_COMPANIONS[0]
  );
}

export async function companionDir(): Promise<string> {
  const base = await invoke<string>("data_dir");
  return `${base}/companions`;
}

export interface LoadReport {
  loaded: number;
  /** Files that did not parse, with the reason — surfaced in Settings so an
   *  author sees the mistake instead of a pet that silently never appears. */
  rejected: Array<{ file: string; reason: string }>;
}

/**
 * Reads every companion in `~/.conduit/companions`.
 *
 * One bad file must not take the others down with it, so each is parsed on its
 * own and failures are collected rather than thrown.
 */
export async function loadCompanions(force = false): Promise<LoadReport> {
  if (loaded && !force) return { loaded: cache.length, rejected: [] };
  loaded = true;

  const report: LoadReport = { loaded: 0, rejected: [] };
  const found: LoadedCompanion[] = [];

  if (isTauri()) {
    try {
      const dir = await companionDir();
      const entries = await invoke<Array<{ name: string; directory: boolean }>>("fs_list", {
        path: dir,
      }).catch(() => []);

      for (const entry of entries) {
        if (entry.directory || !entry.name.endsWith(".json")) continue;
        const path = `${dir}/${entry.name}`;
        try {
          const text = await invoke<string>("fs_read", { path, limit: 400_000 });
          const spec = parseSpec(JSON.parse(text));
          found.push({ spec, builtin: false, path });
        } catch (e) {
          report.rejected.push({
            file: entry.name,
            reason: e instanceof SpecError || e instanceof Error ? e.message : String(e),
          });
        }
      }
    } catch {
      // No companions folder yet. That is the normal first-run state, not a
      // failure worth reporting.
    }
  }

  // An installed companion with the same id as a built-in replaces it, which
  // is how somebody re-skins the default droplet without patching the app.
  const overridden = new Set(found.map((c) => c.spec.id));
  cache = [
    ...BUILTIN_COMPANIONS.filter((spec) => !overridden.has(spec.id)).map((spec) => ({
      spec,
      builtin: true,
    })),
    ...found,
  ];
  report.loaded = cache.length;
  return report;
}

/** Writes a companion to disk and adds it to the list without a restart. */
export async function installCompanion(raw: unknown): Promise<CompanionSpec> {
  const spec = parseSpec(raw);
  const dir = await companionDir();
  await invoke("fs_mkdir", { path: dir }).catch(() => undefined);
  await invoke("fs_write", {
    path: `${dir}/${spec.id}.json`,
    contents: JSON.stringify(raw, null, 2),
  });
  await loadCompanions(true);
  return spec;
}

export async function removeCompanion(id: string): Promise<void> {
  const dir = await companionDir();
  await invoke("fs_remove", { path: `${dir}/${id}.json` });
  await loadCompanions(true);
}

/**
 * A starting point for somebody writing their own.
 *
 * Handing over a working file beats handing over a schema: most people learn a
 * format by changing something in one that already runs.
 */
export function companionTemplate(): CompanionSpec {
  return {
    id: "my-pet",
    name: "My pet",
    kind: "pet",
    author: "you",
    version: "1.0.0",
    license: "MIT",
    description: "Change the shapes and the keyframes; everything else follows.",
    viewBox: "0 0 100 100",
    palette: { ink: "#fffefc", body: "#2a2b35" },
    parts: [
      {
        id: "body",
        origin: [50, 72],
        shapes: [
          { kind: "circle", cx: 50, cy: 58, r: 26, fill: "token:body", stroke: "#ffffff", width: 1.1 },
        ],
      },
      {
        id: "eye",
        origin: [50, 54],
        shapes: [{ kind: "circle", cx: 50, cy: 54, r: 6, fill: "token:ink" }],
      },
    ],
    states: {
      idle: {
        loop: 3,
        tracks: {
          body: [{ t: 0, sy: 1 }, { t: 0.5, sy: 1.04 }, { t: 1, sy: 1 }],
          eye: [
            { t: 0, sy: 1, ease: "linear" },
            { t: 0.6, sy: 1, ease: "linear" },
            { t: 0.64, sy: 0.08, ease: "out" },
            { t: 0.68, sy: 1, ease: "out" },
            { t: 1, sy: 1, ease: "linear" },
          ],
        },
      },
      working: {
        loop: 0.9,
        tracks: { body: [{ t: 0, y: 0 }, { t: 0.5, y: -4 }, { t: 1, y: 0 }] },
      },
    },
  };
}
