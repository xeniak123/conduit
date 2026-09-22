/**
 * The agent's pointer marker.
 *
 * No desktop OS has a second physical cursor, so this is an overlay window
 * that follows wherever the agent is acting. It is click-through, and it
 * exists for one reason: at any instant it must be obvious whether the machine
 * or the person is driving. A pulsing ring reads as "live" from the corner of
 * the eye, without covering the target underneath.
 */
export function Cursor() {
  return (
    <div className="agentcursor">
      <span className="agentcursor__ring" />
      <span className="agentcursor__core" />
    </div>
  );
}
