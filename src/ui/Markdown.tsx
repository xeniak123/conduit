import { memo, useEffect, useMemo, useState } from "react";
import { motion } from "motion/react";
import hljs from "highlight.js/lib/common";
import type { Tokens } from "marked";
import { decodeEntities, lex, safeHref, type MathToken, type Token } from "./markdown-parse";
import { SPRING_SNAP } from "./motion";

/**
 * Colours a code block when the language is named.
 *
 * Never guesses: highlight.js's auto-detection runs every grammar it knows
 * over the text, and a Hugging Face model card with thirty unlabelled blocks
 * froze the whole window for seconds. A named language is cheap; anything
 * else stays plain text.
 */
const MAX_HIGHLIGHT = 12_000;

function highlight(lang: string, body: string): string {
  const plain = () => body.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  const language = lang.toLowerCase();
  if (!language || body.length > MAX_HIGHLIGHT || !hljs.getLanguage(language)) return plain();
  try {
    return hljs.highlight(body, { language, ignoreIllegals: true }).value;
  } catch {
    return plain();
  }
}

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const tokens = useMemo(() => lex(text), [text]);
  return (
    <div className="md">
      <Blocks tokens={tokens} />
    </div>
  );
});

function Blocks({ tokens }: { tokens: Token[] }) {
  return <>{tokens.map((token, i) => <Block key={i} token={token} />)}</>;
}

function Block({ token }: { token: Token }) {
  switch (token.type) {
    case "space":
      return null;
    case "heading": {
      const t = token as Tokens.Heading;
      const Tag = `h${Math.min(t.depth + 2, 6)}` as "h3";
      return (
        <Tag className="md__h">
          <Inline tokens={t.tokens} />
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p className="md__p">
          <Inline tokens={(token as Tokens.Paragraph).tokens} />
        </p>
      );
    case "text": {
      // Loose text at block level: the body of a tight list item.
      const t = token as Tokens.Text;
      return t.tokens ? <Inline tokens={t.tokens} /> : <>{decodeEntities(t.text)}</>;
    }
    case "code": {
      const t = token as Tokens.Code;
      return <CodeBlock lang={(t.lang ?? "").split(/\s/)[0]} body={t.text} />;
    }
    case "blockquote":
      return (
        <blockquote className="md__quote">
          <Blocks tokens={(token as Tokens.Blockquote).tokens} />
        </blockquote>
      );
    case "list":
      return <List token={token as Tokens.List} />;
    case "table":
      return <Table token={token as Tokens.Table} />;
    case "hr":
      return <hr className="md__hr" />;
    case "mathBlock":
      return <Formula tex={(token as unknown as MathToken).text} display />;
    case "html":
      // Raw HTML is shown as what it is, never interpreted.
      return <p className="md__p md__raw">{(token as Tokens.HTML).text}</p>;
    default:
      return "raw" in token && token.raw ? <p className="md__p">{token.raw}</p> : null;
  }
}

function List({ token }: { token: Tokens.List }) {
  const Tag = token.ordered ? "ol" : "ul";
  const start = token.ordered && typeof token.start === "number" && token.start !== 1 ? token.start : undefined;
  const tasks = token.items.some((item) => item.task);
  return (
    <Tag className={`md__list${tasks ? " md__list--tasks" : ""}${token.loose ? " md__list--loose" : ""}`} start={start}>
      {token.items.map((item, i) => (
        <li key={i} className={item.task ? "md__task" : undefined}>
          {item.task && (
            <span className="md__check" data-checked={Boolean(item.checked)} aria-label={item.checked ? "Done" : "Not done"} role="img" />
          )}
          <div className="md__li">
            <Blocks tokens={item.tokens.filter((t) => t.type !== "checkbox")} />
          </div>
        </li>
      ))}
    </Tag>
  );
}

/**
 * Tables scroll sideways inside their own frame rather than widening the
 * whole conversation, and can be copied as tab-separated text straight into a
 * spreadsheet.
 */
function Table({ token }: { token: Tokens.Table }) {
  const [copied, setCopied] = useState(false);
  const align = (a: string | null) => (a ? { textAlign: a as "left" | "right" | "center" } : undefined);

  const copy = async () => {
    const line = (cells: Tokens.TableCell[]) => cells.map((c) => decodeEntities(c.text)).join("\t");
    try {
      await navigator.clipboard.writeText([line(token.header), ...token.rows.map(line)].join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard refused */
    }
  };

  return (
    <div className="md__table">
      <button className="md__tablecopy" onPointerDown={() => void copy()}>
        {copied ? "Copied" : "Copy table"}
      </button>
      <div className="md__tablescroll">
        <table>
          <thead>
            <tr>
              {token.header.map((cell, i) => (
                <th key={i} style={align(cell.align)}>
                  <Inline tokens={cell.tokens} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {token.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, i) => (
                  <td key={i} style={align(cell.align)}>
                    <Inline tokens={cell.tokens} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Inline({ tokens }: { tokens?: Token[] }) {
  if (!tokens) return null;
  return (
    <>
      {tokens.map((token, i) => {
        switch (token.type) {
          case "text": {
            const t = token as Tokens.Text;
            return t.tokens ? <Inline key={i} tokens={t.tokens} /> : <span key={i}>{decodeEntities(t.text)}</span>;
          }
          case "escape":
            return <span key={i}>{(token as Tokens.Escape).text}</span>;
          case "strong":
            return (
              <strong key={i}>
                <Inline tokens={(token as Tokens.Strong).tokens} />
              </strong>
            );
          case "em":
            return (
              <em key={i}>
                <Inline tokens={(token as Tokens.Em).tokens} />
              </em>
            );
          case "del":
            return (
              <del key={i}>
                <Inline tokens={(token as Tokens.Del).tokens} />
              </del>
            );
          case "codespan":
            return (
              <code key={i} className="md__code">
                {decodeEntities((token as Tokens.Codespan).text)}
              </code>
            );
          case "br":
            return <br key={i} />;
          case "link": {
            const t = token as Tokens.Link;
            const href = safeHref(t.href);
            return href ? (
              <a key={i} className="md__link" href={href} target="_blank" rel="noreferrer" title={href}>
                <Inline tokens={t.tokens} />
              </a>
            ) : (
              <span key={i}>
                <Inline tokens={t.tokens} />
              </span>
            );
          }
          case "image": {
            // Remote images are not loaded (the window fetches nothing by
            // itself); the picture becomes a link to it instead.
            const t = token as Tokens.Image;
            const href = safeHref(t.href);
            const label = t.text || "image";
            return href ? (
              <a key={i} className="md__link" href={href} target="_blank" rel="noreferrer">
                {label}
              </a>
            ) : (
              <span key={i}>{label}</span>
            );
          }
          case "mathInline": {
            const t = token as unknown as MathToken;
            return <Formula key={i} tex={t.text} display={Boolean(t.display)} />;
          }
          case "html":
            return <span key={i}>{(token as Tokens.HTML).text}</span>;
          default:
            return "raw" in token ? <span key={i}>{token.raw}</span> : null;
        }
      })}
    </>
  );
}

// --- maths ---------------------------------------------------------------------

type Katex = typeof import("katex");
let katexReady: Promise<Katex> | null = null;

/**
 * KaTeX is loaded the first time a reply contains maths, not at startup: most
 * conversations never need it, and it is the heaviest thing on this page.
 */
function loadKatex(): Promise<Katex> {
  katexReady ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(([m]) => (m.default ?? m) as Katex);
  return katexReady;
}

function Formula({ tex, display = false }: { tex: string; display?: boolean }) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadKatex()
      .then((katex) => {
        // trust:false keeps \href, \url and friends from becoming links or
        // markup; throwOnError:false shows a bad formula in red, not a crash.
        const out = katex.renderToString(tex, { displayMode: display, throwOnError: false, trust: false, strict: "ignore" });
        if (live) setHtml(out);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [tex, display]);

  if (html === null) {
    return display ? <div className="md__math md__math--block md__math--raw">{tex}</div> : <code className="md__code">{tex}</code>;
  }
  // KaTeX builds its own markup from the formula and escapes the text in it.
  return display ? (
    <div className="md__math md__math--block" dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <span className="md__math" dangerouslySetInnerHTML={{ __html: html }} />
  );
}

// --- code ----------------------------------------------------------------------

/**
 * What a page may do inside a preview: draw, style itself and run its own
 * scripts, but reach nothing. No network, no parent window, no Conduit.
 */
const PREVIEW_CSP =
  "default-src 'none'; img-src data: blob: https:; media-src data: https:; style-src 'unsafe-inline' https:; font-src data: https:; script-src 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com";

function previewDoc(lang: string, body: string): string {
  const doc = lang === "svg" || /^\s*<svg/i.test(body) ? `<body style="margin:0;display:grid;place-items:center;min-height:100vh">${body}</body>` : body;
  return `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">${doc}`;
}

function CodeBlock({ lang, body }: { lang: string; body: string }) {
  const [copied, setCopied] = useState(false);
  const previewable = /^(html|svg|xml)$/i.test(lang) || (lang === "" && /^\s*<(!doctype|html|svg)/i.test(body));
  const [preview, setPreview] = useState(previewable && body.length > 200);
  const [wrap, setWrap] = useState(false);
  const highlighted = useMemo(() => highlight(lang, body), [lang, body]);
  const lines = useMemo(() => body.split("\n").length, [body]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard access can be refused; failing silently beats an alert.
    }
  };

  return (
    <div className="code">
      <div className="code__bar">
        <span className="code__lang">{lang || "text"}</span>
        {lines > 1 && <span className="code__lines">{lines} lines</span>}
        {previewable && (
          <span className="code__tabs">
            <button aria-pressed={preview} onPointerDown={() => setPreview(true)}>
              Preview
            </button>
            <button aria-pressed={!preview} onPointerDown={() => setPreview(false)}>
              Code
            </button>
          </span>
        )}
        {!preview && (
          <button className="code__copy" aria-pressed={wrap} onPointerDown={() => setWrap(!wrap)} title="Wrap long lines">
            Wrap
          </button>
        )}
        <motion.button className="code__copy" onPointerDown={copy} whileTap={{ scale: 0.94 }} transition={SPRING_SNAP}>
          {copied ? "Copied" : "Copy"}
        </motion.button>
      </div>
      {preview ? (
        <iframe className="code__preview" title="Preview" sandbox="allow-scripts" srcDoc={previewDoc(lang.toLowerCase(), body)} />
      ) : (
        <pre className={`code__body${wrap ? " code__body--wrap" : ""}`}>
          {/* highlight.js escapes the source, so the markup it returns is safe to inject. */}
          <code className="hljs" dangerouslySetInnerHTML={{ __html: highlighted }} />
        </pre>
      )}
    </div>
  );
}
