import { Marked, type Token, type TokenizerExtension } from "marked";

/**
 * The Markdown reader behind assistant replies.
 *
 * Replies are no longer "short prose with the occasional list": models answer
 * in tables, nested lists, task lists, maths and long code, and a hand-rolled
 * reader that knew six constructs showed the rest as raw pipes and dollar
 * signs. This is `marked`'s lexer (CommonMark plus GitHub's tables, task
 * lists and strikethrough) with one addition, TeX maths, turned into tokens
 * that the view renders itself. Nothing here produces HTML, so nothing a model
 * writes can become markup in the app.
 */

export type { Token };

export interface MathToken {
  type: "mathBlock" | "mathInline";
  raw: string;
  text: string;
  display?: boolean;
}

/** `$$ … $$` and `\[ … \]` on their own lines. */
const mathBlock: TokenizerExtension = {
  name: "mathBlock",
  level: "block",
  start(src) {
    const i = src.search(/\$\$|\\\[/);
    return i < 0 ? undefined : i;
  },
  tokenizer(src) {
    const match = /^\$\$([\s\S]+?)\$\$[ \t]*(?:\n+|$)/.exec(src) ?? /^\\\[([\s\S]+?)\\\][ \t]*(?:\n+|$)/.exec(src);
    if (match) return { type: "mathBlock", raw: match[0], text: match[1].trim() };
    return undefined;
  },
};

/**
 * `$ … $`, `\( … \)` and `$$ … $$` inside a sentence.
 *
 * The single-dollar form follows the rule most renderers use so that prices
 * survive: the opening dollar is followed by a non-space, the closing one is
 * preceded by a non-space and not followed by a digit. "$5 and $10" stays
 * text; "$x^2$" is maths.
 */
const mathInline: TokenizerExtension = {
  name: "mathInline",
  level: "inline",
  start(src) {
    const i = src.search(/\$|\\\(/);
    return i < 0 ? undefined : i;
  },
  tokenizer(src) {
    let match = /^\\\(([\s\S]+?)\\\)/.exec(src);
    if (match) return { type: "mathInline", raw: match[0], text: match[1].trim() };
    match = /^\$\$([^$]+?)\$\$/.exec(src);
    if (match) return { type: "mathInline", raw: match[0], text: match[1].trim(), display: true };
    match = /^\$(?=\S)([^$\n]*?\S)\$(?!\d)/.exec(src);
    if (match) return { type: "mathInline", raw: match[0], text: match[1] };
    return undefined;
  },
};

const reader = new Marked({ gfm: true, breaks: true });
reader.use({ extensions: [mathBlock, mathInline] });

export function lex(text: string): Token[] {
  try {
    return reader.lexer(text);
  } catch {
    // A reader must never take a reply down with it: the text as a paragraph
    // is always a correct, if plain, rendering.
    return [{ type: "paragraph", raw: text, text, tokens: [{ type: "text", raw: text, text }] } as Token];
  }
}

/**
 * Only links that go somewhere safe. A model can be talked into writing
 * `javascript:` or `file:` links by whatever it just read on the web.
 */
export function safeHref(href: string | undefined | null): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  return /^(https?:|mailto:)/i.test(trimmed) ? trimmed : null;
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

/** Text tokens keep entities as written; the view shows what they stand for. */
export function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (whole, body: string) => {
    if (body[0] === "#" && body !== "#39") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}
