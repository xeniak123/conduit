import { invoke } from "@tauri-apps/api/core";
import { register, schema, str, type Tool } from "../registry";

/**
 * Running things, and opening things.
 *
 * Both used to go through Tauri's shell and opener plugins, and both were
 * refused at runtime — `program not allowed on the configured shell scope`
 * and `open_path not allowed by ACL`. Those plugins gate on an allowlist in
 * the capability file, which is the wrong model for an assistant whose whole
 * purpose is running whatever the user just asked for.
 *
 * Conduit's permission profile is the gate instead, and the confirmation
 * dialog shows the verbatim command line rather than a summary of it.
 */

export interface Output {
  stdout: string;
  stderr: string;
  code: number;
}

const runTool: Tool = {
  name: "shell.run",
  source: "builtin",
  dangerous: true,
  description:
    "Run a command line and return its output. Use for CLI tools (git, npm, " +
    "python, claude), scripts, and anything without a dedicated tool. Pipes and " +
    "redirection work. On Windows this is cmd; elsewhere it is sh.",
  parameters: schema(
    {
      command: str("The full command line to execute"),
      cwd: str("Folder to run in. Optional; defaults to the user's home or the active project."),
    },
    ["command"],
  ),
  async run(input, ctx) {
    const command = String(input.command).trim();
    if (!command) return "No command given.";

    ctx.report(`Running ${command.split(/\s+/)[0]}…`);

    const result = await invoke<Output>("run_command", {
      command,
      cwd: input.cwd ? String(input.cwd) : null,
    });

    const body = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();

    // A non-zero exit is information, not a failure to hide: the model needs
    // the code *and* the output to decide what to do next.
    if (result.code !== 0) {
      return `Exit code ${result.code}\n${body || "(no output)"}`;
    }
    return body || "Finished with no output.";
  },
};

const openTool: Tool = {
  name: "app.open",
  source: "builtin",
  description:
    "Open an application, file, folder or URL the way double-clicking it would. " +
    "Prefer this over a shell command whenever the goal is simply 'open X' — it " +
    "finds applications the system knows by name, without needing a path.",
  parameters: schema(
    { target: str("Application name, file path, folder, or URL") },
    ["target"],
  ),
  run: (input) => invoke<string>("open_target", { target: String(input.target) }),
};

const keysTool: Tool = {
  name: "keys.press",
  source: "builtin",
  description:
    "Send a keyboard shortcut to whatever window has focus, e.g. ['ctrl','s'] to " +
    "save or ['alt','tab'] to switch application. This is how Conduit drives " +
    "applications that expose no API.",
  parameters: schema(
    {
      keys: {
        type: "array",
        items: { type: "string" },
        description: "Keys pressed together, modifiers first, e.g. ['ctrl','shift','p']",
      },
    },
    ["keys"],
  ),
  async run(input) {
    const keys = (input.keys as string[]) ?? [];
    if (!keys.length) return "No keys given.";
    await invoke("press_keys", { keys });
    return `Pressed ${keys.join("+")}.`;
  },
};

const typeTool: Tool = {
  name: "text.insert",
  source: "builtin",
  description:
    "Type text into the focused window. Use for filling a field or composing a " +
    "message in an application that has no API.",
  parameters: schema({ text: str("Text to type") }, ["text"]),
  async run(input) {
    const text = String(input.text ?? "");
    await invoke("type_text", { text });
    return `Typed ${text.length} characters into the focused window.`;
  },
};

const focusTool: Tool = {
  name: "app.focused",
  source: "builtin",
  description:
    "Report which application and window the user has in front. Call this when " +
    "the request says 'here', 'this window', or 'what I'm looking at'.",
  parameters: schema({}),
  async run(_input, ctx) {
    if (!ctx.focus.process) return "Could not determine the focused window.";
    return `${ctx.focus.process} — "${ctx.focus.title}"`;
  },
};

export function registerSystemTools(): void {
  register(runTool, openTool, keysTool, typeTool, focusTool);
}
