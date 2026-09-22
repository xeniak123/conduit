/**
 * Renders the application icon from the same geometry as the in-app mark.
 *
 * Kept as a script rather than committed binaries so the icon can never drift
 * from the logo component: change one, re-run this, and every size regenerates.
 * No image library — the mark is two rounded-rectangle strokes, which is a
 * signed-distance problem, and a dependency to draw two shapes is a liability.
 *
 *   node tools/make-icons.cjs
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// --- the mark, in the logo's own 100-unit coordinate space -----------------

const PLATE = { radius: 0.22, fill: [20, 20, 24, 255] };
const MARK = [255, 254, 252, 255];

/** Outer bracket: rounded rect, open past `cut`, stroke 12. */
const OUTER = { x0: 18, y0: 18, x1: 200, y1: 82, r: 16, half: 6, cut: 58 };
/** Inner bracket: the channel narrowing, stroke 10. */
const INNER = { x0: 40, y0: 40, x1: 200, y1: 60, r: 8, half: 5, cut: 64 };

/** Signed distance to a rounded rectangle's outline (negative inside). */
function sdRoundRect(px, py, { x0, y0, x1, y1, r }) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const hx = (x1 - x0) / 2 - r;
  const hy = (y1 - y0) / 2 - r;
  const dx = Math.abs(px - cx) - hx;
  const dy = Math.abs(py - cy) - hy;
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - r;
}

/** Coverage of one bracket at a point: the stroke band, plus its round caps. */
function onBracket(px, py, b) {
  if (px <= b.cut && Math.abs(sdRoundRect(px, py, b)) <= b.half) return true;
  // Caps sit exactly where the path stops, so the ends read as drawn, not cut.
  if (Math.hypot(px - b.cut, py - b.y0) <= b.half) return true;
  if (Math.hypot(px - b.cut, py - b.y1) <= b.half) return true;
  return false;
}

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const SS = 4; // supersampling; the mark has curves that alias badly at 1x
  const plateR = size * PLATE.radius;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let plate = 0;
      let mark = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) / SS;
          const fy = y + (sy + 0.5) / SS;

          const inPlate =
            sdRoundRect(fx, fy, { x0: 0, y0: 0, x1: size, y1: size, r: plateR }) <= 0;
          if (!inPlate) continue;
          plate++;

          // Into the mark's own 100-unit space.
          const ux = (fx / size) * 100;
          const uy = (fy / size) * 100;
          if (onBracket(ux, uy, OUTER) || onBracket(ux, uy, INNER)) mark++;
        }
      }

      const samples = SS * SS;
      const plateA = plate / samples;
      if (plateA === 0) continue;

      const markA = mark / samples;
      const i = (y * size + x) * 4;

      // A faint top-edge highlight: the light a physical plate would catch.
      const lift = Math.max(0, 1 - y / (size * 0.42)) * 16;

      for (let c = 0; c < 3; c++) {
        const base = Math.min(255, PLATE.fill[c] + lift);
        px[i + c] = Math.round(base * (1 - markA) + MARK[c] * markA);
      }
      px[i + 3] = Math.round(255 * plateA);
    }
  }

  return png(px, size);
}

// --- PNG container ---------------------------------------------------------

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(pixels, size) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    pixels.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** ICO carrying PNG payloads — supported since Vista, and what Tauri wants. */
function ico(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);

  const dir = [];
  let offset = 6 + entries.length * 16;

  for (const { size, data } of entries) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    dir.push(e);
    offset += data.length;
  }

  return Buffer.concat([header, ...dir, ...entries.map((e) => e.data)]);
}

// --- output ----------------------------------------------------------------

const out = path.join(__dirname, "..", "src-tauri", "icons");
fs.mkdirSync(out, { recursive: true });

// Tauri wants a square master plus the platform bundles; Windows needs several
// sizes inside one .ico so the shell picks a crisp one at every zoom level.
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const rendered = SIZES.map((size) => ({ size, data: render(size) }));

for (const { size, data } of rendered) {
  if ([32, 128, 256].includes(size)) {
    fs.writeFileSync(path.join(out, `${size}x${size}.png`), data);
  }
}

fs.writeFileSync(path.join(out, "icon.png"), render(512));
fs.writeFileSync(path.join(out, "icon.ico"), ico(rendered));

console.log(`icons written to ${out}`);
