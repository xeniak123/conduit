/**
 * Keyboard and assistive-technology activation for press-driven controls.
 *
 * Conduit's buttons act on `pointerdown` rather than `click`, so they respond
 * the instant they are pressed instead of on release. The cost was invisible
 * with a mouse and total without one: Enter and Space on a focused button, and
 * a screen reader's "activate", produce a `click` and never a `pointerdown`,
 * so almost every control in the app did nothing from the keyboard.
 *
 * Rather than rewrite two hundred and fifty handlers, a click that did not come
 * from a pointer (the browser marks those with `detail === 0`) is turned into
 * the press the control is listening for. Controls that listen for `click`
 * themselves are left alone, so nothing fires twice.
 */

type ReactProps = { onPointerDown?: unknown; onClick?: unknown; disabled?: boolean };

/** React keeps an element's current props on the node under a generated key. */
function propsOf(element: Element): ReactProps | null {
  for (const key of Object.keys(element)) {
    if (key.startsWith("__reactProps$")) return (element as unknown as Record<string, ReactProps>)[key] ?? null;
  }
  return null;
}

/** The nearest ancestor that is only wired for presses, if there is one. */
export function pressTarget(from: EventTarget | null): HTMLElement | null {
  let node = from instanceof Element ? from : null;
  while (node && node !== document.body) {
    const props = propsOf(node);
    if (props?.onClick) return null;
    if (props?.onPointerDown) {
      if (props.disabled || (node as HTMLButtonElement).disabled) return null;
      return node as HTMLElement;
    }
    node = node.parentElement;
  }
  return null;
}

export function installKeyboardActivation(): () => void {
  // Once per window: a second listener (a hot reload re-running the module)
  // would turn every Enter into two presses.
  const flag = window as unknown as { __conduitKeyboardActivation?: boolean };
  if (flag.__conduitKeyboardActivation) return () => undefined;
  flag.__conduitKeyboardActivation = true;

  const onClick = (event: MouseEvent) => {
    // A real mouse or touch click has already sent its pointerdown.
    if (event.detail !== 0) return;
    const target = pressTarget(event.target);
    if (!target) return;
    target.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, cancelable: true, composed: true, button: 0, isPrimary: true }),
    );
  };
  document.addEventListener("click", onClick, true);
  return () => {
    document.removeEventListener("click", onClick, true);
    flag.__conduitKeyboardActivation = false;
  };
}
