/**
 * The Markdown reader behind assistant replies.
 *
 * Deliberately small rather than a library: replies are short prose with the
 * occasional code block or list, and a full parser plus a syntax highlighter
 * would outweigh the entire rest of the interface. Anything it does not
 * understand falls through as plain text, which is always safe.
 */

export type Block =
  | { kind: "code"; lang: string; body: string }
  | { kind: "heading"; level: number; body: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; body: string }
  | { kind: "para"; body: string };

export type InlinePart =
  | { type: "text" | "code" | "bold" | "em"; text: string }
  | { type: "link"; text: string; href: string };

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g;

export function splitInline(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  let last = 0;

  for (const match of text.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ type: "text", text: text.slice(last, index) });

    const token = match[0];
    if (token.startsWith("`")) {
      parts.push({ type: "code", text: token.slice(1, -1) });
    } else if (token.startsWith("**")) {
      parts.push({ type: "bold", text: token.slice(2, -2) });
    } else if (token.startsWith("[")) {
      const split = token.indexOf("](");
      parts.push({
        type: "link",
        text: token.slice(1, split),
        href: token.slice(split + 2, -1),
      });
    } else {
      parts.push({ type: "em", text: token.slice(1, -1) });
    }
    last = index + token.length;
  }

  if (last < text.length) parts.push({ type: "text", text: text.slice(last) });
  return parts;
}

export function parse(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code. An unterminated fence runs to the end rather than
    // swallowing the rest of the reply into nothing.
    if (line.trimStart().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        body.push(lines[i]);
        i++;
      }
      i++;
      blocks.push({ kind: "code", lang, body: body.join("\n") });
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, body: heading[2] });
      i++;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push({ kind: "quote", body: body.join(" ") });
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      const items: string[] = [];
      while (i < lines.length) {
        const next = ordered
          ? /^\s*\d+[.)]\s+(.*)$/.exec(lines[i])
          : /^\s*[-*+]\s+(.*)$/.exec(lines[i]);
        if (!next) break;
        items.push(next[1]);
        i++;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    // Consecutive non-blank lines form one paragraph, as in Markdown proper.
    const body: string[] = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
      body.push(lines[i]);
      i++;
    }
    blocks.push({ kind: "para", body: body.join("\n") });
  }

  return blocks;
}

function isBlockStart(line: string): boolean {
  return (
    line.trimStart().startsWith("```") ||
    /^(#{1,4})\s+/.test(line) ||
    /^\s*>\s?/.test(line) ||
    /^\s*[-*+]\s+/.test(line) ||
    /^\s*\d+[.)]\s+/.test(line)
  );
}
