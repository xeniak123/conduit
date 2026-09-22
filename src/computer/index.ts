import { invoke } from "@tauri-apps/api/core";
import type { ImageContent } from "@/llm/types";
import { register, schema, str, unregisterSource, type Tool } from "@/tools/registry";

export interface Capture {
  png_base64: string;
  width: number;
  height: number;
  screen_width: number;
  screen_height: number;
}

/**
 * The last frame the model was shown.
 *
 * Coordinates coming back from the model are in *that* image's pixel space,
 * which is smaller than the real display. Everything must be scaled through
 * this record — mapping against the live screen size instead is how a screen
 * agent ends up clicking hundreds of pixels off target.
 */
let lastCapture: Capture | null = null;

/** Test seam: sets the frame the model is reasoning about. */
export function __setFrame(capture: Capture | null): void {
  lastCapture = capture;
}

export async function captureScreen(): Promise<Capture> {
  lastCapture = await invoke<Capture>("capture_screen");
  return lastCapture;
}

export function lastFrame(): ImageContent | null {
  if (!lastCapture) return null;
  return { base64: lastCapture.png_base64, mediaType: "image/png" };
}

export function frameDescription(): string {
  if (!lastCapture) return "";
  return `Screen image is ${lastCapture.width}×${lastCapture.height}. Give coordinates in that space.`;
}

export function toScreen(x: number, y: number): { x: number; y: number } {
  if (!lastCapture) return { x: Math.round(x), y: Math.round(y) };
  const scaleX = lastCapture.screen_width / lastCapture.width;
  const scaleY = lastCapture.screen_height / lastCapture.height;
  return { x: Math.round(x * scaleX), y: Math.round(y * scaleY) };
}

/** Parks the overlay marker wherever the agent is about to act. */
let idle: ReturnType<typeof setTimeout> | null = null;

async function markCursor(x: number, y: number): Promise<void> {
  // The marker is an honesty signal, not a prerequisite: if it cannot be
  // drawn the action should still happen, with the banner still showing.
  await invoke("agent_cursor", { x, y }).catch(() => undefined);
  // It must never outlive the run. If the run ends without cleanup (a reload,
  // a crash, a closed window), the marker goes away on its own.
  if (idle) clearTimeout(idle);
  idle = setTimeout(() => void hideCursor(), 20_000);
}

export async function hideCursor(): Promise<void> {
  // Called from cleanup paths, including after a failure. A rejection here
  // would escape the handler that is already dealing with something else.
  await invoke("agent_cursor", { x: null, y: null }).catch(() => undefined);
}

const num = (description: string) => ({ type: "number", description });

const captureTool: Tool = {
  name: "screen.capture",
  source: "computer-use",
  visual: true,
  description:
    "Take a screenshot and look at it. Call this first whenever you need to see " +
    "what is on screen before acting.",
  parameters: schema({}),
  async run() {
    const shot = await captureScreen();
    return `Screenshot taken. ${shot.width}×${shot.height} (display is ${shot.screen_width}×${shot.screen_height}).`;
  },
};

const clickTool: Tool = {
  name: "screen.click",
  source: "computer-use",
  visual: true,
  dangerous: true,
  description:
    "Click at a point on screen. Coordinates are in the screenshot's pixel space, " +
    "measured from its top-left corner. Aim at the centre of the target.",
  parameters: schema(
    {
      x: num("Horizontal position in the screenshot"),
      y: num("Vertical position in the screenshot"),
      button: {
        type: "string",
        enum: ["left", "right", "middle", "double"],
        description: "Which click. Defaults to left.",
      },
    },
    ["x", "y"],
  ),
  async run(input) {
    const point = toScreen(Number(input.x), Number(input.y));
    await markCursor(point.x, point.y);
    await invoke("pointer_move", point);
    await invoke("pointer_click", { kind: (input.button as string) ?? "left" });
    // Give the clicked application a moment to react before the next
    // screenshot, or the model sees the UI as it was before the click.
    await sleep(350);
    return `Clicked ${input.button ?? "left"} at (${input.x}, ${input.y}).`;
  },
};

const moveTool: Tool = {
  name: "screen.move",
  source: "computer-use",
  visual: true,
  description: "Move the pointer without clicking — use to reveal hover menus and tooltips.",
  parameters: schema({ x: num("Horizontal position"), y: num("Vertical position") }, ["x", "y"]),
  async run(input) {
    const point = toScreen(Number(input.x), Number(input.y));
    await markCursor(point.x, point.y);
    await invoke("pointer_move", point);
    await sleep(400);
    return `Moved to (${input.x}, ${input.y}).`;
  },
};

const dragTool: Tool = {
  name: "screen.drag",
  source: "computer-use",
  visual: true,
  dangerous: true,
  description: "Press at one point, move to another, release. Use for sliders, selections and reordering.",
  parameters: schema(
    {
      x: num("Start horizontal"),
      y: num("Start vertical"),
      to_x: num("End horizontal"),
      to_y: num("End vertical"),
    },
    ["x", "y", "to_x", "to_y"],
  ),
  async run(input) {
    const from = toScreen(Number(input.x), Number(input.y));
    const to = toScreen(Number(input.to_x), Number(input.to_y));
    await markCursor(from.x, from.y);
    await invoke("pointer_move", from);
    await markCursor(to.x, to.y);
    await invoke("pointer_drag", to);
    await sleep(350);
    return `Dragged to (${input.to_x}, ${input.to_y}).`;
  },
};

const scrollTool: Tool = {
  name: "screen.scroll",
  source: "computer-use",
  visual: true,
  description: "Scroll the area under a point. Positive amount scrolls down or right.",
  parameters: schema(
    {
      x: num("Horizontal position to scroll over"),
      y: num("Vertical position to scroll over"),
      amount: num("Notches to scroll, typically 3 to 10"),
      horizontal: { type: "boolean", description: "Scroll sideways instead of down" },
    },
    ["x", "y", "amount"],
  ),
  async run(input) {
    const point = toScreen(Number(input.x), Number(input.y));
    await markCursor(point.x, point.y);
    await invoke("pointer_move", point);
    await invoke("pointer_scroll", {
      amount: Math.round(Number(input.amount)),
      horizontal: Boolean(input.horizontal),
    });
    await sleep(320);
    return `Scrolled ${input.amount}.`;
  },
};

const typeTool: Tool = {
  name: "screen.type",
  source: "computer-use",
  visual: true,
  dangerous: true,
  description:
    "Type text into whatever has focus. Click the field first — typing does not " +
    "move focus on its own.",
  parameters: schema({ text: str("The text to type") }, ["text"]),
  async run(input) {
    await invoke("type_text", { text: String(input.text ?? "") });
    await sleep(250);
    return `Typed ${String(input.text ?? "").length} characters.`;
  },
};

const keyTool: Tool = {
  name: "screen.key",
  source: "computer-use",
  visual: true,
  dangerous: true,
  description:
    "Press a key or shortcut, e.g. ['enter'], ['ctrl','t'] for a new browser tab, " +
    "['alt','tab'] to switch application, ['win'] to open the start menu.",
  parameters: schema(
    {
      keys: {
        type: "array",
        items: { type: "string" },
        description: "Keys pressed together, modifiers first",
      },
    },
    ["keys"],
  ),
  async run(input) {
    const keys = (input.keys as string[]) ?? [];
    if (!keys.length) return "No keys given.";
    await invoke("press_keys", { keys });
    await sleep(400);
    return `Pressed ${keys.join("+")}.`;
  },
};

const waitTool: Tool = {
  name: "screen.wait",
  source: "computer-use",
  visual: true,
  description: "Wait for something to finish loading, then look again.",
  parameters: schema({ seconds: num("How long to wait, 1 to 10") }, ["seconds"]),
  async run(input) {
    const seconds = Math.min(Math.max(Number(input.seconds) || 1, 0.5), 10);
    await sleep(seconds * 1000);
    return `Waited ${seconds}s.`;
  },
};

const ALL = [captureTool, clickTool, moveTool, dragTool, scrollTool, typeTool, keyTool, waitTool];

/**
 * Screen control is off unless the user turns it on, and turning it off must
 * actually remove the tools — leaving them registered but refusing at call
 * time would waste tokens and confuse the model every single turn.
 */
export function setComputerUseEnabled(enabled: boolean): void {
  unregisterSource("computer-use");
  if (enabled) register(...ALL);
}

export const COMPUTER_TOOL_NAMES = ALL.map((t) => t.name);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
