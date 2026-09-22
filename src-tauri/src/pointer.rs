//! Mouse control for the agent's cursor.
//!
//! The agent moves the *real* system pointer — there is no second physical
//! cursor in any desktop OS. What makes it look like a second cursor is the
//! overlay window drawn on top, which is what tells the user at a glance that
//! the machine is driving and not them.

use enigo::{Axis, Button, Coordinate, Direction, Enigo, Mouse, Settings};
use serde::Deserialize;

#[derive(Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "lowercase")]
pub enum ClickKind {
    Left,
    Right,
    Middle,
    Double,
}

fn enigo() -> Result<Enigo, String> {
    Enigo::new(&Settings::default()).map_err(|e| format!("pointer unavailable: {e}"))
}

pub fn position() -> Result<(i32, i32), String> {
    enigo()?.location().map_err(|e| format!("cursor position unavailable: {e}"))
}

/// Moves in steps rather than teleporting.
///
/// Partly so the user can follow what is happening, and partly because some
/// applications only show hover states after real movement events — a single
/// jump to the target can leave a menu unopened and the next click missing.
pub fn glide_to(x: i32, y: i32) -> Result<(), String> {
    let mut e = enigo()?;
    let (from_x, from_y) = e.location().unwrap_or((x, y));

    let distance = (((x - from_x).pow(2) + (y - from_y).pow(2)) as f32).sqrt();
    let steps = ((distance / 40.0).ceil() as i32).clamp(1, 24);

    for step in 1..=steps {
        let t = step as f32 / steps as f32;
        // Ease-out: fast away from the origin, settling onto the target.
        let eased = 1.0 - (1.0 - t).powi(3);
        let ix = from_x + ((x - from_x) as f32 * eased) as i32;
        let iy = from_y + ((y - from_y) as f32 * eased) as i32;
        e.move_mouse(ix, iy, Coordinate::Abs)
            .map_err(|err| format!("could not move pointer: {err}"))?;
        std::thread::sleep(std::time::Duration::from_millis(8));
    }

    e.move_mouse(x, y, Coordinate::Abs)
        .map_err(|err| format!("could not move pointer: {err}"))
}

pub fn click(kind: ClickKind) -> Result<(), String> {
    let mut e = enigo()?;
    let button = match kind {
        ClickKind::Right => Button::Right,
        ClickKind::Middle => Button::Middle,
        _ => Button::Left,
    };

    e.button(button, Direction::Click).map_err(err)?;
    if matches!(kind, ClickKind::Double) {
        std::thread::sleep(std::time::Duration::from_millis(40));
        e.button(button, Direction::Click).map_err(err)?;
    }
    Ok(())
}

pub fn scroll(amount: i32, horizontal: bool) -> Result<(), String> {
    let mut e = enigo()?;
    let axis = if horizontal { Axis::Horizontal } else { Axis::Vertical };
    e.scroll(amount, axis).map_err(err)
}

pub fn drag(to_x: i32, to_y: i32) -> Result<(), String> {
    let mut e = enigo()?;
    e.button(Button::Left, Direction::Press).map_err(err)?;
    drop(e);

    glide_to(to_x, to_y)?;

    let mut e = enigo()?;
    e.button(Button::Left, Direction::Release).map_err(err)
}

fn err(e: impl std::fmt::Display) -> String {
    format!("pointer action failed: {e}")
}
