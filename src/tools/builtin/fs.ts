import { invoke } from "@tauri-apps/api/core";
import { register, schema, str, type Tool } from "../registry";

/**
 * Files and folders.
 *
 * These call Conduit's own native commands rather than Tauri's filesystem
 * plugin. The plugin refuses anything outside an allowlist declared in the
 * capability file, which meant every one of these failed at runtime with
 * `forbidden path` — including paths the user had explicitly asked about.
 *
 * Access is governed by the permission profile instead: visible, per-tool, and
 * changeable by the person whose machine it is.
 */

interface Entry {
  name: string;
  directory: boolean;
  size: number;
}

const READ_LIMIT = 20_000;

const mkdirTool: Tool = {
  name: "fs.mkdir",
  source: "builtin",
  description:
    "Create a folder. A relative path is resolved from the user's home, so " +
    "'Documents/project' means ~/Documents/project. Parent folders are created too.",
  parameters: schema({ path: str("Folder path, absolute or relative to home") }, ["path"]),
  run: (input) => invoke<string>("fs_mkdir", { path: String(input.path) }),
};

const writeTool: Tool = {
  name: "fs.write",
  source: "builtin",
  dangerous: true,
  description: "Write text to a file, creating it if needed and replacing it if it exists.",
  parameters: schema(
    { path: str("File path"), contents: str("Full text contents of the file") },
    ["path", "contents"],
  ),
  run: (input) =>
    invoke<string>("fs_write", {
      path: String(input.path),
      contents: String(input.contents ?? ""),
    }),
};

const readTool: Tool = {
  name: "fs.read",
  source: "builtin",
  description: "Read a text file and return its contents.",
  parameters: schema({ path: str("File path") }, ["path"]),
  run: (input) => invoke<string>("fs_read", { path: String(input.path), limit: READ_LIMIT }),
};

const listTool: Tool = {
  name: "fs.list",
  source: "builtin",
  description:
    "List what is in a folder. Returns folders first, then files with their sizes.",
  parameters: schema({ path: str("Folder path") }, ["path"]),
  async run(input) {
    const entries = await invoke<Entry[]>("fs_list", { path: String(input.path) });
    if (!entries.length) return "The folder is empty.";

    // Truncated with a count rather than silently: a model told "42 files"
    // knows to narrow its question instead of assuming it saw everything.
    const shown = entries.slice(0, 200);
    const lines = shown.map((e) => (e.directory ? `${e.name}/` : `${e.name}  ${size(e.size)}`));
    if (entries.length > shown.length) {
      lines.push(`… and ${entries.length - shown.length} more`);
    }
    return lines.join("\n");
  },
};

const deleteTool: Tool = {
  name: "fs.delete",
  source: "builtin",
  dangerous: true,
  description: "Delete a file or folder, including its contents. This cannot be undone.",
  parameters: schema({ path: str("Path to delete") }, ["path"]),
  run: (input) => invoke<string>("fs_remove", { path: String(input.path) }),
};

const existsTool: Tool = {
  name: "fs.exists",
  source: "builtin",
  description:
    "Check whether a path exists before acting on it. Cheap — prefer it over " +
    "attempting an operation and reading the error.",
  parameters: schema({ path: str("Path to check") }, ["path"]),
  async run(input) {
    const path = String(input.path);
    const found = await invoke<boolean>("fs_exists", { path });
    return found ? `${path} exists.` : `${path} does not exist.`;
  },
};

function size(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function registerFsTools(): void {
  register(mkdirTool, writeTool, readTool, listTool, deleteTool, existsTool);
}
