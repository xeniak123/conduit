import { useEffect, useRef } from "react";
import { useApp } from "@/core/store";

/**
 * A scrolling level meter, drawn from the microphone's actual RMS.
 *
 * It is not decoration: a flat line while you are speaking means the wrong
 * input device is selected, and that is the single most common way voice
 * tools fail silently. Showing the signal makes the failure obvious.
 */
export function Meter({ width = 120, height = 18, active }: {
  width?: number;
  height?: number;
  active: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const historyRef = useRef<number[]>([]);
  const level = useApp((s) => s.level);
  const levelRef = useRef(level);
  levelRef.current = level;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const bars = Math.floor(width / 3);
    const styles = getComputedStyle(document.documentElement);
    const signal = styles.getPropertyValue("--signal").trim() || "#e2a03f";
    const idle = styles.getPropertyValue("--line-bright").trim() || "#3a352e";

    let raf = 0;
    let idleFrames = 0;

    const draw = () => {
      const history = historyRef.current;
      const level = active ? levelRef.current : 0;
      history.push(level);
      if (history.length > bars) history.splice(0, history.length - bars);

      ctx.clearRect(0, 0, width, height);
      const mid = height / 2;

      for (let i = 0; i < history.length; i++) {
        // Never fully zero: a 1px baseline reads as "connected, quiet",
        // which is different from "nothing here".
        const amplitude = Math.max(history[i] * (height / 2 - 1), 0.5);
        ctx.fillStyle = active ? signal : idle;
        ctx.globalAlpha = active ? 0.45 + (i / history.length) * 0.55 : 0.5;
        ctx.fillRect(width - (history.length - i) * 3, mid - amplitude, 2, amplitude * 2);
      }
      ctx.globalAlpha = 1;

      // Once the signal has been flat long enough for the trace to have
      // scrolled clear, stop drawing. A hidden window or a silent room should
      // not keep a render loop alive for days.
      idleFrames = level > 0.01 ? 0 : idleFrames + 1;
      const settled = idleFrames > bars + 12;

      if (document.hidden || settled) {
        raf = window.setTimeout(draw, 250) as unknown as number;
        return;
      }
      raf = requestAnimationFrame(draw);
    };

    draw();
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(raf);
    };
  }, [width, height, active]);

  return (
    <canvas
      ref={canvasRef}
      className="meter"
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}
