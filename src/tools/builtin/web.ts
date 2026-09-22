import { invoke } from "@tauri-apps/api/core";
import { register, schema, str, type Tool } from "../registry";

/**
 * Reaching the web.
 *
 * Deliberately keyless. Every search API worth using wants an account, and
 * requiring one before the agent can look anything up is a wall in front of a
 * feature people expect to just work. DuckDuckGo's HTML endpoint needs no
 * credential; anyone who wants ranked commercial results can point a plugin at
 * their own provider.
 */

interface ProxyResponse {
  status: number;
  body: string;
}

async function get(url: string): Promise<ProxyResponse> {
  return invoke<ProxyResponse>("proxy_send", {
    request: {
      url,
      method: "GET",
      headers: {
        // Without a browser-shaped agent the HTML endpoint serves a stub.
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        "accept-language": "en,*;q=0.5",
      },
      body: null,
      auth: null,
    },
  });
}

const searchTool: Tool = {
  name: "web.search",
  source: "builtin",
  description:
    "Search the web and return the top results with titles, URLs and snippets. " +
    "Use for anything time-sensitive, any fact you are unsure of, and any error " +
    "message you do not recognise.",
  parameters: schema({ query: str("What to search for") }, ["query"]),
  async run(input, ctx) {
    const query = String(input.query ?? "").trim();
    if (!query) return "No query given.";

    ctx.report(`Searching for ${query}…`);
    const response = await get(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    );

    if (response.status !== 200) {
      return `Search failed with status ${response.status}.`;
    }

    const results = parseResults(response.body).slice(0, 8);
    if (!results.length) return `No results for "${query}".`;

    return results
      .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
      .join("\n\n");
  },
};

const fetchTool: Tool = {
  name: "web.fetch",
  source: "builtin",
  description:
    "Fetch a web page and return its readable text. Use after web.search to " +
    "actually read a result, or when the user gives you a URL.",
  parameters: schema({ url: str("Absolute URL to fetch") }, ["url"]),
  async run(input, ctx) {
    const url = String(input.url ?? "").trim();
    if (!/^https?:\/\//i.test(url)) return "Only http and https URLs can be fetched.";

    ctx.report(`Reading ${new URL(url).hostname}…`);
    const response = await get(url);
    if (response.status !== 200) return `Fetch failed with status ${response.status}.`;

    const text = readable(response.body);
    // A long page will blow the context window; the model can fetch a more
    // specific URL if it needs the rest.
    return text.length > 12_000 ? `${text.slice(0, 12_000)}\n\n[truncated]` : text;
  },
};

interface Result {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Pulls results out of the HTML endpoint.
 *
 * A regex over HTML is normally a mistake; here the markup is a fixed,
 * decade-stable template and the alternative is shipping a DOM parser to read
 * eight links. If the layout changes this returns nothing, which surfaces as
 * "no results" rather than as wrong answers.
 */
function parseResults(html: string): Result[] {
  const results: Result[] = [];
  const blocks = html.split('class="result__body"').slice(1);

  for (const block of blocks) {
    const link = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    if (!link) continue;

    const snippet = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(block);
    results.push({
      title: decode(strip(link[2])),
      url: resolveRedirect(link[1]),
      snippet: snippet ? decode(strip(snippet[1])) : "",
    });
  }

  return results;
}

/** The HTML endpoint wraps every link in its own redirector. */
function resolveRedirect(href: string): string {
  const match = /[?&]uddg=([^&]+)/.exec(href);
  return match ? decodeURIComponent(match[1]) : href;
}

/** Strips markup, script and style, leaving something a model can read. */
function readable(html: string): string {
  return decode(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
      .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n"),
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function strip(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

function decode(text: string): string {
  const named: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&nbsp;": " ",
  };
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&[a-z]+;|&#\d+;/gi, (m) =>
      named[m] ?? (m.startsWith("&#") ? String.fromCharCode(Number(m.slice(2, -1))) : m),
    )
    .replace(/[ \t]{2,}/g, " ");
}

export function registerWebTools(): void {
  register(searchTool, fetchTool);
}
