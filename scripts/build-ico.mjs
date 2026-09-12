/*
 * Packs docs/assets/favicon-16.png and favicon-32.png into docs/favicon.ico.
 *
 *   node scripts/build-ico.mjs
 *   node scripts/build-ico.mjs --dry-run
 *
 * /favicon.ico is the one icon browsers request without being told to, so it
 * cannot be an SVG and cannot live behind a <link>. It is committed like the
 * share cards are; this exists so it can be rebuilt from the brand PNGs rather
 * than being a binary nobody can reproduce.
 *
 * An .ico is a directory of images, not an image. Each entry here holds a whole
 * PNG file rather than the format's original BMP payload -- every browser that
 * requests /favicon.ico at all has read PNG-compressed entries for well over a
 * decade, and it keeps the bytes identical to the PNGs the brand package ships.
 *
 * Zero dependencies, like everything else here.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'favicon.ico');
const SOURCES = [
  { size: 16, file: join(ROOT, 'docs', 'assets', 'favicon-16.png') },
  { size: 32, file: join(ROOT, 'docs', 'assets', 'favicon-32.png') }
];

const HEADER = 6;
const ENTRY = 16;

const images = SOURCES.map((s) => ({ ...s, bytes: readFileSync(s.file) }));

const header = Buffer.alloc(HEADER);
header.writeUInt16LE(0, 0);                 // reserved
header.writeUInt16LE(1, 2);                 // 1 = icon, 2 = cursor
header.writeUInt16LE(images.length, 4);

/* Entries come first, then the payloads, so an offset is only knowable once the
   whole directory has been sized. */
let offset = HEADER + ENTRY * images.length;

const entries = images.map((img) => {
  const e = Buffer.alloc(ENTRY);
  e.writeUInt8(img.size, 0);                // width; 0 would mean 256
  e.writeUInt8(img.size, 1);                // height
  e.writeUInt8(0, 2);                       // palette size; 0 = truecolour
  e.writeUInt8(0, 3);                       // reserved
  e.writeUInt16LE(1, 4);                    // colour planes
  e.writeUInt16LE(32, 6);                   // bits per pixel
  e.writeUInt32LE(img.bytes.length, 8);
  e.writeUInt32LE(offset, 12);
  offset += img.bytes.length;
  return e;
});

const ico = Buffer.concat([header, ...entries, ...images.map((i) => i.bytes)]);

if (process.argv.includes('--dry-run') || process.argv.includes('-n')) {
  const sizes = images.map((i) => `${i.size}x${i.size}`).join(', ');
  console.log(`would write: docs/favicon.ico  (${sizes}; ${ico.length} bytes)`);
  process.exit(0);
}

writeFileSync(OUT, ico);
console.log(`wrote: docs/favicon.ico  (${ico.length} bytes)`);
