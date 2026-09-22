import { useEffect, type ReactNode } from "react";
import { AnimatePresence, motion, useSpring, useTransform, type MotionValue } from "motion/react";
import { ACTIVITY_LABEL, companionOr, type Activity } from "@/companion";
import { Creature } from "@/companion/Creature";
import type { CompanionSettings } from "@/core/config";

/**
 * The companion, as a thing you can put anywhere.
 *
 * Extracted from the window so Settings can show the real article rather than
 * a mock-up of it. A preview that is a separate implementation is a promise
 * the product does not keep: the moment the two drift, the picture in Settings
 * is advertising rather than configuration.
 */

export interface CompanionBodyProps {
  settings: CompanionSettings;
  activity: Activity;
  /** Microphone level, 0 to 1, for the listening meter. */
  level?: number;
  /** Overrides the caption; omit to use the activity's own label. */
  caption?: string;
  /** Pointer velocity, if this instance is following one. */
  velocity?: { vx: number; vy: number; speed: number };
  reduced?: boolean;
  /** Re-mounts to replay the entrance. */
  appearKey?: number;
  emitCursor?: number;
}

export function CompanionBody({
  settings,
  activity,
  level = 0,
  caption,
  velocity = { vx: 0, vy: 0, speed: 0 },
  reduced = false,
  appearKey = 0,
  emitCursor = 0,
}: CompanionBodyProps) {
  // The pet lives in its own window on the desktop now; the bead that follows
  // the cursor is only ever the bead.
  const showBead = settings.mode !== "off";
  const showPet = false;

  const dropSpec = companionOr(settings.dropletId, "droplet");
  const petSpec = companionOr(settings.petId, "pet");

  const text = settings.showCaption ? (caption ?? ACTIVITY_LABEL[activity]).trim() : "";
  const showCaption = text.length > 0 && activity !== "idle";

  // Deformation. Springs rather than raw values, so the shape recovers with
  // weight instead of snapping back the instant the pointer stops.
  const stretch = useSpring(0, { stiffness: 250, damping: 26 });
  const tilt = useSpring(0, { stiffness: 180, damping: 22 });
  const glareX = useSpring(0, { stiffness: 130, damping: 20 });
  const glareY = useSpring(0, { stiffness: 130, damping: 20 });

  useEffect(() => {
    const lively = settings.lean && !reduced;
    stretch.set(lively ? Math.min(velocity.speed / 3000, 0.14) : 0);
    tilt.set(
      lively && velocity.speed > 60
        ? clamp((velocity.vy / Math.max(90, velocity.speed)) * 12, 9)
        : 0,
    );
    glareX.set(lively ? clamp(-velocity.vx / 190, 9) : 0);
    glareY.set(lively ? clamp(-velocity.vy / 190, 7) : 0);
  }, [velocity, settings.lean, reduced, stretch, tilt, glareX, glareY]);

  // Squash on one axis is stretch on the other, so the volume stays roughly
  // constant — which is what reads as a body of liquid rather than a picture
  // being scaled.
  const scaleX = useTransform(stretch, (v) => 1 + v);
  const scaleY = useTransform(stretch, (v) => 1 - v * 0.62);

  const lean =
    settings.lean && !reduced
      ? { x: clamp(velocity.vx / 260, 4), y: clamp(velocity.vy / 260, 4) }
      : { x: 0, y: 0 };

  const size = 46 * settings.scale;
  const petSize = 54 * settings.scale;

  return (
    /*
     * Two elements, and they must stay two.
     *
     * The outer one carries the surface-tension filter from the stylesheet.
     * The inner one animates — and animating `filter` writes an inline value
     * that would replace the goo outright, which is exactly what happened when
     * these were one element: the cells stopped merging the moment the
     * entrance finished, because `blur(0px)` had overwritten `url(#goo)`.
     *
     * Splitting them also improves the entrance. The blur happens *inside* the
     * threshold, so the companion resolves out of an amorphous blob into
     * distinct shapes instead of simply sharpening — which is what liquid
     * actually does when it pulls itself together.
     */
    <div className="companion__row">
      <motion.div
        className="companion__form"
        key={appearKey}
        initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.34, filter: "blur(14px)" }}
        animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
        transition={reduced ? { duration: 0.18 } : { type: "spring", bounce: 0.26, duration: 0.62 }}
        style={{ scaleX, scaleY, rotate: tilt }}
      >
        {showBead && (
          <Cell size={size} glareX={glareX} glareY={glareY} kind="bead">
            {activity === "listening" ? (
              <VoiceBars level={level} scale={settings.scale} />
            ) : (
              <Creature
                spec={dropSpec}
                activity={activity}
                lean={lean}
                size={size * 0.64}
                reduced={reduced}
              />
            )}
            <CursorBirth at={emitCursor} reduced={reduced} />
          </Cell>
        )}

        {showPet && (
          <Cell size={petSize} glareX={glareX} glareY={glareY} kind="pet">
            <Creature
              spec={petSpec}
              activity={activity}
              lean={lean}
              size={petSize * 0.88}
              reduced={reduced}
            />
            {!showBead && <CursorBirth at={emitCursor} reduced={reduced} />}
          </Cell>
        )}

        <AnimatePresence initial={false}>
          {showCaption && (
            <motion.div
              className="cell cell--caption"
              // Grows out of the bead and collapses back into it, so the two
              // read as one body of liquid rather than a bubble and a label.
              initial={{ width: 0, opacity: 0, marginLeft: -14 }}
              animate={{ width: "auto", opacity: 1, marginLeft: -11 }}
              exit={{ width: 0, opacity: 0, marginLeft: -14 }}
              transition={{ type: "spring", bounce: 0.14, duration: 0.42 }}
              style={{ fontSize: 12.5 * Math.min(1.25, settings.scale) }}
            >
              <span className="cell__rim" />
              <span className="cell__text">{text}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

const clamp = (value: number, limit: number): number =>
  Math.max(-limit, Math.min(limit, Number.isFinite(value) ? value : 0));

/** One lozenge of glass. */
function Cell({
  children,
  size,
  glareX,
  glareY,
  kind,
}: {
  children: ReactNode;
  size: number;
  glareX: MotionValue<number>;
  glareY: MotionValue<number>;
  kind: "bead" | "pet";
}) {
  return (
    <motion.div
      className={`cell cell--${kind}`}
      layout
      transition={{ type: "spring", bounce: 0.1, duration: 0.4 }}
      style={{ width: size, height: size }}
    >
      <span className="cell__rim" />
      <motion.span className="cell__glare" style={{ x: glareX, y: glareY }} />
      <span className="cell__sheen" />
      <span className="cell__caustic" />
      <span className="cell__content">{children}</span>
    </motion.div>
  );
}

/** Five bars driven by the real microphone level. */
function VoiceBars({ level, scale }: { level: number; scale: number }) {
  return (
    <span className="voicebars" style={{ height: 22 * scale }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <motion.i
          key={i}
          animate={{
            // A canned animation here would be a lie about whether the
            // microphone is working, which is the one question this is asked.
            scaleY: 0.16 + level * (1 - Math.abs(i - 2) * 0.22) * 2.8,
          }}
          transition={{ type: "spring", stiffness: 430, damping: 24 }}
        />
      ))}
    </span>
  );
}

/**
 * The agent taking the pointer.
 *
 * A bead detaches and travels away, because that is what is actually
 * happening: the thing that was sitting beside your cursor is now driving it.
 * Making the connection visible is the difference between "a second cursor
 * appeared" and "Conduit is doing this".
 */
function CursorBirth({ at, reduced }: { at: number; reduced: boolean }) {
  if (!at || reduced) return null;
  return (
    <motion.span
      key={at}
      className="companion__spawn"
      initial={{ opacity: 0, scale: 0.15, x: 0, y: 0 }}
      animate={{
        opacity: [0, 1, 1, 0],
        scale: [0.15, 1.15, 0.72, 0.3],
        x: [0, -20, -46],
        y: [0, -14, -32],
      }}
      transition={{ duration: 0.78, times: [0, 0.24, 0.6, 1], ease: "easeOut" }}
    />
  );
}

/**
 * Surface tension, as a filter.
 *
 * Blur the alpha, then push it through a steep contrast curve: where two
 * shapes are close their blurs overlap enough to clear the threshold, and a
 * neck appears between them. Compositing the original back on top keeps text
 * and rims crisp — only the silhouette is fluid.
 *
 * One copy per document is enough, and the id is global, so this renders once
 * at the root of whichever surface is showing a companion.
 */
export function GooFilter() {
  return (
    <svg className="companion__defs" aria-hidden="true">
      <defs>
        <filter id="companion-goo" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="blur" />
          <feColorMatrix
            in="blur"
            type="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9"
            result="goo"
          />
          <feComposite in="SourceGraphic" in2="goo" operator="atop" />
        </filter>
      </defs>
    </svg>
  );
}
