/**
 * The Conduit mark.
 *
 * Two nested brackets, open to the right: a channel narrowing as something
 * passes through it. It reads as a "C", and it reads as throughput.
 *
 * Three rules it has to satisfy, all of which the previous mark failed:
 *   - **Legible at 16px.** Tray icons are tiny. Two strokes, no gradient, no
 *     detail that disappears when the renderer hints it to a 16px grid.
 *   - **Monochrome first.** A brand that only works in colour cannot survive a
 *     menu bar, a favicon, a print sheet, or a user's dark theme. Colour here
 *     is state, never identity.
 *   - **Not a waveform.** Evenly spaced bars mean audio to everyone who has
 *     ever seen a music player, no matter what the product does.
 */
export function Logo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M58 18H34a16 16 0 0 0-16 16v32a16 16 0 0 0 16 16h24"
        stroke="currentColor"
        strokeWidth="12"
        strokeLinecap="round"
      />
      <path
        d="M64 40H48a8 8 0 0 0-8 8v4a8 8 0 0 0 8 8h16"
        stroke="currentColor"
        strokeWidth="10"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The mark on its plate — used wherever the app signs its own name. */
export function LogoPlate({ size = 26 }: { size?: number }) {
  return (
    <span className="plate" style={{ width: size, height: size }}>
      <Logo size={size * 0.64} />
    </span>
  );
}
