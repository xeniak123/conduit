/**
 * Line diffs, for showing what an agent changed.
 *
 * A longest-common-subsequence diff over lines, trimmed of the shared start
 * and end first so the table only covers the part that actually differs. That
 * keeps an edit to a two-thousand-line file down to a handful of lines of
 * work, which is the normal case. Files too different to diff cheaply are
 * shown as replaced whole rather than freezing the window.
 */

export type DiffLine = { kind: "same" | "add" | "del"; text: string; old?: number; new?: number };

export interface Hunk {
  lines: DiffLine[];
}

const MAX_CELLS = 4_000_000;

export function diffLines(before: string, after: string): DiffLine[] {
  // An empty file has no lines, not one empty line.
  const a = before === "" ? [] : before.split("\n");
  const b = after === "" ? [] : after.split("\n");

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const out: DiffLine[] = [];
  for (let i = 0; i < start; i++) out.push({ kind: "same", text: a[i], old: i + 1, new: i + 1 });

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  out.push(...middle(midA, midB, start));

  for (let i = 0; i < a.length - endA; i++) {
    out.push({ kind: "same", text: a[endA + i], old: endA + i + 1, new: endB + i + 1 });
  }
  return out;
}

function middle(a: string[], b: string[], offset: number): DiffLine[] {
  const n = a.length;
  const m = b.length;
  if (!n) return b.map((text, j) => ({ kind: "add", text, new: offset + j + 1 }));
  if (!m) return a.map((text, i) => ({ kind: "del", text, old: offset + i + 1 }));
  if (n * m > MAX_CELLS) {
    return [
      ...a.map((text, i): DiffLine => ({ kind: "del", text, old: offset + i + 1 })),
      ...b.map((text, j): DiffLine => ({ kind: "add", text, new: offset + j + 1 })),
    ];
  }

  // lcs[i][j]: length of the common subsequence of a[i..] and b[j..].
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i], old: offset + i + 1, new: offset + j + 1 });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: "del", text: a[i], old: offset + i + 1 });
      i++;
    } else {
      out.push({ kind: "add", text: b[j], new: offset + j + 1 });
      j++;
    }
  }
  while (i < n) out.push({ kind: "del", text: a[i], old: offset + i++ + 1 });
  while (j < m) out.push({ kind: "add", text: b[j], new: offset + j++ + 1 });
  return out;
}

/** Only the changed lines and a few around them, the way a review reads. */
export function hunks(lines: DiffLine[], context = 3): Hunk[] {
  const changed = lines.map((l) => l.kind !== "same");
  const keep = new Array(lines.length).fill(false);
  changed.forEach((c, i) => {
    if (!c) return;
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = true;
  });

  const out: Hunk[] = [];
  let current: DiffLine[] | null = null;
  lines.forEach((line, i) => {
    if (keep[i]) {
      current ??= [];
      current.push(line);
    } else if (current) {
      out.push({ lines: current });
      current = null;
    }
  });
  if (current) out.push({ lines: current });
  return out;
}

export function stats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.kind === "add") added++;
    else if (l.kind === "del") removed++;
  }
  return { added, removed };
}
