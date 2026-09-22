import { invoke } from "@tauri-apps/api/core";
import { getSettings } from "@/core/config";
import { register, schema, str, type Tool } from "../registry";

/**
 * Working in a codebase.
 *
 * These exist because `fs.write` is the wrong shape for editing code. Writing
 * a whole file back means the model has to reproduce every line it did not
 * intend to change, and the failure mode is silent: a file that looks edited
 * but has quietly lost a function nobody was looking at. A replacement that
 * must match existing text exactly cannot do that — if the anchor is not
 * there, or is there twice, the edit is refused and says so.
 *
 * The search tool is here for the same reason: a model that cannot find a
 * symbol will guess at one, and an invented API is the single most expensive
 * mistake an assistant makes in a repository.
 */

function isWindows(): boolean {
  return navigator.userAgent.includes("Windows");
}

/** Resolves against the active project, so nothing needs a path spelled out. */
function projectRoot(explicit?: unknown): string | undefined {
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
  const settings = getSettings();
  return settings.projects.find((p) => p.id === settings.activeProjectId)?.root;
}

async function shell(command: string, cwd?: string): Promise<{ out: string; code: number }> {
  const result = await invoke<{ stdout: string; stderr: string; code: number }>("run_command", {
    command,
    cwd: cwd ?? null,
  });
  return {
    out: [result.stdout, result.stderr].filter(Boolean).join("\n").trim(),
    code: result.code,
  };
}

const searchTool: Tool = {
  name: "code.search",
  source: "builtin",
  description:
    "Search the project's files for a string or regular expression. Read-only. Use " +
    "this before claiming a function, type or setting exists — and before editing, " +
    "to find everything that calls what you are about to change.",
  parameters: schema(
    {
      query: str("Text or regular expression to find"),
      glob: str("Restrict to matching files, e.g. '*.ts' or 'src/**/*.rs'"),
      path: str("Folder to search. Defaults to the active project."),
    },
    ["query"],
  ),
  async run(input) {
    const query = String(input.query ?? "").trim();
    if (!query) return "Give something to search for.";
    const cwd = projectRoot(input.path);
    if (!cwd) return "No project is open. Set one in Settings → Projects, or pass a path.";

    const glob = String(input.glob ?? "").trim();
    // ripgrep when it is there, because it respects .gitignore and will not
    // drown the answer in node_modules; findstr and grep are the fallbacks.
    const rg = await shell("rg --version", cwd);
    const command =
      rg.code === 0
        ? `rg --line-number --no-heading --color never --max-count 4 -S ${glob ? `--glob "${glob}" ` : ""}"${query.replace(/"/g, '\\"')}"`
        : isWindows()
          ? `findstr /S /N /I /C:"${query.replace(/"/g, '""')}" ${glob || "*.*"}`
          : `grep -rnI --exclude-dir=node_modules --exclude-dir=.git "${query.replace(/"/g, '\\"')}" .`;

    const result = await shell(command, cwd);
    if (!result.out) return `No match for "${query}".`;

    const lines = result.out.split("\n");
    const shown = lines.slice(0, 60).join("\n");
    return lines.length > 60
      ? `${shown}\n\n[${lines.length - 60} more matches — narrow the search]`
      : shown;
  },
};

const readTool: Tool = {
  name: "code.read",
  source: "builtin",
  description:
    "Read a source file with line numbers, optionally a range of it. Read-only. " +
    "Read before you edit — code.edit needs text that matches the file exactly.",
  parameters: schema(
    {
      path: str("File path"),
      from: { type: "number", description: "First line, 1-based. Omit to start at the top." },
      to: { type: "number", description: "Last line. Omit to read to the end." },
    },
    ["path"],
  ),
  async run(input) {
    const text = await invoke<string>("fs_read", {
      path: String(input.path),
      limit: 400_000,
    });

    const lines = text.split("\n");
    const from = Math.max(1, Number(input.from) || 1);
    const to = Math.min(lines.length, Number(input.to) || lines.length);

    const slice = lines.slice(from - 1, to);
    // Line numbers, because every later instruction about this file will be
    // about a line, and counting them by hand is exactly the kind of thing a
    // model gets wrong.
    const numbered = slice.map((line, i) => `${String(from + i).padStart(5)}  ${line}`).join("\n");

    const head = `${input.path} (${lines.length} lines${from > 1 || to < lines.length ? `, showing ${from}–${to}` : ""})`;
    return `${head}\n\n${numbered}`;
  },
};

const editTool: Tool = {
  name: "code.edit",
  source: "builtin",
  dangerous: true,
  description:
    "Replace an exact piece of text in a file. `find` must appear in the file " +
    "exactly once, including its indentation — if it appears zero times or more " +
    "than once the edit is refused rather than applied to the wrong place. Read " +
    "the file first and copy the text you want to replace.",
  parameters: schema(
    {
      path: str("File path"),
      find: str("The exact existing text, including indentation and line breaks"),
      replace: str("What to put in its place"),
    },
    ["path", "find", "replace"],
  ),
  async run(input) {
    const path = String(input.path);
    const find = String(input.find ?? "");
    const replace = String(input.replace ?? "");

    if (!find) return "Give the text to replace. To create a file, use fs.write.";
    if (find === replace) return "The replacement is identical to what is already there.";

    const text = await invoke<string>("fs_read", { path, limit: 2_000_000 });

    // Counted rather than replaced, so an ambiguous anchor is a refusal with
    // an explanation instead of an edit in the wrong place.
    let count = 0;
    let index = text.indexOf(find);
    let first = index;
    while (index !== -1) {
      count += 1;
      if (count > 1) break;
      index = text.indexOf(find, index + find.length);
    }

    if (count === 0) {
      const loose = find.trim().split("\n")[0]?.trim();
      const nearby = loose && text.includes(loose);
      return nearby
        ? `That text is not in ${path}, though "${loose.slice(0, 60)}" appears. The indentation or line endings probably differ — read the file and copy the text exactly.`
        : `That text is not in ${path}. Read the file and copy the text you mean to replace.`;
    }
    if (count > 1) {
      return `That text appears more than once in ${path}. Include enough surrounding lines to make it unique.`;
    }

    const next = text.slice(0, first) + replace + text.slice(first + find.length);
    remember(path, text);
    await invoke("fs_write", { path, contents: next });

    const line = text.slice(0, first).split("\n").length;
    const removed = find.split("\n").length;
    const added = replace.split("\n").length;
    return `Edited ${path} at line ${line}: ${removed} line(s) replaced with ${added}.`;
  },
};

const treeTool: Tool = {
  name: "code.tree",
  source: "builtin",
  description:
    "List the project's source files, skipping dependency and build folders. " +
    "Read-only. Use to get oriented before searching blindly.",
  parameters: schema({
    path: str("Folder. Defaults to the active project."),
    depth: { type: "number", description: "How deep to go, default 3" },
  }),
  async run(input) {
    const cwd = projectRoot(input.path);
    if (!cwd) return "No project is open. Set one in Settings → Projects, or pass a path.";
    const depth = Math.min(Math.max(Number(input.depth) || 3, 1), 6);

    // `git ls-files` is the best possible answer when it applies: it is the
    // project's own idea of what counts as a source file.
    const tracked = await shell("git ls-files", cwd);
    if (tracked.code === 0 && tracked.out) {
      const files = tracked.out
        .split("\n")
        .filter((f) => f.split("/").length <= depth + 1)
        .slice(0, 300);
      return `${files.length} file(s) tracked by git:\n${files.join("\n")}`;
    }

    const command = isWindows()
      ? `dir /S /B /A:-D | findstr /V /I "node_modules \\.git target dist build"`
      : `find . -type f -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/target/*" -not -path "*/dist/*" -maxdepth ${depth}`;
    const result = await shell(command, cwd);
    const files = result.out.split("\n").slice(0, 300);
    return files.join("\n") || "No files found.";
  },
};

const testTool: Tool = {
  name: "code.test",
  source: "builtin",
  dangerous: true,
  description:
    "Run the project's test command and report what happened. Use after changing " +
    "code — and never claim tests pass without calling this.",
  parameters: schema({
    command: str("Command to run. Defaults to the one set in Settings → Code."),
    path: str("Folder to run in. Defaults to the active project."),
  }),
  async run(input, ctx) {
    const configured = getSettings().code.testCommand.trim();
    const command = String(input.command ?? "").trim() || configured;
    if (!command) {
      return "No test command is set. Put one in Settings → Code, or pass one here.";
    }

    ctx.report(`Running ${command}`);
    const result = await shell(command, projectRoot(input.path));

    // The tail, not the head: a failing run puts its summary at the end, and
    // the first 200 lines of a build log are almost never the interesting part.
    const lines = result.out.split("\n");
    const tail = lines.slice(-80).join("\n");
    const verdict = result.code === 0 ? "passed" : `failed (exit ${result.code})`;
    return `${command} ${verdict}.\n\n${tail}`;
  },
};

/**
 * What each file looked like before this conversation touched it.
 *
 * An assistant that edits the wrong line is recoverable; one that edits the
 * wrong line and cannot say what was there before is not. The first version of
 * a file is kept, so `code.undo` puts it back exactly, with no reliance on git
 * — plenty of the folders people point Conduit at are not repositories.
 */
const original = new Map<string, string>();

function remember(path: string, before: string): void {
  if (!original.has(path)) original.set(path, before);
}

const insertTool: Tool = {
  name: "code.insert",
  source: "builtin",
  dangerous: true,
  description:
    "Insert new lines into a file after a given line number, or at the end. Use " +
    "this to add a function, an import or a test — code.edit is for changing text " +
    "that is already there, and needs an anchor this does not.",
  parameters: schema(
    {
      path: str("File path"),
      text: str("The lines to insert"),
      after: {
        type: "number",
        description: "Insert after this line, 1-based. 0 puts it at the top; omit for the end.",
      },
    },
    ["path", "text"],
  ),
  async run(input) {
    const path = String(input.path);
    const addition = String(input.text ?? "");
    if (!addition.trim()) return "Give the text to insert.";

    const text = await invoke<string>("fs_read", { path, limit: 2_000_000 });
    const lines = text.split("\n");
    const at =
      input.after === undefined ? lines.length : Math.min(Math.max(Number(input.after) || 0, 0), lines.length);

    lines.splice(at, 0, ...addition.split("\n"));
    remember(path, text);
    await invoke("fs_write", { path, contents: lines.join("\n") });
    return `Inserted ${addition.split("\n").length} line(s) into ${path} after line ${at}.`;
  },
};

const undoTool: Tool = {
  name: "code.undo",
  source: "builtin",
  dangerous: true,
  description:
    "Put a file back the way it was before this conversation edited it. Use when " +
    "an edit turned out to be wrong, instead of trying to edit it back by hand.",
  parameters: schema({ path: str("File path. Omit to list what can be undone.") }),
  async run(input) {
    const path = String(input.path ?? "").trim();
    if (!path) {
      return original.size
        ? `Files this conversation changed:\n${[...original.keys()].join("\n")}`
        : "Nothing has been edited in this conversation.";
    }
    const before = original.get(path);
    if (before === undefined) return `${path} has not been edited in this conversation.`;
    await invoke("fs_write", { path, contents: before });
    original.delete(path);
    return `Put ${path} back the way it was.`;
  },
};

const diffTool: Tool = {
  name: "code.diff",
  source: "builtin",
  description:
    "Show what has changed in the project but is not committed yet. Read-only. Use " +
    "before finishing, to check that what you changed is what you meant to.",
  parameters: schema({
    path: str("Limit to one file or folder"),
    stat: { type: "boolean", description: "Only the per-file summary, not the lines" },
  }),
  async run(input) {
    const cwd = projectRoot();
    if (!cwd) return "No project is open. Set one in Settings → Projects.";
    const target = String(input.path ?? "").trim();
    const result = await shell(`git diff ${input.stat ? "--stat" : "--unified=3"} -- ${target || "."}`, cwd);
    if (result.code !== 0) return "This folder is not a git repository, so there is nothing to compare against.";
    if (!result.out) return "No uncommitted changes.";
    const lines = result.out.split("\n");
    return lines.length > 200
      ? `${lines.slice(0, 200).join("\n")}\n\n[truncated — ask for one path, or pass stat]`
      : result.out;
  },
};

/**
 * Definitions in a file, without reading the file.
 *
 * Deliberately a regular expression rather than a parser: it has to work on
 * whatever the user has open, including languages nothing is installed for, and
 * a list of names and line numbers is enough to decide what to read next.
 */
const DEFINITION =
  /^\s*(?:export\s+)?(?:pub\s+|public\s+|private\s+|protected\s+|static\s+|async\s+|default\s+)*(?:function|fn|def|class|struct|enum|trait|impl|interface|type|const|let|var)\s+([A-Za-z_$][\w$]*)/;

const outlineTool: Tool = {
  name: "code.outline",
  source: "builtin",
  description:
    "List what a file defines — functions, types, classes — with line numbers. " +
    "Read-only. Cheaper than reading a long file when you only need to find the " +
    "part that matters.",
  parameters: schema({ path: str("File path") }, ["path"]),
  async run(input) {
    const path = String(input.path);
    const text = await invoke<string>("fs_read", { path, limit: 2_000_000 });
    const found: string[] = [];
    text.split("\n").forEach((line, i) => {
      if (DEFINITION.test(line)) found.push(`${String(i + 1).padStart(5)}  ${line.trim().slice(0, 100)}`);
    });
    if (!found.length) return `Nothing that looks like a definition in ${path}. Read it instead.`;
    return `${path}\n\n${found.slice(0, 200).join("\n")}`;
  },
};

/** Manifests worth looking for, and what each one means. */
const MANIFESTS = [
  ["package.json", "Node"],
  ["Cargo.toml", "Rust"],
  ["pyproject.toml", "Python"],
  ["requirements.txt", "Python"],
  ["go.mod", "Go"],
  ["pom.xml", "Java"],
  ["Gemfile", "Ruby"],
  ["composer.json", "PHP"],
] as const;

/**
 * The orientation step, in one call.
 *
 * Without it a run spends three or four calls working out what kind of project
 * this is, and still guesses the test command wrong. This reads the manifests
 * the project actually has and says what it found.
 */
const contextTool: Tool = {
  name: "code.context",
  source: "builtin",
  description:
    "What kind of project this is: its manifests, its scripts, its test command " +
    "and what is currently uncommitted. Read-only. Call this first in an " +
    "unfamiliar codebase.",
  parameters: schema({ path: str("Folder. Defaults to the active project.") }),
  async run(input) {
    const cwd = projectRoot(input.path);
    if (!cwd) return "No project is open. Set one in Settings → Projects, or pass a path.";

    const out: string[] = [`Project: ${cwd}`];

    for (const [file, stack] of MANIFESTS) {
      try {
        const text = await invoke<string>("fs_read", { path: `${cwd}/${file}`, limit: 40_000 });
        out.push(`\n${file} (${stack})`);
        if (file === "package.json") {
          const parsed = JSON.parse(text) as { scripts?: Record<string, string> };
          const scripts = Object.entries(parsed.scripts ?? {});
          if (scripts.length) out.push(...scripts.map(([name, body]) => `  npm run ${name} → ${body}`));
        }
      } catch {
        // Not that kind of project. That is an answer too.
      }
    }

    const configured = getSettings().code.testCommand.trim();
    if (configured) out.push(`\nTest command set in Settings: ${configured}`);

    const status = await shell("git status --short --branch", cwd);
    out.push(
      status.code === 0
        ? `\ngit\n${status.out.split("\n").slice(0, 30).join("\n")}`
        : "\nNot a git repository — there is nothing to fall back on if an edit is wrong.",
    );

    return out.join("\n");
  },
};

export function registerCodeTools(): void {
  register(
    searchTool,
    readTool,
    editTool,
    treeTool,
    testTool,
    insertTool,
    undoTool,
    diffTool,
    outlineTool,
    contextTool,
  );
}
