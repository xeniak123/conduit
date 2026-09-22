import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { loadCompanions } from "@/companion";
import { COMPANION_STATE, type CompanionState } from "@/core/companion";
import { DEFAULT_SETTINGS, type CompanionSettings } from "@/core/config";
import { isTauri } from "@/core/host";
import { CompanionBody, GooFilter } from "./CompanionBody";

/**
 * The companion window.
 *
 * It is the whole of Conduit while the main window is away, so it has one job
 * and has to do it without taking the screen: say what is happening, and be
 * pleasant to have around.
 *
 * On the glass. Most attempts at this are a white fill at ten percent with a
 * blur and a one-pixel border, which reads as a sticker rather than a
 * material. A real slab of glass does four things, and all four are in
 * `companion.css`: refraction concentrating light along the rim, dispersion
 * splitting that rim warm on one side and cool on the other, a specular
 * highlight that lags the body as it travels, and surface tension, so two
 * cells near each other join with a neck rather than overlapping.
 *
 * What it cannot do is refract the desktop: `backdrop-filter` does not reach
 * across an OS window boundary, so a transparent overlay gets no blur of what
 * is behind it at all. The body therefore carries its own darkness — which is
 * also what keeps a caption readable over an arbitrary desktop, so it is a
 * constraint and a feature at once.
 */

const FALLBACK: CompanionSettings = DEFAULT_SETTINGS.companion;

/**
 * Room around the content for the merged shadow, filter bleed and entrance.
 * The old 30px was exactly the offset plus blur radius, leaving no allowance
 * for the filter's own rasterisation on a light desktop — hence the hard line
 * visible below the shadow. This is a window boundary, not merely CSS space.
 */
const PADDING = 56;

export function Companion() {
  const [state, setState] = useState<CompanionState>({
    activity: "idle",
    caption: "",
    detail: "",
    emitCursor: 0,
    settings: FALLBACK,
  });
  const [level, setLevel] = useState(0);
  const [side, setSide] = useState<"left" | "right">("right");
  const [appearance, setAppearance] = useState(0);
  const [, setSpecsLoaded] = useState(0);
  const body = useRef<HTMLDivElement>(null);

  const reduced =
    typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Velocity of the window, from the native follow loop. The renderer never
  // sees the pointer, so this is the only way it can know it is moving.
  const [velocity, setVelocity] = useState({ vx: 0, vy: 0, speed: 0 });
  const settle = useRef<number | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    void loadCompanions().then(() => setSpecsLoaded((n) => n + 1));

    const subscriptions = Promise.all([
      listen<CompanionState>(COMPANION_STATE, (e) => setState(e.payload)),
      listen<number>("conduit://level", (e) => setLevel(e.payload)),
      listen<{ left: boolean }>("conduit://companion-side", (e) =>
        setSide(e.payload.left ? "left" : "right"),
      ),
      listen("conduit://companion-appear", () => setAppearance((n) => n + 1)),
      listen<{ vx: number; vy: number; speed: number }>("conduit://companion-motion", (e) => {
        setVelocity(e.payload);
        if (settle.current) window.clearTimeout(settle.current);
        // Motion events stop arriving when the pointer stops, so the companion
        // has to notice the silence and relax on its own.
        settle.current = window.setTimeout(() => setVelocity({ vx: 0, vy: 0, speed: 0 }), 110);
      }),
    ]);

    // Ask for the current state rather than waiting for the next change: a
    // reload of this web view would otherwise sit on defaults indefinitely.
    void emit("conduit://companion-hello", {});

    return () => {
      if (settle.current) window.clearTimeout(settle.current);
      void subscriptions.then((offs) => offs.forEach((off) => off()));
    };
  }, []);

  const settings = state.settings ?? FALLBACK;
  const caption = (state.detail || state.caption).trim();

  // The window is sized to the content rather than the other way round. A
  // fixed box would mean a transparent rectangle over other applications,
  // several times larger than anything drawn in it.
  useLayoutEffect(() => {
    if (!isTauri() || !body.current) return;
    const target = body.current;
    const measure = () => {
      const rect = target.getBoundingClientRect();
      if (!rect.width) return;
      void invoke("resize_companion", {
        width: Math.ceil(rect.width) + PADDING * 2,
        height: Math.ceil(rect.height) + PADDING * 2,
      }).catch(() => undefined);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="companion" data-side={side} data-activity={state.activity}>
      <GooFilter />
      <div ref={body} className="companion__fit" style={{ visibility: appearance ? "visible" : "hidden" }}>
        {/* Hidden until the first "appear" cue. The web view loads long
            before the window is shown, so without this the entrance would
            already have played, and showing the window would flash the
            finished bead and then replay it. */}
        <CompanionBody
          settings={settings}
          activity={state.activity}
          level={level}
          caption={caption || undefined}
          velocity={velocity}
          reduced={reduced}
          appearKey={appearance}
          emitCursor={state.emitCursor}
        />
      </div>
    </div>
  );
}
