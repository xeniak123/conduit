//! Microphone capture on a dedicated thread.
//!
//! `cpal::Stream` is `!Send`, so it cannot live inside Tauri's managed state.
//! Instead the stream is owned by one worker thread that we talk to over a
//! channel. Recording stops by dropping the stream, which is also what flushes
//! the last buffered samples.

use anyhow::{anyhow, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::io::Cursor;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};

/// Whisper and every hosted STT endpoint want 16 kHz mono.
const TARGET_RATE: u32 = 16_000;

enum Cmd {
    Start(Sender<Result<(), String>>),
    Stop(Sender<Result<Vec<u8>, String>>),
}

#[derive(Clone)]
pub struct Audio {
    tx: Sender<Cmd>,
}

impl Audio {
    /// `on_level` receives a 0..1 loudness value roughly 25 times a second.
    /// It drives the waveform in the HUD — a real signal rather than a canned
    /// animation, so a dead microphone is visible immediately.
    pub fn spawn<F>(on_level: F) -> Self
    where
        F: Fn(f32) + Send + Sync + Clone + 'static,
    {
        let (tx, rx) = channel::<Cmd>();

        std::thread::spawn(move || {
            let mut active: Option<(cpal::Stream, Arc<Mutex<Vec<f32>>>, u32, u16)> = None;

            while let Ok(cmd) = rx.recv() {
                match cmd {
                    Cmd::Start(reply) => {
                        if active.is_some() {
                            let _ = reply.send(Ok(()));
                            continue;
                        }
                        match open_stream(on_level.clone()) {
                            Ok(parts) => {
                                active = Some(parts);
                                let _ = reply.send(Ok(()));
                            }
                            Err(e) => {
                                let _ = reply.send(Err(e.to_string()));
                            }
                        }
                    }
                    Cmd::Stop(reply) => {
                        let Some((stream, buf, rate, channels)) = active.take() else {
                            let _ = reply.send(Err("not recording".into()));
                            continue;
                        };
                        drop(stream); // stops capture and flushes
                        let samples = buf.lock().map(|b| b.clone()).unwrap_or_default();
                        let _ = reply.send(encode_wav(samples, rate, channels).map_err(|e| e.to_string()));
                    }
                }
            }
        });

        Self { tx }
    }

    pub fn start(&self) -> Result<(), String> {
        let (tx, rx) = channel();
        self.tx.send(Cmd::Start(tx)).map_err(|_| "audio thread died".to_string())?;
        rx.recv().map_err(|_| "audio thread died".to_string())?
    }

    pub fn stop(&self) -> Result<Vec<u8>, String> {
        let (tx, rx) = channel();
        self.tx.send(Cmd::Stop(tx)).map_err(|_| "audio thread died".to_string())?;
        rx.recv().map_err(|_| "audio thread died".to_string())?
    }
}

type StreamParts = (cpal::Stream, Arc<Mutex<Vec<f32>>>, u32, u16);

fn open_stream<F>(on_level: F) -> Result<StreamParts>
where
    F: Fn(f32) + Send + Sync + Clone + 'static,
{
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or_else(|| anyhow!("no input device — check that a microphone is connected"))?;
    let config = device.default_input_config()?;
    let rate = config.sample_rate().0;
    let channels = config.channels();

    let buf = Arc::new(Mutex::new(Vec::<f32>::with_capacity(rate as usize * 8)));
    let sink = buf.clone();
    let err_fn = |e| log::error!("audio stream error: {e}");

    let meter = Meter::new(on_level);

    // Whatever the device hands us, we normalise to f32 in [-1, 1].
    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => {
            let m = meter.clone();
            device.build_input_stream(
                &config.into(),
                move |data: &[f32], _: &_| push(&sink, &m, data.iter().copied()),
                err_fn,
                None,
            )?
        }
        cpal::SampleFormat::I16 => {
            let m = meter.clone();
            device.build_input_stream(
                &config.into(),
                move |data: &[i16], _: &_| {
                    push(&sink, &m, data.iter().map(|s| *s as f32 / i16::MAX as f32))
                },
                err_fn,
                None,
            )?
        }
        cpal::SampleFormat::U16 => {
            let m = meter.clone();
            device.build_input_stream(
                &config.into(),
                move |data: &[u16], _: &_| {
                    push(&sink, &m, data.iter().map(|s| (*s as f32 - 32768.0) / 32768.0))
                },
                err_fn,
                None,
            )?
        }
        other => return Err(anyhow!("unsupported sample format: {other:?}")),
    };

    stream.play()?;
    Ok((stream, buf, rate, channels))
}

fn push(sink: &Arc<Mutex<Vec<f32>>>, meter: &Meter, samples: impl Iterator<Item = f32>) {
    if let Ok(mut guard) = sink.lock() {
        let before = guard.len();
        guard.extend(samples);
        meter.observe(&guard[before..]);
    }
}

/// Emits a loudness value on a fixed cadence.
///
/// The audio callback fires far more often than any UI needs, and it runs on a
/// realtime thread — so this throttles hard and does nothing but arithmetic.
#[derive(Clone)]
struct Meter {
    sink: Arc<dyn Fn(f32) + Send + Sync>,
    last: Arc<Mutex<std::time::Instant>>,
}

impl Meter {
    fn new<F: Fn(f32) + Send + Sync + Clone + 'static>(f: F) -> Self {
        Self {
            sink: Arc::new(move |v| f(v)),
            last: Arc::new(Mutex::new(std::time::Instant::now())),
        }
    }

    fn observe(&self, samples: &[f32]) {
        if samples.is_empty() {
            return;
        }
        let Ok(mut last) = self.last.lock() else { return };
        if last.elapsed() < std::time::Duration::from_millis(40) {
            return;
        }
        *last = std::time::Instant::now();

        let rms = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt();
        // Speech sits low in linear terms; this curve makes normal talking
        // fill most of the meter instead of hugging the floor.
        (self.sink)((rms * 4.0).clamp(0.0, 1.0).powf(0.7));
    }
}

fn encode_wav(samples: Vec<f32>, rate: u32, channels: u16) -> Result<Vec<u8>> {
    if samples.is_empty() {
        return Err(anyhow!("nothing was recorded"));
    }

    let mono = downmix(samples, channels);
    let resampled = resample(&mono, rate, TARGET_RATE);

    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: TARGET_RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };

    let mut out = Cursor::new(Vec::<u8>::new());
    {
        let mut writer = hound::WavWriter::new(&mut out, spec)?;
        for s in resampled {
            writer.write_sample((s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16)?;
        }
        writer.finalize()?;
    }
    Ok(out.into_inner())
}

fn downmix(samples: Vec<f32>, channels: u16) -> Vec<f32> {
    if channels <= 1 {
        return samples;
    }
    let n = channels as usize;
    samples.chunks(n).map(|f| f.iter().sum::<f32>() / n as f32).collect()
}

/// Linear interpolation. Not audiophile-grade, but speech recognition does not
/// notice the difference and it keeps us free of a resampler dependency.
fn resample(input: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || input.is_empty() {
        return input.to_vec();
    }
    let ratio = from as f64 / to as f64;
    let len = (input.len() as f64 / ratio).floor() as usize;
    (0..len)
        .map(|i| {
            let pos = i as f64 * ratio;
            let idx = pos.floor() as usize;
            let frac = (pos - idx as f64) as f32;
            let a = input[idx];
            let b = *input.get(idx + 1).unwrap_or(&a);
            a + (b - a) * frac
        })
        .collect()
}
