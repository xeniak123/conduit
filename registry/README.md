# Conduit registry

Everything in Conduit's Store that does not ship with the app lives here.
Conduit reads `registry.json` from this repository and installs items from the
files next to it. There is no server: a pull request is how something gets
published.

## What can be listed

| Kind | What it is | Where its files go |
| --- | --- | --- |
| `mcp` | A tool server (Model Context Protocol). Listed as a command to run. | Nothing is downloaded; the command runs on install. |
| `skill` | Instructions the agent loads when a task matches. A `SKILL.md`. | `skills/<id>/SKILL.md` |
| `companion` | A desktop pet or a cursor bead. One JSON file. | `companions/<name>.json` |

Nothing in this repository is executable inside Conduit. Tool servers run as
their own processes, launched by a command the user sees before installing,
and every tool they offer asks for approval unless the user exempts it. Pets
are shapes and keyframes; the format has no way to express code.

## Adding a pet

1. Copy `companions/koi.json` and change it. Every field is described in
   `companion.schema.json`.
2. Open Conduit, Companion, Make your own, and drop your file in the folder it
   opens. It appears in the gallery on Reload, and any mistake is reported with
   the exact field that is wrong.
3. Add an entry to `registry.json` and open a pull request.

States a pet can animate: `idle`, `walking`, `held`, `sleeping`, `listening`,
`thinking`, `working`, `coding`, `reading`, `writing`, `searching`, `running`,
`screen`, `speaking`, `done`, `error`. Any state you leave out falls back to
`idle`.

## Adding a skill

A folder with a `SKILL.md` whose front matter has a `name` and a
`description`. Only those two lines go into the agent's prompt; the body is
read when a request matches, so write the description as "use when...".

## Adding a tool server

An entry with `kind: "mcp"`, the command and arguments, and any environment
variables it needs. Mark secrets with `"secret": "<name>"`: Conduit stores them
in the operating system's credential store and passes them to the process at
launch, so they never appear in a settings file.

Review checklist for maintainers: the command installs the package the entry
says it does, secrets are marked as secrets, and the summary says what the
server can change, not only what it can read.
