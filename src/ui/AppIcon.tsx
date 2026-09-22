import { BrandMark, brandForApp, hasLogo } from "./Brand";

/**
 * App icons for the store.
 *
 * A squircle with a two-stop gradient, a single white glyph, and a soft top
 * highlight — the shape language every app launcher has trained people to read
 * as "a thing you can install". Glyphs are drawn here rather than borrowed
 * logos, so nothing in the store implies an endorsement it does not have.
 */

const GLYPHS: Record<string, JSX.Element> = {
  folder: <path d="M5 9.5A2.5 2.5 0 0 1 7.5 7h3.3l1.8 2h4a2.5 2.5 0 0 1 2.5 2.5v4A2.5 2.5 0 0 1 16.5 18h-9A2.5 2.5 0 0 1 5 15.5z" />,
  branch: (
    <>
      <circle cx="8" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
      <circle cx="16" cy="9" r="2" />
      <path d="M8 9v6M16 11c0 3-3 3.5-8 4" />
    </>
  ),
  nodes: (
    <>
      <circle cx="7" cy="8" r="2" />
      <circle cx="17" cy="8" r="2" />
      <circle cx="12" cy="17" r="2" />
      <path d="M9 8h6M8 9.8l3 5.4M16 9.8l-3 5.4" />
    </>
  ),
  steps: <path d="M6 7h3M6 12h7M6 17h11M17 5v4M15 7h4" />,
  browser: (
    <>
      <rect x="4.5" y="5.5" width="15" height="13" rx="2.5" />
      <path d="M4.5 9.5h15M7.5 7.5h.01M10 7.5h.01" />
    </>
  ),
  book: <path d="M6 5.5h5a2 2 0 0 1 2 2V18a1.5 1.5 0 0 0-1.5-1.5H6zM18 5.5h-5a2 2 0 0 0-2 2V18a1.5 1.5 0 0 1 1.5-1.5H18z" />,
  review: (
    <>
      <circle cx="11" cy="11" r="5" />
      <path d="M15 15l4 4M9 11l1.5 1.5L13 10" />
    </>
  ),
  commit: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M4 12h5M15 12h5" />
    </>
  ),
  map: <path d="M5 7l4.5-2 5 2L19 5v12l-4.5 2-5-2L5 19zM9.5 5v12M14.5 7v12" />,
  bug: (
    <>
      <rect x="8" y="8" width="8" height="10" rx="4" />
      <path d="M12 8V6M9.5 6.5L10.5 8M14.5 6.5L13.5 8M8 12H5M19 12h-3M8 16l-2.5 1.5M16 16l2.5 1.5" />
    </>
  ),
  creature: (
    <>
      <path d="M7 16.5c0-4.5 2.2-8 5-8s5 3.5 5 8c0 1.2-1 1.5-2 1.5H9c-1 0-2-.3-2-1.5z" />
      <circle cx="10.3" cy="13" r=".9" fill="#fff" />
      <circle cx="13.7" cy="13" r=".9" fill="#fff" />
    </>
  ),
  plug: <path d="M9 4v4M15 4v4M7 8h10v2.5a5 5 0 0 1-10 0zM12 15.5V20" />,
  spark: <path d="M12 4l1.8 4.7L18.5 10.5 13.8 12.3 12 17l-1.8-4.7L5.5 10.5l4.7-1.8z" />,
  chat: <path d="M5 7.5A2.5 2.5 0 0 1 7.5 5h9A2.5 2.5 0 0 1 19 7.5v6a2.5 2.5 0 0 1-2.5 2.5H11l-4 3v-3h0A2.5 2.5 0 0 1 5 13.5z" />,
  database: (
    <>
      <ellipse cx="12" cy="7" rx="6" ry="2.5" />
      <path d="M6 7v10c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V7M6 12c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5" />
    </>
  ),
};

/** Two-stop gradients, chosen to stay legible with a white glyph on top. */
const TINTS: Record<string, [string, string]> = {
  ember: ["#ff9a3d", "#e8551c"],
  ocean: ["#4f8cff", "#2a4fd6"],
  mint: ["#3dd6a4", "#128a73"],
  grape: ["#a77bff", "#6a3fd6"],
  rose: ["#ff6f91", "#d63a62"],
  ink: ["#3a3a44", "#141418"],
  sun: ["#ffc93d", "#e8901c"],
  sky: ["#45c2ff", "#1e7fd6"],
  lime: ["#9be24a", "#4e9a1c"],
};

export function AppIcon({
  glyph,
  tint,
  size = 48,
  brand,
}: {
  glyph: string;
  tint: string;
  size?: number;
  /** A real product (GitHub, Notion…) shows its own mark on a white tile. */
  brand?: string | null;
}) {
  if (brand && hasLogo(brand)) {
    return (
      <span className="appicon appicon--brand" style={{ width: size, height: size, borderRadius: size * 0.27 }}>
        <BrandMark brand={brand} size={size} />
      </span>
    );
  }
  const [from, to] = TINTS[tint] ?? TINTS.ink;
  return (
    <span
      className="appicon"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(160deg, ${from}, ${to})`,
        borderRadius: size * 0.27,
      }}
      aria-hidden="true"
    >
      <svg
        width={size * 0.56}
        height={size * 0.56}
        viewBox="0 0 24 24"
        fill="none"
        stroke="#fff"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {GLYPHS[glyph] ?? GLYPHS.spark}
      </svg>
    </span>
  );
}

/** Sensible defaults for items that do not name their own icon. */
export function iconFor(item: { id: string; kind: string; name?: string; icon?: string; tint?: string }): {
  glyph: string;
  tint: string;
  brand: string | null;
} {
  const brand = item.kind === "companion" ? null : brandForApp(item.id, item.name ?? "");
  return { ...glyphFor(item), brand };
}

function glyphFor(item: { id: string; kind: string; icon?: string; tint?: string }): { glyph: string; tint: string } {
  if (item.icon && item.tint) return { glyph: item.icon, tint: item.tint };
  switch (item.kind) {
    case "mcp":
      return { glyph: item.icon ?? "plug", tint: item.tint ?? "ocean" };
    case "skill":
      return { glyph: item.icon ?? "spark", tint: item.tint ?? "mint" };
    case "companion":
      return { glyph: item.icon ?? "creature", tint: item.tint ?? "grape" };
    default:
      return { glyph: item.icon ?? "chat", tint: item.tint ?? "sun" };
  }
}
