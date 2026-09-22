import { invoke } from "@tauri-apps/api/core";
import {
  readText as readClipboard,
  writeText as writeClipboard,
} from "@tauri-apps/plugin-clipboard-manager";
import { getSettings } from "@/core/config";
import { register, schema, str, type Tool } from "../registry";

/**
 * The questions people actually ask a machine, given first-class tools.
 *
 * Everything here is reachable through `shell.run`, so why not leave it to
 * that? Because a dedicated tool with a narrow schema is gated differently:
 * `git.status` is read-only and can run without a prompt, while `shell.run`
 * cannot be — it could be anything. Splitting them is what lets the common,
 * harmless cases stop asking permission without loosening the general case.
 */

function isWindows(): boolean {
  return navigator.userAgent.includes("Windows");
}

/** Resolves against the active project, so "run the tests" needs no path. */
function projectRoot(explicit?: unknown): string | undefined {
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
  const settings = getSettings();
  return settings.projects.find((p) => p.id === settings.activeProjectId)?.root;
}

async function run(command: string, cwd?: string): Promise<{ out: string; code: number }> {
  const result = await invoke<{ stdout: string; stderr: string; code: number }>("run_command", {
    command,
    cwd: cwd ?? null,
  });
  return {
    out: [result.stdout, result.stderr].filter(Boolean).join("\n").trim(),
    code: result.code,
  };
}

const gitStatus: Tool = {
  name: "git.status",
  source: "builtin",
  description:
    "Show the current git branch and which files are modified, staged or untracked. " +
    "Read-only. Call this before answering anything about the state of the repository.",
  parameters: schema({ path: str("Repository folder. Defaults to the active project.") }),
  async run(input) {
    const cwd = projectRoot(input.path);
    const branch = await run("git rev-parse --abbrev-ref HEAD", cwd);
    if (branch.code !== 0) return "Not a git repository.";

    const status = await run("git status --porcelain=v1", cwd);
    const ahead = await run("git rev-list --count --left-right @{u}...HEAD", cwd);

    const files = status.out ? status.out.split("\n") : [];
    const lines = [`Branch: ${branch.out}`];

    if (ahead.code === 0 && ahead.out) {
      const [behind, forward] = ahead.out.split(/\s+/);
      lines.push(`${forward} ahead, ${behind} behind upstream.`);
    }
    lines.push(files.length ? `${files.length} changed file(s):` : "Working tree is clean.");
    lines.push(...files.slice(0, 40));

    return lines.join("\n");
  },
};

const gitDiff: Tool = {
  name: "git.diff",
  source: "builtin",
  description:
    "Show uncommitted changes as a diff. Read-only. Use before writing a commit " +
    "message or reviewing what has changed.",
  parameters: schema({
    path: str("Repository folder. Defaults to the active project."),
    staged: { type: "boolean", description: "Show staged changes instead of unstaged" },
  }),
  async run(input) {
    const cwd = projectRoot(input.path);
    const result = await run(`git diff${input.staged ? " --cached" : ""} --stat -p`, cwd);
    if (result.code !== 0) return result.out || "Not a git repository.";
    if (!result.out) return "No changes.";
    // A big diff is the usual case and the usual way to exhaust a context
    // window; the model can ask for one file if it needs more.
    return result.out.length > 14_000 ? `${result.out.slice(0, 14_000)}\n[truncated]` : result.out;
  },
};

const gitLog: Tool = {
  name: "git.log",
  source: "builtin",
  description: "Show recent commits, newest first. Read-only.",
  parameters: schema({
    path: str("Repository folder. Defaults to the active project."),
    count: { type: "number", description: "How many commits, default 15" },
  }),
  async run(input) {
    const count = Math.min(Math.max(Number(input.count) || 15, 1), 80);
    const result = await run(
      `git log -n ${count} --pretty=format:"%h  %ad  %an  %s" --date=short`,
      projectRoot(input.path),
    );
    return result.code === 0 ? result.out || "No commits." : "Not a git repository.";
  },
};

const portTool: Tool = {
  name: "net.port",
  source: "builtin",
  description:
    "Find out which process is listening on a TCP port. Answers 'what is running " +
    "on port 3000' without guessing.",
  parameters: schema({ port: { type: "number", description: "Port number" } }, ["port"]),
  async run(input) {
    const port = Number(input.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return "Give a valid port number.";

    if (isWindows()) {
      const found = await run(`netstat -ano -p tcp | findstr :${port}`);
      if (!found.out) return `Nothing is listening on port ${port}.`;

      const pid = found.out.trim().split(/\s+/).pop();
      const name = pid ? await run(`tasklist /FI "PID eq ${pid}" /NH /FO CSV`) : null;
      const process = name?.out.split(",")[0]?.replace(/"/g, "") ?? "unknown";
      return `Port ${port} is held by ${process} (PID ${pid}).\n\n${found.out}`;
    }

    const found = await run(`lsof -nP -iTCP:${port} -sTCP:LISTEN`);
    return found.out || `Nothing is listening on port ${port}.`;
  },
};

const processTool: Tool = {
  name: "proc.list",
  source: "builtin",
  description:
    "List running processes, optionally filtered by name. Read-only — use before " +
    "suggesting anything be stopped.",
  parameters: schema({ filter: str("Substring to match against the process name") }),
  async run(input) {
    const filter = String(input.filter ?? "").trim();

    const result = isWindows()
      ? await run(
          filter
            ? `tasklist /FI "IMAGENAME eq ${filter}*" /FO TABLE /NH`
            : "tasklist /FO TABLE /NH",
        )
      : await run(filter ? `ps aux | grep -i "${filter}" | grep -v grep` : "ps aux");

    const lines = result.out.split("\n").slice(0, 40);
    return lines.join("\n") || "No matching processes.";
  },
};

const clipboardRead: Tool = {
  name: "clipboard.read",
  source: "builtin",
  description:
    "Read what is currently on the clipboard. Use when the user says 'this', " +
    "'what I just copied', or pastes something by reference.",
  parameters: schema({}),
  async run() {
    const text = await readClipboard().catch(() => null);
    if (!text) return "The clipboard is empty, or holds something that is not text.";
    return text.length > 8000 ? `${text.slice(0, 8000)}\n[truncated]` : text;
  },
};

const clipboardWrite: Tool = {
  name: "clipboard.write",
  source: "builtin",
  description: "Put text on the clipboard so the user can paste it somewhere themselves.",
  parameters: schema({ text: str("Text to copy") }, ["text"]),
  async run(input) {
    const text = String(input.text ?? "");
    await writeClipboard(text);
    return `Copied ${text.length} characters to the clipboard.`;
  },
};

export function registerDevTools(): void {
  register(
    gitStatus,
    gitDiff,
    gitLog,
    portTool,
    processTool,
    clipboardRead,
    clipboardWrite,
  );
}
