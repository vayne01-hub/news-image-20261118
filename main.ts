// news-image-20261118 — one image summing up the world news of
// Wednesday 18 November 2026.
//
// Drawn entirely in code: a 1024x1024 RGB canvas, a hand-rolled 5x7
// bitmap font, a dotted world map with numbered pins, and seven
// numbered stories below it. Node standard library only, no network,
// deterministic output (two runs write identical bytes).
//
// Usage: MAKEFUN_OUTPUT_DIR=/some/dir node main.ts
// Writes $MAKEFUN_OUTPUT_DIR/entry.png

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

type RGB = [number, number, number];

const PAPER: RGB = [247, 243, 232];
const INK: RGB = [20, 33, 61];
const RED: RGB = [192, 57, 43];
const BLUE: RGB = [29, 111, 184];
const GOLD: RGB = [217, 164, 65];

const W = 1024;
const H = 1024;
const buf = Buffer.alloc(W * H * 3);

// ---------------------------------------------------------------------------
// Canvas primitives
// ---------------------------------------------------------------------------

function setPixel(x: number, y: number, c: RGB): void {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 3;
  buf[i] = c[0];
  buf[i + 1] = c[1];
  buf[i + 2] = c[2];
}

function fill(c: RGB): void {
  for (let i = 0; i < W * H; i++) {
    buf[i * 3] = c[0];
    buf[i * 3 + 1] = c[1];
    buf[i * 3 + 2] = c[2];
  }
}

function rect(x: number, y: number, w: number, h: number, c: RGB): void {
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) setPixel(xx, yy, c);
  }
}

function hline(x: number, y: number, len: number, t: number, c: RGB): void {
  for (let yy = y; yy < y + t; yy++) {
    for (let xx = x; xx < x + len; xx++) setPixel(xx, yy, c);
  }
}

function vline(x: number, y: number, len: number, t: number, c: RGB): void {
  for (let xx = x; xx < x + t; xx++) {
    for (let yy = y; yy < y + len; yy++) setPixel(xx, yy, c);
  }
}

// Bresenham line.
function line(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    setPixel(x0, y0, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

// A thick line is the same line drawn at small offsets, giving a
// roughly square-tipped stroke t pixels wide.
function thickLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  t: number,
  c: RGB,
): void {
  for (let ox = 0; ox < t; ox++) {
    for (let oy = 0; oy < t; oy++) {
      line(x0 + ox, y0 + oy, x1 + ox, y1 + oy, c);
    }
  }
}

function plot8(cx: number, cy: number, x: number, y: number, c: RGB): void {
  setPixel(cx + x, cy + y, c);
  setPixel(cx - x, cy + y, c);
  setPixel(cx + x, cy - y, c);
  setPixel(cx - x, cy - y, c);
  setPixel(cx + y, cy + x, c);
  setPixel(cx - y, cy + x, c);
  setPixel(cx + y, cy - x, c);
  setPixel(cx - y, cy - x, c);
}

function circleOutline(cx: number, cy: number, r: number, c: RGB): void {
  let x = 0;
  let y = r;
  let d = 3 - 2 * r;
  while (x <= y) {
    plot8(cx, cy, x, y, c);
    if (d < 0) {
      d += 4 * x + 6;
    } else {
      d += 4 * (x - y) + 10;
      y--;
    }
    x++;
  }
}

function disc(cx: number, cy: number, r: number, c: RGB): void {
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.floor(Math.sqrt(r * r - dy * dy));
    hline(cx - half, cy + dy, half * 2 + 1, 1, c);
  }
}

function ring(cx: number, cy: number, r: number, t: number, c: RGB): void {
  for (let rr = r - t + 1; rr <= r; rr++) circleOutline(cx, cy, rr, c);
}

// ---------------------------------------------------------------------------
// PNG encoder (hand-rolled: IHDR / IDAT / IEND, CRC32, zlib level 9)
// ---------------------------------------------------------------------------

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 4, "ascii");
  data.copy(out, 8);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 0);
  crc.copy(out, 8 + data.length);
  return out;
}

function encodePNG(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type 2 = RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0; // filter byte 0: none
    buf.copy(raw, y * (1 + W * 3) + 1, y * W * 3, (y + 1) * W * 3);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// 5x7 bitmap font. Each glyph is 7 rows; bit 4 is the leftmost pixel.
// CHAR_W is 6 (5 pixels plus 1 pixel of spacing).
// ---------------------------------------------------------------------------

const GLYPHS: Record<string, number[]> = {
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 21, 19, 17, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 27, 17],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
  "0": [14, 17, 19, 21, 25, 17, 14],
  "1": [4, 12, 4, 4, 4, 4, 14],
  "2": [14, 17, 1, 2, 4, 8, 31],
  "3": [31, 2, 4, 2, 1, 17, 14],
  "4": [2, 6, 10, 18, 31, 2, 2],
  "5": [31, 16, 30, 1, 1, 17, 14],
  "6": [6, 8, 16, 30, 17, 17, 14],
  "7": [31, 1, 2, 4, 8, 8, 8],
  "8": [14, 17, 17, 14, 17, 17, 14],
  "9": [14, 17, 17, 15, 1, 2, 12],
  ".": [0, 0, 0, 0, 0, 12, 12],
  ",": [0, 0, 0, 0, 12, 4, 8],
  ";": [0, 12, 12, 0, 12, 4, 8],
  ":": [0, 12, 12, 0, 12, 12, 0],
  "'": [4, 4, 8, 0, 0, 0, 0],
  "-": [0, 0, 0, 14, 0, 0, 0],
  "+": [0, 4, 4, 31, 4, 4, 0],
  "%": [25, 25, 2, 4, 8, 19, 19],
  $: [4, 15, 20, 14, 5, 30, 4],
  "&": [12, 18, 20, 8, 21, 18, 13],
  "·": [0, 0, 0, 12, 12, 0, 0],
  "/": [1, 1, 2, 4, 8, 16, 16],
  "(": [2, 4, 8, 8, 8, 4, 2],
  ")": [8, 4, 2, 2, 2, 4, 8],
  "!": [4, 4, 4, 4, 4, 0, 4],
  "?": [14, 17, 1, 2, 4, 0, 4],
  " ": [0, 0, 0, 0, 0, 0, 0],
};

function textWidth(text: string, scale: number): number {
  return text.length * 6 * scale - scale;
}

function drawText(x: number, y: number, text: string, scale: number, c: RGB): void {
  const s = text.toUpperCase();
  let cx = x;
  for (const ch of s) {
    const glyph = GLYPHS[ch] ?? GLYPHS[" "];
    for (let r = 0; r < 7; r++) {
      const row = glyph[r];
      for (let col = 0; col < 5; col++) {
        if ((row >> (4 - col)) & 1) {
          rect(cx + col * scale, y + r * scale, scale, scale, c);
        }
      }
    }
    cx += 6 * scale;
  }
}

function drawTextCentred(cx: number, y: number, text: string, scale: number, c: RGB): void {
  drawText(cx - Math.floor(textWidth(text, scale) / 2), y, text, scale, c);
}

// Greedy word wrap, at most two lines. Fails loudly rather than
// silently dropping words, so a too-long fact breaks the build.
function wrapText(text: string, scale: number, maxWidth: number): string[] {
  const words = text.toUpperCase().split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const cand = cur ? cur + " " + w : w;
    if (textWidth(cand, scale) <= maxWidth) {
      cur = cand;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > 2) {
    throw new Error("fact needs more than 2 lines: " + text);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// World map. Rect {x:40, y:102, w:944, h:296}; equirectangular projection
// over lon -180..180 and lat 84..-56. Land is a 64x32 cell grid; each
// span [start, end] lists the land columns of one row (row 0 = north).
// ---------------------------------------------------------------------------

const MAP_X = 40;
const MAP_Y = 102;
const MAP_W = 944;
const MAP_H = 296;

const MAP_SPANS: Array<Array<[number, number]>> = [
  [[17, 19], [22, 24]],
  [[15, 20], [21, 26]],
  [[3, 16], [21, 26], [28, 29], [33, 62]],
  [[4, 16], [21, 25], [32, 61]],
  [[5, 15], [29, 37], [36, 60]],
  [[6, 14], [29, 37], [40, 59]],
  [[7, 15], [29, 37], [40, 56]],
  [[7, 16], [29, 36], [40, 54]],
  [[8, 20], [29, 36], [37, 39], [44, 52], [56, 58]],
  [[8, 19], [29, 32], [37, 39], [44, 50], [55, 57]],
  [[9, 19], [29, 39], [37, 38], [44, 48], [55, 56]],
  [[10, 14], [29, 39], [37, 39], [45, 48]],
  [[11, 14], [29, 39], [37, 40], [45, 47]],
  [[13, 24], [30, 39], [37, 41], [47, 49]],
  [[17, 25], [31, 39], [37, 39], [48, 50]],
  [[18, 25], [31, 38], [49, 56]],
  [[18, 24], [31, 38], [50, 55]],
  [[18, 23], [32, 37], [49, 57]],
  [[19, 22], [31, 37], [50, 57]],
  [[19, 22], [32, 38], [52, 57]],
  [[19, 21], [32, 38], [51, 58]],
  [[20, 21], [32, 37], [52, 58]],
  [[20, 21], [33, 36], [51, 59]],
  [[20, 20], [33, 36], [51, 59]],
  [[20, 20], [34, 35], [52, 58]],
  [[20, 21], [34, 35], [53, 56]],
  [[20, 21], [34, 35]],
  [[20, 20], [35, 35], [61, 62]],
  [[20, 20], [35, 35], [61, 63]],
  [[55, 56], [61, 62]],
  [[20, 20]],
];

function project(lat: number, lon: number): [number, number] {
  return [
    Math.round(MAP_X + ((lon + 180) / 360) * MAP_W),
    Math.round(MAP_Y + ((84 - lat) / 140) * MAP_H),
  ];
}

function drawMap(): void {
  // Dotted gold graticule, every 30 degrees.
  for (let lon = -150; lon <= 150; lon += 30) {
    const x = Math.round(MAP_X + ((lon + 180) / 360) * MAP_W);
    for (let y = MAP_Y; y < MAP_Y + MAP_H; y += 2) setPixel(x, y, GOLD);
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const y = Math.round(MAP_Y + ((84 - lat) / 140) * MAP_H);
    for (let x = MAP_X; x < MAP_X + MAP_W; x += 2) setPixel(x, y, GOLD);
  }
  // One blue disc per land cell.
  const cw = MAP_W / 64;
  const ch = MAP_H / 32;
  const r = Math.max(2, Math.floor(Math.min(cw, ch) * 0.42));
  for (let row = 0; row < 32; row++) {
    for (const [a, b] of MAP_SPANS[row] ?? []) {
      for (let col = a; col <= b; col++) {
        const cx = Math.round(MAP_X + (col + 0.5) * cw);
        const cy = Math.round(MAP_Y + (row + 0.5) * ch);
        disc(cx, cy, r, BLUE);
      }
    }
  }
  // Ink frame, 3px thick, 3px outside the map rect.
  rect(MAP_X - 3, MAP_Y - 3, MAP_W + 6, 3, INK);
  rect(MAP_X - 3, MAP_Y + MAP_H, MAP_W + 6, 3, INK);
  rect(MAP_X - 3, MAP_Y - 3, 3, MAP_H + 6, INK);
  rect(MAP_X + MAP_W, MAP_Y - 3, 3, MAP_H + 6, INK);
}

// ---------------------------------------------------------------------------
// Icons. Each is drawn in a 24-unit grid scaled to `size` pixels, using
// the same primitives as the rest of the image, bold enough to read at 30px.
// ---------------------------------------------------------------------------

function arcPolyline(
  pts: Array<[number, number]>,
  t: number,
  c: RGB,
): void {
  for (let i = 0; i + 1 < pts.length; i++) {
    thickLine(
      Math.round(pts[i][0]),
      Math.round(pts[i][1]),
      Math.round(pts[i + 1][0]),
      Math.round(pts[i + 1][1]),
      t,
      c,
    );
  }
}

function drawIcon(kind: string, x: number, y: number, size: number): void {
  const u = size / 24;
  const X = (gx: number): number => Math.round(x + gx * u);
  const Y = (gy: number): number => Math.round(y + gy * u);
  const Wpx = (gw: number): number => Math.max(1, Math.round(gw * u));
  const irect = (gx: number, gy: number, gw: number, gh: number, c: RGB): void =>
    rect(X(gx), Y(gy), Wpx(gw), Wpx(gh), c);
  const iline = (gx0: number, gy0: number, gx1: number, gy1: number, t: number, c: RGB): void =>
    thickLine(X(gx0), Y(gy0), X(gx1), Y(gy1), t, c);
  const idisc = (gcx: number, gcy: number, gr: number, c: RGB): void =>
    disc(X(gcx), Y(gcy), Math.max(1, Math.round(gr * u)), c);
  const iarc = (gcx: number, gcy: number, gr: number, a0: number, a1: number, t: number, c: RGB): void => {
    const pts: Array<[number, number]> = [];
    for (let a = a0; a <= a1 + 1e-9; a += 0.25) {
      pts.push([x + (gcx + gr * Math.cos(a)) * u, y + (gcy + gr * Math.sin(a)) * u]);
    }
    arcPolyline(pts, t, c);
  };

  if (kind === "flag") {
    // Pole, red flag with a paper stripe and an ink diagonal.
    iline(4, 2, 4, 22, 2, INK);
    irect(6, 3, 14, 8, RED);
    irect(6, 6, 14, 2, PAPER);
    iline(6, 3, 20, 11, 1, INK);
  } else if (kind === "lock") {
    // Padlock: shackle arc on top, body rect, keyhole dot.
    iarc(12, 9, 5, Math.PI, 2 * Math.PI, 2, INK);
    irect(6, 10, 12, 11, INK);
    idisc(12, 14, 2, PAPER);
    irect(11, 15, 2, 4, PAPER);
  } else if (kind === "city") {
    // Three building blocks with window dots, the middle one taller.
    irect(2, 13, 6, 9, INK);
    irect(9, 7, 6, 15, INK);
    irect(16, 15, 6, 7, INK);
    const windows: Array<[number, number]> = [
      [4, 16], [6, 16], [4, 19], [6, 19],
      [11, 10], [13, 10], [11, 13], [13, 13], [11, 16], [13, 16], [11, 19], [13, 19],
      [18, 17], [20, 17], [18, 20], [20, 20],
    ];
    for (const [wx, wy] of windows) idisc(wx, wy, 1, PAPER);
  } else if (kind === "capitol") {
    // Dome on a base with columns.
    idisc(12, 3, 1.2, INK);
    iarc(12, 11, 6.5, Math.PI, 2 * Math.PI, 2, INK);
    irect(4, 11, 16, 3, INK);
    irect(5, 14, 2, 6, INK);
    irect(11, 14, 2, 6, INK);
    irect(17, 14, 2, 6, INK);
    irect(3, 20, 18, 2, INK);
  } else if (kind === "storm") {
    // Spiral swirl with a centre dot.
    const pts: Array<[number, number]> = [];
    for (let th = 0; th <= 4 * Math.PI + 1e-9; th += 0.2) {
      const r = 1.2 + th * 0.55;
      pts.push([x + (12 + r * Math.cos(th)) * u, y + (12 + r * Math.sin(th)) * u]);
    }
    arcPolyline(pts, 2, BLUE);
    idisc(12, 12, 2, RED);
  } else if (kind === "factory") {
    // Factory block with two chimneys and smoke dots.
    irect(4, 3, 3, 10, INK);
    irect(9, 6, 3, 7, INK);
    idisc(5.5, 1, 1.5, BLUE);
    idisc(10.5, 4, 1.5, BLUE);
    irect(2, 13, 20, 9, INK);
    for (const wx of [5, 9, 13, 17]) idisc(wx, 16, 1, PAPER);
    irect(11, 18, 3, 4, PAPER);
  } else if (kind === "book") {
    // Open book: two page panels with text lines, ink spine.
    irect(3, 7, 9, 11, PAPER);
    irect(12, 7, 9, 11, PAPER);
    hline(X(3), Y(7), Wpx(9), 1, INK);
    hline(X(12), Y(7), Wpx(9), 1, INK);
    vline(X(3), Y(7), Wpx(11), 1, INK);
    vline(X(20), Y(7), Wpx(11), 1, INK);
    hline(X(3), Y(17), Wpx(9), 1, INK);
    hline(X(12), Y(17), Wpx(9), 1, INK);
    vline(X(12), Y(7), Wpx(11), 2, INK);
    for (const ly of [10, 13, 16]) {
      hline(X(5), Y(ly), Wpx(5), 1, BLUE);
      hline(X(14), Y(ly), Wpx(5), 1, BLUE);
    }
  }
}

// ---------------------------------------------------------------------------
// Stories: 18 November 2026, in map order.
// ---------------------------------------------------------------------------

type Story = {
  lat: number;
  lon: number;
  dx: number;
  dy: number;
  icon: string;
  title: string;
  fact: string;
};

const STORIES: Story[] = [
  {
    lat: 22.54, lon: 114.06, dx: 0, dy: 0, icon: "flag",
    title: "TRUMP ARRIVES IN SHENZHEN AS XI AND PUTIN MEET",
    fact: "Xi and Putin hold talks at the APEC summit in Shenzhen; Trump arrives from Manila, three-way meeting set for Thursday.",
  },
  {
    lat: 39.11, lon: -76.75, dx: 0, dy: 0, icon: "lock",
    title: "NSA CLASSIFIED NETWORK GOES DOWN IN US",
    fact: "NSANet, the NSA's classified internal network, went offline in routine maintenance; officials say not a cyberattack.",
  },
  {
    lat: -6.21, lon: 106.85, dx: 0, dy: 0, icon: "city",
    title: "INDONESIA AND CHINA SIGN $71.8B IN DEALS",
    fact: "Four partnerships including 10 smart cities, witnessed by President Prabowo at the APEC summit in Shenzhen.",
  },
  {
    lat: 61.22, lon: -149.9, dx: 0, dy: 0, icon: "capitol",
    title: "PELTOLA WINS ALASKA SENATE SEAT, FLIPPING IT FROM REPUBLICANS",
    fact: "Democrat Mary Peltola defeats Republican Dan Sullivan with 50.1% of first-choice votes; AP called the race Tuesday night.",
  },
  {
    lat: 18.3, lon: 84.5, dx: 0, dy: 0, icon: "storm",
    title: "CYCLONE AKVAN NEARS COAST, ODISHA BRACES",
    fact: "Odisha moves coastal residents to shelters as severe Cyclone Akvan nears; landfall due Friday between Narsapur and Puri.",
  },
  {
    lat: 23.81, lon: 90.41, dx: 18, dy: -10, icon: "factory",
    title: "BANGLADESH GARMENT WORKERS CLASH WITH POLICE",
    fact: "Workers demanding a higher minimum wage clash with police near Dhaka; 132 factories shut in Ashulia alone.",
  },
  {
    lat: 52.21, lon: 0.12, dx: 0, dy: 0, icon: "book",
    title: "CAMBRIDGE NAMES 'HUMAN' WORD OF THE YEAR",
    fact: "Cambridge Dictionary picks 'human' for 2026, citing the debate over AI blurring people and machines.",
  },
];

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

function drawPins(): void {
  STORIES.forEach((s, i) => {
    const [tx, ty] = project(s.lat, s.lon);
    const cx = tx + s.dx;
    const cy = ty + s.dy;
    if (s.dx !== 0 || s.dy !== 0) {
      thickLine(tx, ty, cx, cy, 2, RED);
      disc(tx, ty, 4, RED);
    }
    disc(cx, cy, 13, RED);
    ring(cx, cy, 13, 2, PAPER);
    drawText(cx - 5, cy - 7, String(i + 1), 2, PAPER);
  });
}

function drawRows(): void {
  STORIES.forEach((s, i) => {
    const y = 420 + i * 80;
    rect(40, y, 944, 74, PAPER);
    hline(40, y, 944, 2, GOLD);
    disc(70, y + 37, 15, RED);
    ring(70, y + 37, 15, 2, PAPER);
    drawText(65, y + 30, String(i + 1), 2, PAPER);
    drawIcon(s.icon, 100, y + 22, 30);
    drawText(146, y + 10, s.title, 2, INK);
    const lines = wrapText(s.fact, 2, 778);
    lines.forEach((ln, li) => drawText(146, y + 34 + li * 15, ln, 2, BLUE));
  });
}

function main(): void {
  fill(PAPER);
  // Header.
  hline(40, 14, 944, 4, RED);
  drawTextCentred(512, 28, "WORLD NEWS · 18 NOVEMBER 2026", 4, INK);
  drawTextCentred(512, 68, "7 STORIES FROM AROUND THE WORLD", 2, BLUE);
  // Map and pins.
  drawMap();
  drawPins();
  // Story rows.
  drawRows();
  // Footer.
  drawTextCentred(512, 982, "SOURCES: REUTERS, AP, CNN, ANTARA AND OTHERS", 2, INK);

  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "output";
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "entry.png"), encodePNG());
}

main();
