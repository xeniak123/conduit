/**
 * Saved prompts, reachable by typing `/`.
 *
 * The thing people actually do with an assistant is ask the same shaped
 * question over and over — review this, summarise that, write the commit
 * message. Retyping it each time is the friction that quietly decides whether
 * a tool becomes part of someone's day, so the shortcut has to be one
 * keystroke and the library has to ship with useful entries rather than an
 * empty state and an invitation to create one.
 */

export interface Prompt {
  id: string;
  /** What is typed after the slash. */
  trigger: string;
  title: string;
  hint: string;
  body: string;
  builtin?: boolean;
}

/**
 * The starter library.
 *
 * Chosen to cover the four audiences this has to serve on day one —
 * developers, people who write for a living, people running a business, and
 * anyone tidying up their own machine — so that whoever opens the app finds
 * something that speaks to their work.
 */
export const BUILTIN_PROMPTS: Prompt[] = [
  {
    id: "builtin.commit",
    trigger: "commit",
    title: "Write a commit message",
    hint: "Reads the staged diff and drafts it",
    builtin: true,
    body:
      "Look at the staged changes with git.diff (staged: true). Write a Conventional " +
      "Commits message for them: a subject under 50 characters, and a body only if the " +
      "reason for the change is not obvious from the diff. Put the final message on the " +
      "clipboard and show it to me.",
  },
  {
    id: "builtin.review",
    trigger: "review",
    title: "Review my changes",
    hint: "Uncommitted work, checked for real problems",
    builtin: true,
    body:
      "Read my uncommitted changes with git.diff and review them. Report only things " +
      "that would actually cause a problem: bugs, broken edge cases, security issues, " +
      "accidental deletions. For each one give the file, what breaks, and the fix. If " +
      "nothing is wrong, say so plainly rather than inventing nitpicks.",
  },
  {
    id: "builtin.explain",
    trigger: "explain",
    title: "Explain this code",
    hint: "Reads a file and walks through it",
    builtin: true,
    body:
      "Read {{file}} and explain what it does: the purpose of the file, how the main " +
      "pieces fit together, and anything surprising or easy to misread. Assume I am a " +
      "competent programmer who has never seen this code.",
  },
  {
    id: "builtin.whatschanged",
    trigger: "standup",
    title: "What did I do?",
    hint: "Recent commits, written up as a standup",
    builtin: true,
    body:
      "Look at the last 20 commits with git.log and summarise what I have been working " +
      "on, as three or four plain sentences I could read out in a standup. Group related " +
      "commits rather than listing them.",
  },
  {
    id: "builtin.rewrite",
    trigger: "rewrite",
    title: "Tighten this writing",
    hint: "Clearer, same voice, nothing lost",
    builtin: true,
    body:
      "Read what is on my clipboard and rewrite it to be clearer and shorter. Keep my " +
      "voice and register — do not make casual writing formal. Every idea must survive. " +
      "Put the result back on the clipboard and show me what changed and why.",
  },
  {
    id: "builtin.reply",
    trigger: "reply",
    title: "Draft a reply",
    hint: "Answers the message on the clipboard",
    builtin: true,
    body:
      "Read the message on my clipboard and draft a reply that {{intent}}. Match the " +
      "register of the original. Keep it short. Put the draft on the clipboard — do not " +
      "send anything.",
  },
  {
    id: "builtin.research",
    trigger: "research",
    title: "Research a question",
    hint: "Searches, reads sources, answers with links",
    builtin: true,
    body:
      "Research this and answer it properly: {{question}}\n\n" +
      "Search the web, read the two or three most useful results rather than trusting " +
      "snippets, and give me a direct answer with the links you relied on. If the sources " +
      "disagree, say so instead of picking one.",
  },
  {
    id: "builtin.cleanup",
    trigger: "space",
    title: "Where has my disk gone?",
    hint: "Finds what is taking up room",
    builtin: true,
    body:
      "Find what is using the most disk space in my home folder. List the ten largest " +
      "folders with their sizes. Do not delete anything — just tell me what you found and " +
      "which of it is likely safe to remove.",
  },
  {
    id: "builtin.port",
    trigger: "port",
    title: "What is on this port?",
    hint: "Identifies the process holding it",
    builtin: true,
    body: "Find out what is listening on port {{port}} and tell me what it is.",
  },
  {
    id: "builtin.setup",
    trigger: "setup",
    title: "Set up a project",
    hint: "Folder, git, and an editor session",
    builtin: true,
    body:
      "Create a folder called {{name}} in my Documents, initialise a git repository in " +
      "it, add a README with the project name as the heading, and open it in my editor.",
  },
];

/** `{{placeholders}}` the user is asked to fill before the prompt is sent. */
export function variablesIn(body: string): string[] {
  const found = new Set<string>();
  for (const match of body.matchAll(/\{\{\s*([a-z0-9_ -]+)\s*\}\}/gi)) {
    found.add(match[1].trim());
  }
  return [...found];
}

export function fillVariables(body: string, values: Record<string, string>): string {
  return body.replace(/\{\{\s*([a-z0-9_ -]+)\s*\}\}/gi, (_, name: string) => {
    return values[name.trim()] ?? "";
  });
}

/**
 * Filters and ranks the library for a `/query`.
 *
 * Matching a title anywhere was too loose: typing `/re` surfaced "Whe**re**
 * has my disk gone?", which reads as a bug to anyone reaching for `/review`.
 * Titles now have to match at a word boundary, and trigger matches always rank
 * above them — the trigger is what the user is actually typing.
 */
export function matchPrompts(all: Prompt[], query: string): Prompt[] {
  const q = query.trim().toLowerCase();
  if (!q) return all;

  const scored: Array<{ prompt: Prompt; score: number }> = [];

  for (const prompt of all) {
    const trigger = prompt.trigger.toLowerCase();
    const title = prompt.title.toLowerCase();

    // A single letter is almost always the first letter of a trigger somebody
    // already knows. Looser rules at that length bury the obvious answer under
    // everything that happens to contain the character.
    const loose = q.length > 1;

    let score = 0;
    if (trigger === q) score = 4;
    else if (trigger.startsWith(q)) score = 3;
    else if (loose && trigger.includes(q)) score = 2;
    else if (loose && startsAWord(title, q)) score = 1;

    if (score > 0) scored.push({ prompt, score });
  }

  return scored.sort((a, b) => b.score - a.score).map((s) => s.prompt);
}

/** True when the query begins a word in the text, not merely appears inside one. */
function startsAWord(text: string, query: string): boolean {
  return text.split(/[^a-z0-9]+/i).some((word) => word.startsWith(query));
}
