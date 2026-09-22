import {
  siAlibabacloud,
  siAnthropic,
  siAsana,
  siAtlassian,
  siBrave,
  siClaude,
  siClaudecode,
  siCloudflare,
  siConfluence,
  siCursor,
  siDeepseek,
  siDiscord,
  siDocker,
  siDuckduckgo,
  siFigma,
  siGit,
  siGithub,
  siGmail,
  siGoogle,
  siGooglecalendar,
  siGoogledrive,
  siGooglegemini,
  siHuggingface,
  siJira,
  siKimi,
  siLinear,
  siLmstudio,
  siMeta,
  siMinimax,
  siMistralai,
  siModelcontextprotocol,
  siMongodb,
  siNotion,
  siNvidia,
  siObsidian,
  siOllama,
  siOpencode,
  siOpenrouter,
  siPerplexity,
  siPostgresql,
  siPuppeteer,
  siQwen,
  siRedis,
  siSentry,
  siShopify,
  siSpotify,
  siSqlite,
  siStripe,
  siSupabase,
  siTelegram,
  siTodoist,
  siVercel,
  siVllm,
  siWindsurf,
  siX,
  siZapier,
} from "simple-icons";

/**
 * Logos, so a list of forty model ids reads at a glance.
 *
 * Brand marks come from Simple Icons (CC0 paths, used to identify the
 * product, never to imply endorsement). A brand without a published mark gets
 * a monogram in its own colour rather than a guess at its logo.
 */

interface Mark {
  path?: string;
  hex: string;
  letter?: string;
}

const icon = (i: { path: string; hex: string }): Mark => ({ path: i.path, hex: `#${i.hex}` });
const mono = (letter: string, hex: string): Mark => ({ letter, hex });

const BRANDS: Record<string, Mark> = {
  anthropic: icon(siAnthropic),
  claude: icon(siClaude),
  claudecode: icon(siClaudecode),
  openai: mono("◎", "#10a37f"),
  codex: mono("◎", "#1a1a17"),
  google: icon(siGooglegemini),
  gemma: icon(siGoogle),
  huggingface: icon(siHuggingface),
  meta: icon(siMeta),
  mistral: icon(siMistralai),
  ollama: icon(siOllama),
  deepseek: icon(siDeepseek),
  qwen: icon(siQwen),
  alibaba: icon(siAlibabacloud),
  xai: icon(siX),
  nvidia: icon(siNvidia),
  kimi: icon(siKimi),
  minimax: icon(siMinimax),
  openrouter: icon(siOpenrouter),
  perplexity: icon(siPerplexity),
  lmstudio: icon(siLmstudio),
  vllm: icon(siVllm),
  microsoft: mono("M", "#0078d4"),
  groq: mono("G", "#f55036"),
  cerebras: mono("C", "#f15a29"),
  together: mono("T", "#0f6fff"),
  fireworks: mono("F", "#6720ff"),
  sambanova: mono("S", "#ee7624"),
  zai: mono("Z", "#2d5bff"),
  cohere: mono("C", "#39594d"),
  llamacpp: mono("ll", "#b55a2a"),
  local: mono("◆", "#ff6a1f"),
  // apps and tool servers
  github: icon(siGithub),
  git: icon(siGit),
  notion: icon(siNotion),
  supabase: icon(siSupabase),
  figma: icon(siFigma),
  linear: icon(siLinear),
  stripe: icon(siStripe),
  vercel: icon(siVercel),
  postgres: icon(siPostgresql),
  sqlite: icon(siSqlite),
  docker: icon(siDocker),
  gmail: icon(siGmail),
  calendar: icon(siGooglecalendar),
  drive: icon(siGoogledrive),
  jira: icon(siJira),
  confluence: icon(siConfluence),
  atlassian: icon(siAtlassian),
  asana: icon(siAsana),
  discord: icon(siDiscord),
  telegram: icon(siTelegram),
  spotify: icon(siSpotify),
  cloudflare: icon(siCloudflare),
  sentry: icon(siSentry),
  mongodb: icon(siMongodb),
  redis: icon(siRedis),
  puppeteer: icon(siPuppeteer),
  brave: icon(siBrave),
  duckduckgo: icon(siDuckduckgo),
  obsidian: icon(siObsidian),
  todoist: icon(siTodoist),
  zapier: icon(siZapier),
  shopify: icon(siShopify),
  cursor: icon(siCursor),
  windsurf: icon(siWindsurf),
  opencode: icon(siOpencode),
  mcp: icon(siModelcontextprotocol),
  slack: mono("#", "#4a154b"),
  playwright: mono("P", "#2ead33"),
  context7: mono("C7", "#0ea5e9"),
  aider: mono("A", "#14b014"),
  goose: mono("G", "#1a1a17"),
  cline: mono("C", "#1a1a17"),
  continue: mono("›", "#1a1a17"),
};

/** Which family a model belongs to, read from its id. */
export function brandForModel(model: string, provider?: string): string | null {
  const m = model.toLowerCase();
  const rules: Array<[RegExp, string]> = [
    [/claude|anthropic/, "anthropic"],
    [/gpt|(^|\/)o[1-9]\b|chatgpt|davinci|openai|codex/, "openai"],
    [/gemma/, "gemma"],
    [/gemini|google\//, "google"],
    [/llama|meta-/, "meta"],
    [/mistral|mixtral|devstral|magistral|codestral|ministral|pixtral/, "mistral"],
    [/deepseek/, "deepseek"],
    [/qwen|qwq/, "qwen"],
    [/grok|x-ai|xai/, "xai"],
    [/kimi|moonshot/, "kimi"],
    [/minimax/, "minimax"],
    [/glm|zhipu|z-ai/, "zai"],
    [/phi-|microsoft/, "microsoft"],
    [/nemotron|nvidia/, "nvidia"],
    [/command-r|cohere/, "cohere"],
    [/sonar|perplexity/, "perplexity"],
  ];
  for (const [re, brand] of rules) if (re.test(m)) return brand;
  return provider ? brandForProvider(provider) : null;
}

export function brandForProvider(id: string): string | null {
  const known: Record<string, string> = {
    anthropic: "anthropic",
    openai: "openai",
    google: "google",
    openrouter: "openrouter",
    huggingface: "huggingface",
    ollama: "ollama",
    lmstudio: "lmstudio",
    llamacpp: "llamacpp",
    vllm: "vllm",
    local: "local",
    deepseek: "deepseek",
    mistral: "mistral",
    xai: "xai",
    groq: "groq",
    moonshot: "kimi",
    qwen: "qwen",
    zai: "zai",
    together: "together",
    fireworks: "fireworks",
    cerebras: "cerebras",
    perplexity: "perplexity",
    nvidia: "nvidia",
    sambanova: "sambanova",
  };
  return known[id] ?? null;
}

/** For store items: matched on the id and name, e.g. `mcp-github`, "GitHub". */
export function brandForApp(id: string, name = ""): string | null {
  const text = `${id} ${name}`.toLowerCase();
  for (const key of Object.keys(BRANDS)) {
    if (key.length < 3) continue;
    if (new RegExp(`(^|[^a-z])${key}([^a-z]|$)`).test(text)) return key;
  }
  if (/postgres/.test(text)) return "postgres";
  if (/google calendar/.test(text)) return "calendar";
  if (/google drive/.test(text)) return "drive";
  return null;
}

export function hasBrand(key: string | null | undefined): boolean {
  return Boolean(key && BRANDS[key]);
}

/**
 * A logo on a soft tile. `badge` adds a small second mark in the corner, used
 * for "a Qwen model, from Hugging Face".
 */
export function BrandMark({
  brand,
  size = 28,
  fallback,
  badge,
}: {
  brand: string | null | undefined;
  size?: number;
  fallback?: string;
  badge?: string | null;
}) {
  const mark = brand ? BRANDS[brand] : undefined;
  const hex = mark?.hex ?? "#8a8a82";
  // Near-black marks would vanish on a dark tile, so they take the text colour.
  const dark = /^#(0|1|2)[0-9a-f](0|1|2)[0-9a-f](0|1|2)[0-9a-f]$/i.test(hex);
  const colour = dark ? "currentColor" : hex;
  const letter = mark?.letter ?? (fallback ?? "?").slice(0, 2).toUpperCase();
  const badgeMark = badge ? BRANDS[badge] : undefined;
  return (
    <span
      className="brand"
      style={{ width: size, height: size, ["--brand" as string]: dark ? "var(--text)" : hex }}
      aria-hidden
    >
      {mark?.path ? (
        <svg viewBox="0 0 24 24" width={size * 0.56} height={size * 0.56} fill={colour}>
          <path d={mark.path} />
        </svg>
      ) : (
        <b style={{ color: colour, fontSize: size * (letter.length > 1 ? 0.34 : 0.44) }}>{letter}</b>
      )}
      {badgeMark?.path && (
        <span className="brand__badge">
          <svg viewBox="0 0 24 24" width={size * 0.3} height={size * 0.3} fill={badgeMark.hex}>
            <path d={badgeMark.path} />
          </svg>
        </span>
      )}
    </span>
  );
}
