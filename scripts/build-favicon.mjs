// Generate a brand-accurate favicon.svg by tracing the Stalinist One glyphs
// for "3" and "f" into <path> elements. opentype.js reads the TTF and hands
// us SVG-compatible path data; we then translate each path so the combined
// mark sits centered in the 64×64 squircle.

import opentype from 'opentype.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const PUBLIC_DIR = resolve(ROOT, 'examples/asia-building/public');
const TTF = '/tmp/StalinistOne-Regular.ttf';

const font = opentype.parse(readFileSync(TTF).buffer);

const VIEW = 64;
const SIZE_F = 34;                        // smaller so the mark sits with margin in the squircle
const SIZE_3 = Math.round(SIZE_F * 0.58); // matches the header's 0.58em ratio
const GAP = 1.5;                          // px between the 3 and the f

// Translate every command in an opentype Path by (dx, dy).
function translatePath(path, dx, dy) {
  for (const c of path.commands) {
    if (c.x  !== undefined) c.x  += dx;
    if (c.y  !== undefined) c.y  += dy;
    if (c.x1 !== undefined) c.x1 += dx;
    if (c.y1 !== undefined) c.y1 += dy;
    if (c.x2 !== undefined) c.x2 += dx;
    if (c.y2 !== undefined) c.y2 += dy;
  }
}

// Get the path + its true rendered bounding box at baseline (0, 0).
function glyphAt(char, fontSize) {
  const path = font.getPath(char, 0, 0, fontSize);
  const bb = path.getBoundingBox();
  return { path, bb, w: bb.x2 - bb.x1, h: bb.y2 - bb.y1 };
}

const f3 = glyphAt('f', SIZE_F);
const t3 = glyphAt('3', SIZE_3);

// Centre the f vertically in the viewport, accounting for any descender.
// Then translate so its bbox sits at the chosen vertical position.
const fTop  = (VIEW - f3.h) / 2;
const fDx_f = -f3.bb.x1;                  // align bbox left to x=0
const fDy_f = fTop - f3.bb.y1;            // align bbox top to fTop

// Place the 3 to the LEFT of the f, with its top aligned to the f's top
// (reads as a superscript at the upper-left of the mark).
const totalW = t3.w + GAP + f3.w;
const startX = (VIEW - totalW) / 2;
const fDx    = startX + t3.w + GAP - f3.bb.x1;
const tDx    = startX - t3.bb.x1;
const tDy    = fTop - t3.bb.y1;           // top-aligned with f

translatePath(f3.path, fDx,    fDy_f);
translatePath(t3.path, tDx,    tDy);

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW} ${VIEW}" role="img" aria-label="Three Fenestra">
  <!-- Squircle background. -->
  <rect width="${VIEW}" height="${VIEW}" rx="14" ry="14" fill="#0a0c10"/>
  <!-- Warm hairline rim. -->
  <rect x="0.5" y="0.5" width="${VIEW - 1}" height="${VIEW - 1}" rx="13.5" ry="13.5"
        fill="none" stroke="#ffe6be" stroke-opacity="0.22" stroke-width="1"/>
  <!-- "3" — small, white, top-left (traced from Stalinist One). -->
  <path d="${t3.path.toPathData(2)}" fill="#ffffff"/>
  <!-- "f" — large, amber (traced from Stalinist One). -->
  <path d="${f3.path.toPathData(2)}" fill="#F5B544"/>
</svg>
`;

writeFileSync(resolve(PUBLIC_DIR, 'favicon.svg'), svg);
console.log(`wrote favicon.svg  (f bbox h=${f3.h.toFixed(1)}px, padding ≈${fTop.toFixed(1)}px)`);

for (const { size, name } of [
  { size: 96,  name: 'favicon-96.png' },
  { size: 180, name: 'apple-touch-icon.png' },
]) {
  const r = spawnSync('rsvg-convert', [
    resolve(PUBLIC_DIR, 'favicon.svg'),
    '-w', String(size), '-h', String(size),
    '-o', resolve(PUBLIC_DIR, name),
  ], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`rsvg-convert failed for ${name}`);
  console.log(`wrote ${name}`);
}
