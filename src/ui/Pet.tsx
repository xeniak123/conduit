import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow, PhysicalPosition, type Monitor } from "@tauri-apps/api/window";
import { AnimatePresence, motion } from "motion/react";
import { companionOr, loadCompanions, type Activity } from "@/companion";
import { Creature } from "@/companion/Creature";
import { COMPANION_STATE, type CompanionState } from "@/core/companion";
import { DEFAULT_SETTINGS } from "@/core/config";
import { isTauri } from "@/core/host";

/**
 * The desktop pet.
 *
 * It lives in its own small window, standing on top of the taskbar. When
 * nothing is happening it wanders, sits, and eventually falls asleep; when
 * Conduit works it stops and says what it is doing in a bubble. It can be
 * picked up and dropped anywhere, and it falls back to the floor.
 *
 * The window is only clickable where the pet actually is. Everywhere else it
 * passes clicks through to whatever is underneath, which is checked a dozen
 * times a second against the real pointer position — a transparent rectangle
 * that swallowed clicks would be the most annoying thing on the screen.
 */

type Motion = "sit" | "walk" | "held" | "fall" | "sleep";

const GRAVITY = 3200; // px/s², physical
const WALK_SPEED = 70; // px/s, physical, at scale 1
const SLEEP_AFTER = 120_000;

const HINTS = [
  "Hold Ctrl+Alt+Space and tell me what to do.",
  "Ctrl+Alt+K opens a quick question box.",
  "Double-click me to open Conduit.",
  "Drag me anywhere. I land on my feet.",
  "Right-click for options.",
];

export function Pet() {
  const [state, setState] = useState<CompanionState>({
    activity: "idle",
    caption: "",
    detail: "",
    emitCursor: 0,
    settings: DEFAULT_SETTINGS.companion,
  });
  const [motionState, setMotionState] = useState<Motion>("sit");
  const [facing, setFacing] = useState<1 | -1>(1);
  const [bubble, setBubble] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [, setLoaded] = useState(0);
  const creature = useRef<HTMLDivElement>(null);

  // Everything the animation loop reads lives in refs: the loop runs outside
  // React, and a stale closure over state would walk a pet that is being held.
  const live = useRef({
    x: 0,
    y: 0,
    vy: 0,
    target: null as number | null,
    motion: "sit" as Motion,
    lastInteraction: Date.now(),
    nextDecision: Date.now() + 4000,
    dragging: false,
    lastMove: 0,
    dragFromX: 0,
    dragFromY: 0,
    lastDown: 0,
    scale: 1,
    floor: 0,
    left: 0,
    right: 0,
    width: 240,
    height: 236,
    busy: false,
    wander: true,
  });

  const menuOpen = useRef(false);
  useEffect(() => {
    menuOpen.current = menu;
  }, [menu]);

  const setMotion = (m: Motion) => {
    live.current.motion = m;
    setMotionState(m);
  };

  useEffect(() => {
    if (!isTauri()) return;
    void loadCompanions().then(() => setLoaded((n) => n + 1));

    const win = getCurrentWindow();
    const offs = Promise.all([
      listen<CompanionState>(COMPANION_STATE, (e) => {
        setState(e.payload);
        live.current.busy = e.payload.activity !== "idle";
        live.current.wander = e.payload.settings.petWander;
        if (live.current.busy) {
          live.current.lastInteraction = Date.now();
          if (live.current.motion === "walk" || live.current.motion === "sleep") setMotion("sit");
        }
      }),
      listen("conduit://pet-shown", () => void measure()),
      win.onMoved(() => {
        if (live.current.dragging) live.current.lastMove = Date.now();
      }),
    ]);
    void emit("conduit://companion-hello", {});

    const measure = async () => {
      const [monitor, size, pos, scale] = await Promise.all([
        currentMonitor(),
        win.outerSize(),
        win.outerPosition(),
        win.scaleFactor(),
      ]);
      applyBounds(monitor, size.width, size.height);
      live.current.scale = scale;
      const saved = readSavedX();
      const x = saved ?? pos.x ?? live.current.right - size.width - 80;
      live.current.x = clamp(x, live.current.left, live.current.right - size.width);
      live.current.y = live.current.floor;
      void win.setPosition(new PhysicalPosition(Math.round(live.current.x), Math.round(live.current.y)));
    };

    const applyBounds = (monitor: Monitor | null, width: number, height: number) => {
      live.current.width = width;
      live.current.height = height;
      if (!monitor) return;
      const area = monitor.workArea;
      live.current.left = area.position.x;
      live.current.right = area.position.x + area.size.width;
      // Feet on the top edge of the taskbar: the window's bottom is the floor.
      live.current.floor = area.position.y + area.size.height - height;
    };

    void measure();

    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const s = live.current;

      if (s.dragging) {
        // The operating system moves the window while dragging. When it stops
        // reporting moves, the drag is over and the pet drops.
        if (Date.now() - s.lastMove > 220) {
          s.dragging = false;
          void win.outerPosition().then((p) => {
            const moved = Math.hypot(p.x - s.dragFromX, p.y - s.dragFromY);
            s.x = p.x;
            s.y = p.y;
            s.vy = 0;
            if (moved < 4) {
              // It was a click, not a drag.
              setMotion("sit");
              flash(HINTS[Math.floor(Math.random() * HINTS.length)], 3800);
              return;
            }
            setMotion(p.y < s.floor - 2 ? "fall" : "sit");
            if (p.y >= s.floor - 2) void win.setPosition(new PhysicalPosition(Math.round(p.x), Math.round(s.floor)));
            saveX(p.x);
          });
        }
      } else if (s.motion === "fall") {
        s.vy += GRAVITY * dt;
        s.y += s.vy * dt;
        if (s.y >= s.floor) {
          s.y = s.floor;
          s.vy = 0;
          setMotion("sit");
          flash("Oof.", 1200);
        }
        void win.setPosition(new PhysicalPosition(Math.round(s.x), Math.round(s.y)));
      } else if (s.motion === "walk" && s.target !== null) {
        const dir = Math.sign(s.target - s.x);
        s.x += dir * WALK_SPEED * s.scale * dt;
        if (Math.abs(s.target - s.x) < 2 || s.busy) {
          s.target = null;
          setMotion("sit");
          saveX(s.x);
        }
        void win.setPosition(new PhysicalPosition(Math.round(s.x), Math.round(s.y)));
      } else if (!s.busy && Date.now() > s.nextDecision) {
        s.nextDecision = Date.now() + 5000 + Math.random() * 9000;
        if (Date.now() - s.lastInteraction > SLEEP_AFTER) {
          if (s.motion !== "sleep") setMotion("sleep");
        } else if (s.wander && Math.random() < 0.55) {
          const span = s.right - s.left - s.width;
          const goal = clamp(s.x + (Math.random() - 0.5) * 520 * s.scale, s.left, s.left + span);
          if (Math.abs(goal - s.x) > 40) {
            s.target = goal;
            setFacing(goal > s.x ? 1 : -1);
            setMotion("walk");
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    // Click-through everywhere except the pet itself.
    let passing = true;
    void win.setIgnoreCursorEvents(true);
    const hit = window.setInterval(async () => {
      const el = creature.current;
      if (!el) return;
      const [pointer, pos] = await Promise.all([
        invoke<[number, number]>("pointer_position").catch(() => null),
        win.outerPosition().catch(() => null),
      ]);
      if (!pointer || !pos) return;
      const r = el.getBoundingClientRect();
      const k = live.current.scale;
      const inside =
        pointer[0] >= pos.x + r.left * k &&
        pointer[0] <= pos.x + r.right * k &&
        pointer[1] >= pos.y + r.top * k &&
        pointer[1] <= pos.y + r.bottom * k;
      const shouldPass = !inside && !live.current.dragging && !menuOpen.current;
      if (shouldPass !== passing) {
        passing = shouldPass;
        void win.setIgnoreCursorEvents(shouldPass);
      }
    }, 70);

    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(hit);
      void offs.then((list) => list.forEach((off) => off()));
    };
  }, []);


  // What the busy states say in the bubble.
  useEffect(() => {
    const text = (state.detail || state.caption).trim();
    if (state.activity === "idle") return;
    if (state.activity === "done" && text) {
      flash(text, 7000);
      return;
    }
    if (text) setBubble(text);
  }, [state.activity, state.detail, state.caption]);

  const bubbleTimer = useRef<number | null>(null);
  function flash(text: string, ms: number) {
    setBubble(text);
    if (bubbleTimer.current) window.clearTimeout(bubbleTimer.current);
    bubbleTimer.current = window.setTimeout(() => setBubble(null), ms);
  }

  useEffect(() => {
    if (state.activity === "idle" && !bubbleTimer.current) setBubble(null);
  }, [state.activity]);

  const pick = () => {
    const s = live.current;
    const now = Date.now();
    // Two presses close together open Conduit instead of picking the pet up.
    if (now - s.lastDown < 320) {
      s.lastDown = 0;
      s.dragging = false;
      setMotion("sit");
      void invoke("open_settings").catch(() => undefined);
      return;
    }
    s.lastDown = now;
    s.lastInteraction = now;
    s.dragging = true;
    s.lastMove = now;
    s.dragFromX = s.x;
    s.dragFromY = s.y;
    s.target = null;
    setMotion("held");
    setMenu(false);
    void getCurrentWindow().startDragging();
  };

  const spec = companionOr(state.settings.desktopPetId, "pet");
  const busy = state.activity !== "idle";
  const activity: Activity =
    motionState === "held" || motionState === "fall"
      ? "held"
      : busy
        ? state.activity
        : motionState === "walk"
          ? "walking"
          : motionState === "sleep"
            ? "sleeping"
            : "idle";

  const size = 118 * (state.settings.petSize ?? 1);

  return (
    <div className="pet" data-activity={activity}>
      <AnimatePresence>
        {bubble && !menu && (
          <motion.div
            key={bubble}
            className="pet__bubble"
            initial={{ opacity: 0, y: 8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.95 }}
            transition={{ type: "spring", bounce: 0.3, duration: 0.4 }}
          >
            {bubble}
          </motion.div>
        )}
        {menu && (
          <motion.div
            className="pet__menu"
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.97 }}
            transition={{ type: "spring", bounce: 0.2, duration: 0.3 }}
          >
            <button
              onPointerDown={() => {
                setMenu(false);
                void invoke("open_settings").catch(() => undefined);
              }}
            >
              Open Conduit
            </button>
            <button
              onPointerDown={() => {
                setMenu(false);
                live.current.lastInteraction = motionState === "sleep" ? Date.now() : 0;
                setMotion(motionState === "sleep" ? "sit" : "sleep");
              }}
            >
              {motionState === "sleep" ? "Wake up" : "Take a nap"}
            </button>
            <button
              onPointerDown={() => {
                setMenu(false);
                void invoke("toggle_quick").catch(() => undefined);
              }}
            >
              Ask something
            </button>
            <button
              onPointerDown={() => {
                setMenu(false);
                void invoke("set_pet", { visible: false }).catch(() => undefined);
              }}
            >
              Hide for now
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div
        ref={creature}
        className="pet__body"
        style={{ width: size, height: size, transform: `scaleX(${facing})` }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          pick();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu((v) => !v);
        }}
      >
        <Creature spec={spec} activity={activity} size={size} />
      </div>
    </div>
  );
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function readSavedX(): number | null {
  try {
    const raw = localStorage.getItem("conduit.pet.x");
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

function saveX(x: number): void {
  try {
    localStorage.setItem("conduit.pet.x", String(Math.round(x)));
  } catch {
    /* private storage unavailable: the pet just starts at the default spot */
  }
}
