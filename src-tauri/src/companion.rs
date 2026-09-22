//! The companion that follows the cursor: the droplet, the pet, or both.
//!
//! The follow loop lives here rather than in the web layer for one reason:
//! smoothness. Driving it from JavaScript would mean an IPC round trip per
//! frame, and the companion would stutter exactly when the agent is busy —
//! which is precisely when it is on screen. Here it is a thread doing
//! arithmetic and one window move per frame, unaffected by whatever the
//! interface is doing.
//!
//! The motion is a critically damped spring rather than a fixed easing. A
//! spring starts from wherever the companion actually is, so a change of
//! direction is absorbed instead of restarting an animation — which is what
//! makes it read as something with weight being pulled along, rather than a
//! picture being repositioned.

use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition};

/// Where the companion rests relative to the pointer, in physical pixels.
/// Below and right, where a cursor's own shadow would fall, so it never sits
/// on top of what is being pointed at.
const OFFSET_X: f64 = 30.0;
const OFFSET_Y: f64 = 26.0;

/// Spring constants. Stiffness sets how eagerly it chases; damping at 2·√k is
/// critical — it arrives without overshooting, which is right for something
/// that trails a pointer rather than being thrown.
const STIFFNESS: f64 = 190.0;
const DAMPING: f64 = 2.0 * 13.784; // 2·√190

/// How far from the lens centre the window's left edge sits, as a fraction of
/// its width. The lens is near one end so a caption can grow away from it.
const ANCHOR_FRACTION: f64 = 0.19;

/// Keep this much clear of the screen edge. A companion half off the display
/// looks broken rather than deliberate.
const EDGE_MARGIN: f64 = 8.0;

#[derive(Clone)]
pub struct Companion {
    running: Arc<AtomicBool>,
    /// Which end the caption grows towards, shared so the render side can be
    /// told only when it changes rather than ninety times a second.
    side_left: Arc<AtomicBool>,
    /// Set from the web layer when the pet needs a bigger box than the bead.
    width: Arc<AtomicI64>,
    height: Arc<AtomicI64>,
}

impl Companion {
    pub fn new() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
            side_left: Arc::new(AtomicBool::new(false)),
            width: Arc::new(AtomicI64::new(380)),
            height: Arc::new(AtomicI64::new(200)),
        }
    }

    pub fn stop(&self) {
        self.running.store(false, Ordering::Relaxed);
    }

    pub fn resize(&self, width: f64, height: f64) {
        self.width.store(width.round() as i64, Ordering::Relaxed);
        self.height.store(height.round() as i64, Ordering::Relaxed);
    }

    /// Puts the window beside the pointer immediately.
    ///
    /// Called before the window is shown. Without it the window appears
    /// wherever it last was (or at the screen origin on first use) for the
    /// frame or two before the follow loop moves it.
    pub fn place(&self, window: &tauri::WebviewWindow) {
        let Ok((px, py)) = crate::pointer::position() else { return };
        let w = self.width.load(Ordering::Relaxed) as f64;
        let h = self.height.load(Ordering::Relaxed) as f64;
        let (left, right, top, bottom) = monitor_bounds(window);
        let x = px as f64 + OFFSET_X;
        let y = py as f64 + OFFSET_Y;
        let anchor_x = w * ANCHOR_FRACTION;
        let flip = x + (w - anchor_x) > right - EDGE_MARGIN;
        self.side_left.store(flip, Ordering::Relaxed);
        let origin_x = if flip { x - (w - anchor_x) } else { x - anchor_x };
        let origin_y = y - h / 2.0;
        let _ = window.set_position(PhysicalPosition::new(
            origin_x.clamp(left + EDGE_MARGIN, (right - w - EDGE_MARGIN).max(left)).round() as i32,
            origin_y.clamp(top + EDGE_MARGIN, (bottom - h - EDGE_MARGIN).max(top)).round() as i32,
        ));
    }

    pub fn start(&self, app: AppHandle) {
        if self.running.swap(true, Ordering::Relaxed) {
            return;
        }

        let running = self.running.clone();
        let side_left = self.side_left.clone();
        let width_px = self.width.clone();
        let height_px = self.height.clone();

        std::thread::spawn(move || {
            let Some(window) = app.get_webview_window("companion") else {
                running.store(false, Ordering::Relaxed);
                return;
            };

            // Start where the pointer already is, so it does not fly in from
            // the corner on the first frame.
            let (mut x, mut y) = match crate::pointer::position() {
                Ok((px, py)) => (px as f64 + OFFSET_X, py as f64 + OFFSET_Y),
                Err(_) => (0.0, 0.0),
            };
            let (mut vx, mut vy) = (0.0f64, 0.0f64);

            let frame = std::time::Duration::from_millis(1000 / 90);
            let dt = frame.as_secs_f64();

            // The monitor is re-read occasionally rather than every frame: the
            // call is not free, and a display does not move.
            let mut bounds = monitor_bounds(&window);
            let mut since_bounds = 0u32;
            let mut emitted = 0u32;

            while running.load(Ordering::Relaxed) {
                let Ok((px, py)) = crate::pointer::position() else {
                    std::thread::sleep(frame);
                    continue;
                };

                since_bounds += 1;
                if since_bounds > 45 {
                    since_bounds = 0;
                    bounds = monitor_bounds(&window);
                }

                let (tx, ty) = (px as f64 + OFFSET_X, py as f64 + OFFSET_Y);

                // One spring per axis. A single spring on the 2D distance
                // desynchronises the moment the two axes have different
                // velocities, which shows up as a curved, drifting path.
                vx += (STIFFNESS * (tx - x) - DAMPING * vx) * dt;
                vy += (STIFFNESS * (ty - y) - DAMPING * vy) * dt;
                x += vx * dt;
                y += vy * dt;

                let w = width_px.load(Ordering::Relaxed) as f64;
                let h = height_px.load(Ordering::Relaxed) as f64;
                let anchor_x = w * ANCHOR_FRACTION;

                // Which way the caption grows. Flipping near the right edge is
                // the difference between a readable companion and one whose
                // text is off the display — and the flip is hysteretic, so a
                // pointer resting on the threshold does not oscillate.
                let (left, right, top, bottom) = bounds;
                let wants_left = if side_left.load(Ordering::Relaxed) {
                    x + (w - anchor_x) * 0.55 < right - EDGE_MARGIN
                } else {
                    x + (w - anchor_x) > right - EDGE_MARGIN
                };
                if wants_left != side_left.load(Ordering::Relaxed) {
                    side_left.store(wants_left, Ordering::Relaxed);
                    let _ = app.emit("conduit://companion-side", Side { left: wants_left });
                }

                let origin_x = if wants_left { x - (w - anchor_x) } else { x - anchor_x };
                let origin_y = y - h / 2.0;

                let clamped_x = origin_x.clamp(left + EDGE_MARGIN, (right - w - EDGE_MARGIN).max(left));
                let clamped_y = origin_y.clamp(top + EDGE_MARGIN, (bottom - h - EDGE_MARGIN).max(top));

                let _ = window.set_position(PhysicalPosition::new(
                    clamped_x.round() as i32,
                    clamped_y.round() as i32,
                ));

                // Velocity drives squash-and-stretch in the renderer. It is the
                // one thing the web layer cannot work out for itself, because
                // it never sees the pointer. Thirty reports a second is enough
                // for a spring to track and a third of the IPC of every frame.
                emitted += 1;
                if emitted % 3 == 0 {
                    let speed = (vx * vx + vy * vy).sqrt();
                    let _ = app.emit("conduit://companion-motion", Motion { vx, vy, speed });
                }

                std::thread::sleep(frame);
            }
        });
    }
}

/// The monitor under the companion, as (left, right, top, bottom) in physical
/// pixels. Falls back to a very large box, which disables clamping rather than
/// pinning the companion to a guessed origin.
fn monitor_bounds(window: &tauri::WebviewWindow) -> (f64, f64, f64, f64) {
    match window.current_monitor() {
        Ok(Some(monitor)) => {
            let pos = monitor.position();
            let size = monitor.size();
            (
                pos.x as f64,
                pos.x as f64 + size.width as f64,
                pos.y as f64,
                pos.y as f64 + size.height as f64,
            )
        }
        _ => (-100_000.0, 100_000.0, -100_000.0, 100_000.0),
    }
}

#[derive(serde::Serialize, Clone)]
struct Motion {
    vx: f64,
    vy: f64,
    speed: f64,
}

#[derive(serde::Serialize, Clone)]
struct Side {
    left: bool,
}
