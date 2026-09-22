//! Screen capture for vision-driven control.
//!
//! Two things matter here and both are about cost. A raw 2560×1440 frame is
//! enormous in tokens, so every capture is downscaled before it leaves this
//! module — and because the model then reasons in *scaled* pixels, we hand the
//! caller both sizes so clicks can be mapped back to real coordinates. Getting
//! that mapping wrong is the classic way a screen agent clicks 400px off.

use anyhow::{anyhow, Result};
use base64::Engine;
use image::{codecs::png::PngEncoder, ImageEncoder};
use serde::Serialize;

/// Wide enough for text to stay legible to the model, small enough to stay
/// affordable. Matches what Anthropic recommends for computer use.
const MAX_WIDTH: u32 = 1280;

#[derive(Serialize, Clone)]
pub struct Capture {
    /// PNG bytes, base64, ready to attach to a message as an image block.
    pub png_base64: String,
    /// What the model sees.
    pub width: u32,
    pub height: u32,
    /// What the desktop actually is; clicks are scaled into this space.
    pub screen_width: u32,
    pub screen_height: u32,
}

pub fn capture_primary() -> Result<Capture> {
    let monitors = xcap::Monitor::all().map_err(|e| anyhow!("no monitors: {e}"))?;

    let monitor = monitors
        .iter()
        .find(|m| m.is_primary().unwrap_or(false))
        .or_else(|| monitors.first())
        .ok_or_else(|| anyhow!("no monitor available to capture"))?;

    let frame = monitor
        .capture_image()
        .map_err(|e| anyhow!("screen capture failed: {e}"))?;

    let screen_width = frame.width();
    let screen_height = frame.height();

    let scaled = if screen_width > MAX_WIDTH {
        let height = (screen_height as f32 * (MAX_WIDTH as f32 / screen_width as f32)) as u32;
        image::imageops::resize(
            &frame,
            MAX_WIDTH,
            height.max(1),
            // Triangle keeps small UI text readable; Nearest turns it to mush
            // and the model starts misreading button labels.
            image::imageops::FilterType::Triangle,
        )
    } else {
        frame
    };

    let width = scaled.width();
    let height = scaled.height();

    let mut png = Vec::new();
    PngEncoder::new(&mut png).write_image(
        scaled.as_raw(),
        width,
        height,
        image::ExtendedColorType::Rgba8,
    )?;

    Ok(Capture {
        png_base64: base64::engine::general_purpose::STANDARD.encode(png),
        width,
        height,
        screen_width,
        screen_height,
    })
}
