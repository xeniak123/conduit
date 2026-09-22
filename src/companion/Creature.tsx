import { useEffect, useMemo, useRef } from "react";
import { choreograph, type Choreographer } from "./runtime";
import { resolvePaint, type Activity, type CompanionSpec, type Shape } from "./spec";

/**
 * Draws a companion.
 *
 * Nothing here interprets markup — a shape is a discriminated union with
 * numeric fields, and this function is the only place that turns one into an
 * element. That is what makes a pet somebody downloaded no more dangerous than
 * one that shipped in the binary: there is no path from the file to the DOM
 * that carries anything but geometry.
 */
function draw(shape: Shape, palette: Record<string, string>, key: number) {
  const common = {
    fill: resolvePaint(shape.fill, palette) ?? "none",
    stroke: resolvePaint(shape.stroke, palette),
    strokeWidth: shape.width,
    strokeLinecap: shape.cap,
    strokeLinejoin: shape.join,
    strokeDasharray: shape.dash?.join(" "),
    opacity: shape.opacity,
    // No `vector-effect`: stroke widths are in viewBox units and must scale
    // with the drawing, or a companion authored to look right at 54px turns
    // into a blob at 28px — the stroke would stay the same number of screen
    // pixels while everything around it shrank.
  };

  switch (shape.kind) {
    case "path":
      return <path key={key} d={shape.d} {...common} />;
    case "circle":
      return <circle key={key} cx={shape.cx} cy={shape.cy} r={shape.r} {...common} />;
    case "ellipse":
      return <ellipse key={key} cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry} {...common} />;
    case "rect":
      return (
        <rect
          key={key}
          x={shape.x}
          y={shape.y}
          width={shape.w}
          height={shape.h}
          rx={shape.r}
          {...common}
        />
      );
    case "line":
      return <line key={key} x1={shape.x} y1={shape.y} x2={shape.x2} y2={shape.y2} {...common} />;
    case "polygon":
      return <polygon key={key} points={(shape.points ?? []).join(" ")} {...common} />;
    default:
      return null;
  }
}

export interface CreatureProps {
  spec: CompanionSpec;
  activity: Activity;
  /** Velocity of the window itself; the creature leans into it. */
  lean?: { x: number; y: number };
  size?: number;
  reduced?: boolean;
  className?: string;
}

export function Creature({ spec, activity, lean, size = 44, reduced, className }: CreatureProps) {
  const root = useRef<SVGGElement>(null);
  const player = useRef<Choreographer | null>(null);

  const palette = spec.palette ?? {};
  const parts = useMemo(
    () => [...spec.parts].sort((a, b) => (a.z ?? 0) - (b.z ?? 0)),
    [spec],
  );

  // The player is rebuilt for a new companion and for a change of motion
  // preference, and for nothing else — activity goes in through a method, so
  // switching mood never restarts the loop or drops a cross-fade.
  useEffect(() => {
    if (!root.current) return;
    player.current = choreograph(root.current, spec, activity, { reduced });
    return () => {
      player.current?.stop();
      player.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, reduced]);

  useEffect(() => {
    player.current?.setActivity(activity);
  }, [activity]);

  useEffect(() => {
    player.current?.setLean(lean?.x ?? 0, lean?.y ?? 0);
  }, [lean?.x, lean?.y]);

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={spec.viewBox ?? "0 0 100 100"}
      aria-hidden="true"
      focusable="false"
    >
      <g ref={root}>
        {parts.map((part) => (
          <g
            key={part.id}
            data-part={part.id}
            style={{ display: part.showIn && !part.showIn.includes(activity) ? "none" : undefined }}
          >
            {part.shapes.map((shape, i) => draw(shape, palette, i))}
          </g>
        ))}
      </g>
    </svg>
  );
}
