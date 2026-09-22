/**
 * Installer artwork: the NSIS sidebar (164×314) and header (150×57) bitmaps.
 *
 * Same approach as make-icons.cjs: drawn from the logo's geometry, so the
 * installer can never drift from the app. NSIS wants 24-bit BMP, which is
 * simple enough to write by hand.
 *
 *   node tools/make-installer-art.cjs
 */

const fs = require("fs");
const path = require("path");

const OUTER = { x0: 18, y0: 18, x1: 200, y1: 82, r: 16, half: 6, cut: 58 };
const INNER = { x0: 40, y0: 40, x1: 200, y1: 60, r: 8, half: 5, cut: 64 };

function sdRoundRect(px, py, { x0, y0, x1, y1, r }) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const hx = (x1 - x0) / 2 - r;
  const hy = (y1 - y0) / 2 - r;
  const dx = Math.abs(px - cx) - hx;
  const dy = Math.abs(py - cy) - hy;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
}

function onBracket(px, py, b) {
  if (px <= b.cut && Math.abs(sdRoundRect(px, py, b)) <= b.half) return true;
  if (Math.hypot(px - b.cut, py - b.y0) <= b.half) return true;
  if (Math.hypot(px - b.cut, py - b.y1) <= b.half) return true;
  return false;
}

/** Coverage of the mark placed at (ox, oy) with the given size, at a pixel. */
function markAt(x, y, ox, oy, size) {
  const SS = 4;
  let hit = 0;
  for (let sy = 0; sy < SS; sy++) {
    for (let sx = 0; sx < SS; sx++) {
      const u = ((x + (sx + 0.5) / SS - ox) / size) * 100;
      const v = ((y + (sy + 0.5) / SS - oy) / size) * 100;
      if (u < 0 || v < 0 || u > 100 || v > 100) continue;
      if (onBracket(u, v, OUTER) || onBracket(u, v, INNER)) hit++;
    }
  }
  return hit / (SS * SS);
}

const mix = (a, b, t) => a.map((c, i) => Math.round(c + (b[i] - c) * t));

function bmp(width, height, pixel) {
  const row = Math.ceil((width * 3) / 4) * 4;
  const size = 54 + row * height;
  const buf = Buffer.alloc(size);
  buf.write("BM", 0);
  buf.writeUInt32LE(size, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(row * height, 34);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      // BMP rows run bottom-up, channels BGR.
      const o = 54 + (height - 1 - y) * row + x * 3;
      buf[o] = b;
      buf[o + 1] = g;
      buf[o + 2] = r;
    }
  }
  return buf;
}

const INK_TOP = [34, 34, 40];
const INK_BOTTOM = [14, 14, 17];
const EMBER = [255, 106, 31];
const WHITE = [255, 254, 252];

// Sidebar: ink, a warm glow low on the left, the mark, a thin ember line.
const sidebar = bmp(164, 314, (x, y) => {
  let c = mix(INK_TOP, INK_BOTTOM, y / 314);
  const glow = Math.max(0, 1 - Math.hypot(x - 20, y - 300) / 220);
  c = mix(c, EMBER, glow * glow * 0.35);
  const m = markAt(x, y, 42, 70, 80);
  c = mix(c, WHITE, m);
  if (y >= 186 && y <= 187 && x >= 42 && x <= 72) c = EMBER;
  return c;
});

// Header: white, the mark in ink at the right.
const header = bmp(150, 57, (x, y) => {
  let c = [255, 255, 255];
  const m = markAt(x, y, 104, 10, 37);
  c = mix(c, [26, 26, 23], m);
  return c;
});

const out = path.join(__dirname, "..", "src-tauri", "installer");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "sidebar.bmp"), sidebar);
fs.writeFileSync(path.join(out, "header.bmp"), header);
console.log("wrote", path.join(out, "sidebar.bmp"), "and header.bmp");
