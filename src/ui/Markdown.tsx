import { useMemo, useState } from "react";
import { parse, splitInline } from "./markdown-parse";
import { motion } from "motion/react";
import hljs from "highlight.js/lib/common";
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

export function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parse(text), [text]);

  return (
    <div className="md">
      {blocks.map((block, i) => {
        switch (block.kind) {
          case "code":
            return <CodeBlock key={i} lang={block.lang} body={block.body} />;
          case "heading": {
            const Tag = `h${Math.min(block.level + 2, 6)}` as "h3";
            return (
              <Tag key={i} className="md__h">
                <Inline text={block.body} />
              </Tag>
            );
          }
          case "list":
            return block.ordered ? (
              <ol key={i} className="md__list">
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Inline text={item} />
                  </li>
                ))}
              </ol>
            ) : (
              <ul key={i} className="md__list">
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Inline text={item} />
                  </li>
                ))}
              </ul>
            );
          case "quote":
            return (
              <blockquote key={i} className="md__quote">
                <Inline text={block.body} />
              </blockquote>
            );
          default:
            return (
              <p key={i} className="md__p">
                <Inline text={block.body} />
              </p>
            );
        }
      })}
    </div>
  );
}

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
  const highlighted = useMemo(() => highlight(lang, body), [lang, body]);

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
        <motion.button
          className="code__copy"
          onPointerDown={copy}
          whileTap={{ scale: 0.94 }}
          transition={SPRING_SNAP}
        >
          {copied ? "Copied" : "Copy"}
        </motion.button>
      </div>
      {preview ? (
        <iframe
          className="code__preview"
          title="Preview"
          sandbox="allow-scripts"
          srcDoc={previewDoc(lang.toLowerCase(), body)}
        />
      ) : (
        <pre className="code__body">
          {/* highlight.js escapes the source, so the markup it returns is safe to inject. */}
          <code className="hljs" dangerouslySetInnerHTML={{ __html: highlighted }} />
        </pre>
      )}
    </div>
  );
}

/** Bold, italics, inline code and links — nothing more, nothing nested deeply. */
function Inline({ text }: { text: string }) {
  const parts = useMemo(() => splitInline(text), [text]);
  return (
    <>
      {parts.map((part, i) => {
        if (part.type === "code") return <code key={i} className="md__code">{part.text}</code>;
        if (part.type === "bold") return <strong key={i}>{part.text}</strong>;
        if (part.type === "em") return <em key={i}>{part.text}</em>;
        if (part.type === "link")
          return (
            <a key={i} className="md__link" href={part.href} target="_blank" rel="noreferrer">
              {part.text}
            </a>
          );
        return <span key={i}>{part.text}</span>;
      })}
    </>
  );
}

