import { invoke } from "@tauri-apps/api/core";
import { getSettings } from "@/core/config";
import { isTauri } from "@/core/host";
import { register, schema, str, type Tool } from "@/tools/registry";

/**
 * Skills: instructions the agent loads only when they apply.
 *
 * The shape is deliberately the one Claude Code uses, because it is right and
 * because it means a skill somebody already wrote works here. A skill is a
 * folder with a `SKILL.md`, its front matter gives a name and a description,
 * and only those two lines go into the system prompt. The body — which may be
 * hundreds of lines — is fetched by a tool call when the agent decides it is
 * relevant.
 *
 * That ordering is the whole idea. Putting every skill's body in the prompt
 * would cost more context than the conversation and would make the model worse
 * at all of them; putting only the descriptions there costs a line each and
 * lets the model choose.
 */

export interface Skill {
  id: string;
  name: string;
  description: string;
  body: string;
  path: string;
}

let skills: Skill[] = [];

export function listSkills(): Skill[] {
  return skills;
}

/** Only the skills the user has switched on, which is what the prompt sees. */
export function activeSkills(): Skill[] {
  const enabled = new Set(getSettings().market.enabledSkills);
  return skills.filter((s) => enabled.has(s.id));
}

export function findSkill(name: string): Skill | undefined {
  const wanted = name.trim().toLowerCase();
  return (
    skills.find((s) => s.name.toLowerCase() === wanted) ??
    skills.find((s) => s.id.toLowerCase() === wanted)
  );
}

/**
 * Front matter, parsed strictly enough to be predictable.
 *
 * Only `name` and `description` are read, and both must be simple scalars.
 * Accepting a fuller YAML dialect here would mean a dependency and a parser
 * with its own surprises, for two fields.
 */
export function parseSkill(text: string, id: string, path: string): Skill | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return null;

  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/.exec(line.trim());
    if (!pair) continue;
    meta[pair[1]] = pair[2].trim().replace(/^["']|["']$/g, "");
  }

  if (!meta.name || !meta.description) return null;
  return {
    id,
    name: meta.name.slice(0, 64),
    description: meta.description.slice(0, 400),
    body: match[2].trim(),
    path,
  };
}

/** Reads every installed skill from `~/.conduit/skills`. */
export async function loadSkills(): Promise<Skill[]> {
  if (!isTauri()) {
    skills = [];
    return skills;
  }

  const found: Skill[] = [];
  try {
    const base = await invoke<string>("data_dir");
    const root = `${base}/skills`;
    const entries = await invoke<Array<{ name: string; directory: boolean }>>("fs_list", {
      path: root,
    }).catch(() => []);

    for (const entry of entries) {
      if (!entry.directory) continue;
      const path = `${root}/${entry.name}/SKILL.md`;
      const text = await invoke<string>("fs_read", { path, limit: 200_000 }).catch(() => "");
      if (!text) continue;
      const skill = parseSkill(text, entry.name, path);
      if (skill) found.push(skill);
    }
  } catch {
    // No skills folder yet. That is the first-run state, not a failure.
  }

  skills = found.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

/**
 * The line in the system prompt.
 *
 * Empty when nothing is installed, so a fresh install carries no dead weight.
 */
export function skillsPrompt(): string {
  const active = activeSkills();
  if (!active.length) return "";

  return [
    "",
    "Skills available. Each is a set of instructions for one kind of task.",
    "When a request matches one, call `skill.open` with its name and follow what",
    "it says before doing anything else. Do not guess at the contents.",
    "",
    ...active.map((s) => `- ${s.name}: ${s.description}`),
  ].join("\n");
}

const openSkill: Tool = {
  name: "skill.open",
  source: "builtin",
  description:
    "Read a skill's full instructions. Call this as soon as a request matches one " +
    "of the skills listed in the system prompt, and follow what it says.",
  parameters: schema({ name: str("The skill's name, exactly as listed") }, ["name"]),
  async run(input) {
    const skill = findSkill(String(input.name ?? ""));
    if (!skill) {
      const names = activeSkills().map((s) => s.name);
      return names.length
        ? `There is no skill called "${input.name}". Available: ${names.join(", ")}.`
        : "No skills are installed.";
    }
    return `# ${skill.name}\n\n${skill.body}`;
  },
};

export function registerSkillTools(): void {
  register(openSkill);
}
