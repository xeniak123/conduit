import { invoke } from "@tauri-apps/api/core";
import { installCompanion } from "@/companion";
import { getSettings, saveSettings, type InstalledItem, type McpServer } from "@/core/config";
import { isTauri } from "@/core/host";
import { useApp } from "@/core/store";
import { BUILTIN_CATALOG } from "./catalog";
import type { Registry, RegistryItem } from "./types";

export * from "./types";
export { BUILTIN_CATALOG } from "./catalog";

/**
 * The store.
 *
 * Everything installable lives in a repository on GitHub, as a `registry.json`
 * listing items and the files they need. That is the whole distribution
 * mechanism: no server to run, no account to hold, and a pull request is how
 * somebody publishes. The built-in catalogue is merged in so the store is
 * useful before a single network call succeeds.
 */

/** Requests go out through the native proxy, like every other request. */
async function fetchText(url: string): Promise<string> {
  if (!isTauri()) throw new Error("Not running in the desktop app.");
  const response = await invoke<{ status: number; body: string }>("proxy_send", {
    request: { url, method: "GET", headers: {}, body: null, auth: null },
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${url} answered ${response.status}.`);
  }
  return response.body;
}

/** `owner/repo`, `owner/repo@branch`, or a full URL to the JSON itself. */
export function registryUrl(source: string, path = "registry.json"): string {
  const trimmed = source.trim();
  if (/^https?:\/\//.test(trimmed)) {
    return path === "registry.json" ? trimmed : trimmed.replace(/registry\.json$/, path);
  }
  const [repo, ref = "main"] = trimmed.split("@");
  return `https://raw.githubusercontent.com/${repo}/${ref}/${path}`;
}

export interface CatalogResult {
  items: RegistryItem[];
  /** Null when the remote registry answered; a sentence when it did not. */
  remoteError: string | null;
  updated?: string;
}

let cached: CatalogResult | null = null;

/**
 * The full catalogue: built in, plus whatever the registry adds.
 *
 * A remote failure is reported rather than thrown. The store still works
 * offline, and saying so beats an empty screen that looks like a bug.
 */
export async function loadCatalog(force = false): Promise<CatalogResult> {
  if (cached && !force) return cached;

  const result: CatalogResult = { items: [...BUILTIN_CATALOG], remoteError: null };
  const source = getSettings().market.registry.trim();

  if (source) {
    try {
      const text = await fetchText(registryUrl(source));
      const parsed = JSON.parse(text) as Registry;
      const remote = (parsed.items ?? []).filter(isItem);
      // A remote entry with a built-in's id replaces it, so the registry can
      // correct a command that has moved without waiting for a release.
      const replaced = new Set(remote.map((i) => i.id));
      result.items = [
        ...BUILTIN_CATALOG.filter((i) => !replaced.has(i.id)),
        ...remote.map((i) => ({ ...i, builtin: false })),
      ];
      result.updated = parsed.updated;
    } catch (e) {
      result.remoteError = e instanceof Error ? e.message : String(e);
    }
  }

  cached = result;
  return result;
}

/** Rejects anything that is not shaped like an item, rather than trusting the file. */
function isItem(raw: unknown): raw is RegistryItem {
  if (!raw || typeof raw !== "object") return false;
  const item = raw as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    /^[a-z0-9][a-z0-9-]{1,48}$/.test(item.id) &&
    typeof item.name === "string" &&
    typeof item.summary === "string" &&
    ["mcp", "skill", "companion", "prompt-pack"].includes(item.kind as string)
  );
}

export function isInstalled(id: string): boolean {
  return getSettings().market.installed.some((i) => i.id === id);
}

async function dataDir(): Promise<string> {
  return invoke<string>("data_dir");
}

/**
 * Installs an item.
 *
 * Files land under `~/.conduit/<kind>/<id>/`. Destination names are validated
 * rather than trusted: a registry entry naming `../../autostart` would
 * otherwise be a working attack against anybody who installed it.
 */
export async function install(item: RegistryItem): Promise<InstalledItem> {
  const base = await dataDir();
  const folder = `${base}/${folderFor(item.kind)}/${item.id}`;

  const files: Record<string, string> = { ...(item.content ?? {}) };

  if (item.files) {
    const source = getSettings().market.registry;
    for (const [name, path] of Object.entries(item.files)) {
      files[name] = await fetchText(registryUrl(source, path));
    }
  }

  if (item.kind === "companion") {
    // Companions go through the companion loader, which validates the format
    // before anything is written — an invalid pet should fail at install time,
    // not silently fail to appear later.
    const body = Object.values(files)[0];
    if (!body) throw new Error("That companion has no file to install.");
    await installCompanion(JSON.parse(body));
  } else if (Object.keys(files).length) {
    await invoke("fs_mkdir", { path: folder });
    for (const [name, contents] of Object.entries(files)) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(name)) {
        throw new Error(`"${name}" is not a file name this can write.`);
      }
      await invoke("fs_write", { path: `${folder}/${name}`, contents });
    }
  }

  const record: InstalledItem = {
    id: item.id,
    kind: item.kind,
    name: item.name,
    version: item.version ?? "1.0.0",
    path: `${folderFor(item.kind)}/${item.id}`,
    at: Date.now(),
  };

  const settings = getSettings();
  const next = {
    ...settings,
    market: {
      ...settings.market,
      installed: [...settings.market.installed.filter((i) => i.id !== item.id), record],
      enabledSkills:
        item.kind === "skill"
          ? [...new Set([...settings.market.enabledSkills, item.id])]
          : settings.market.enabledSkills,
    },
    mcp:
      item.kind === "mcp" && item.mcp
        ? {
            servers: [
              ...settings.mcp.servers.filter((s) => s.id !== item.id),
              serverFrom(item),
            ],
          }
        : settings.mcp,
  };

  useApp.getState().setSettings(next);
  await saveSettings(next);
  return record;
}

/** Turns a catalogue entry into a configured server, secrets by name only. */
function serverFrom(item: RegistryItem): McpServer {
  const env: Record<string, string> = {};
  for (const field of item.mcp?.env ?? []) {
    env[field.name] = field.secret ? `secret:${field.secret}` : (field.value ?? "");
  }
  return {
    id: item.id,
    label: item.name,
    command: item.mcp?.command ?? "",
    args: item.mcp?.args ?? [],
    env,
    // Off until the user has had the chance to fill in whatever it needs. A
    // server that starts on install and immediately fails its own auth check
    // looks like a broken install rather than a missing token.
    enabled: !(item.mcp?.env ?? []).some((f) => f.secret),
    source: item.id,
  };
}

export async function uninstall(id: string): Promise<void> {
  const settings = getSettings();
  const record = settings.market.installed.find((i) => i.id === id);

  if (record && record.kind !== "companion") {
    const base = await dataDir();
    await invoke("fs_remove", { path: `${base}/${record.path}` }).catch(() => undefined);
  }

  const next = {
    ...settings,
    market: {
      ...settings.market,
      installed: settings.market.installed.filter((i) => i.id !== id),
      enabledSkills: settings.market.enabledSkills.filter((s) => s !== id),
    },
    mcp: { servers: settings.mcp.servers.filter((s) => s.id !== id) },
  };

  useApp.getState().setSettings(next);
  await saveSettings(next);
}

function folderFor(kind: RegistryItem["kind"]): string {
  switch (kind) {
    case "mcp":
      return "mcp";
    case "skill":
      return "skills";
    case "companion":
      return "companions";
    default:
      return "prompts";
  }
}
