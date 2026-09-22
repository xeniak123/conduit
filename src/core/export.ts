import type { Conversation } from "./store";
import { formatCost } from "./usage";

/**
 * Getting a conversation out of the app.
 *
 * Markdown, because the destination is almost always something that already
 * reads it — a pull request, an issue, a wiki, a colleague's editor. A JSON
 * dump would be more faithful and less useful.
 *
 * Tool activity is included but folded into a details block: the reader
 * usually wants the answer, and occasionally needs to see exactly what ran.
 */
export function toMarkdown(conversation: Conversation): string {
  const lines: string[] = [
    `# ${conversation.title}`,
    "",
    `_${new Date(conversation.at).toLocaleString()} · Conduit_`,
    "",
  ];

  for (const message of conversation.messages) {
    if (message.role === "user") {
      lines.push(`### ${message.spoken ? "Said" : "Asked"}`, "", message.text, "");
      continue;
    }

    lines.push("### Conduit", "", message.text || "_no reply_", "");

    const tools = message.steps.filter((s) => s.kind === "tool" || s.kind === "result");
    if (tools.length) {
      lines.push(
        "<details>",
        `<summary>${message.steps.filter((s) => s.kind === "tool").length} tool calls</summary>`,
        "",
        "```",
        ...tools.map((s) => `${s.kind === "tool" ? "→" : "  "} ${s.text}`),
        "```",
        "",
        "</details>",
        "",
      );
    }

    if (message.cost) {
      lines.push(`_${formatCost(message.cost)} · ${message.tokens?.toLocaleString()} tokens_`, "");
    }
  }

  return lines.join("\n");
}

export function download(filename: string, contents: string, type = "text/markdown"): void {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function exportConversation(conversation: Conversation): void {
  const slug =
    conversation.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "conversation";

  download(`conduit-${slug}.md`, toMarkdown(conversation));
}
