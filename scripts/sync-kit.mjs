/*
 * Copies finished assets from the cm-universe brand kit into docs/assets/.
 *
 *   node scripts/sync-kit.mjs
 *   node scripts/sync-kit.mjs --dry-run
 *   CM_KIT=/path/to/cm-universe/assets node scripts/sync-kit.mjs
 *
 * Then run `node scripts/build-ico.mjs`, which packs the favicon PNGs this writes.
 *
 * The kit composes its own web assets (cm-universe/source/pipeline/cm5_compose), and for
 * the icons and the About detail plates its output is already what this site needs. The
 * icons come from the kit's simplified icon mark, which is modelled and lit to survive
 * 16px, rather than from a trim of the full mark; the detail plates are the same three
 * cameras this page already showed, at final render quality. Copying beats regenerating,
 * and it keeps one source per file: build-brand.mjs no longer writes anything listed here.
 *
 * What is deliberately NOT copied. The header mark and the home hero stay with
 * build-brand.mjs, because they come from the kit's site_* cutouts, which are framed and
 * bloomed for this site's own hero slot rather than for the kit's pages. The share cards
 * stay with build-og.mjs, which draws each page's own eyebrow and title over the kit's
 * hero render. The kit's logo lockups, legend board, mobile heroes and legend icons have
 * no slot on this site and are not copied at all.
 *
 * Zero dependencies, and no browser: every file here is a byte-for-byte copy, except the
 * favicon SVG, which is two of the kit's PNGs wrapped in a media query.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const KIT = process.env.CM_KIT || join(ROOT, '..', 'cm-universe', 'assets');
const DOCS = join(ROOT, 'docs');

/*
 * Kit path -> path under docs/. The launcher icons are the kit's dark palette, opaque on
 * the manifest's own #02090e, because iOS paints transparency black. The PNG favicons are
 * its light palette and stay transparent: Safari ignores the SVG icon, and the default
 * browser chrome is light.
 */
const FILES = {
  'favicon/reference/favicon-16.png': 'assets/favicon-16.png',
  'favicon/reference/favicon-32.png': 'assets/favicon-32.png',
  'app/reference_dark/apple-touch-icon.png': 'assets/apple-touch-icon.png',
  'app/reference_dark/android-chrome-192.png': 'assets/icon-192.png',
  'app/reference_dark/android-chrome-512.png': 'assets/icon-512.png',
  'app/reference_dark/maskable-512.png': 'assets/maskable-512.png'
};

/* The About detail plates, one pair per theme. The kit ships 800x500 and 1600x1000; the
   page asks for them by width, as it does for every other responsive image here. */
for (const [palette, theme] of [['reference', 'light'], ['reference_dark', 'dark']]) {
  for (const name of ['canopy', 'falls', 'cooling']) {
    FILES[`hero/cm-detail-${name}-${palette}.webp`] = `assets/brand/${name}-${theme}-800.webp`;
    FILES[`hero/cm-detail-${name}-${palette}@2x.webp`] = `assets/brand/${name}-${theme}-1600.webp`;
  }
}

/* The sizes build-brand.mjs used to write for the plates. Left behind they would still be
   served, and nothing would say which of the two sets a page meant. */
const STALE = ['canopy', 'falls', 'cooling'].flatMap(
  (name) => ['light', 'dark'].flatMap(
    (theme) => [480, 960].map((w) => `assets/brand/${name}-${theme}-${w}.webp`)));

const dryRun = process.argv.includes('--dry-run') || process.argv.includes('-n');

const missing = Object.keys(FILES).filter((src) => !existsSync(join(KIT, src)));
if (missing.length) {
  console.error(`error: the kit at ${KIT} is missing:\n  ${missing.join('\n  ')}`);
  console.error('compose it first: node source/pipeline/cm5_compose/compose.mjs');
  process.exit(1);
}

/*
 * The SVG favicon holds both palettes and lets the browser's own colour scheme pick, which
 * is the right signal for a tab strip (the site's own toggle is not). 64px is what the
 * kit ships for it.
 */
function iconSvg() {
  const png = (palette) => readFileSync(join(KIT, `favicon/${palette}/favicon-64.png`)).toString('base64');
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">',
    '<style>.d{display:none}@media (prefers-color-scheme:dark){.l{display:none}.d{display:inline}}</style>',
    `<image class="l" width="64" height="64" href="data:image/png;base64,${png('reference')}"/>`,
    `<image class="d" width="64" height="64" href="data:image/png;base64,${png('reference_dark')}"/>`,
    '</svg>',
    ''
  ].join('\n');
}

const write = (rel, bytes) => {
  const target = join(DOCS, rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes);
};

let copied = 0;
for (const [src, rel] of Object.entries(FILES)) {
  const bytes = readFileSync(join(KIT, src));
  if (dryRun) {
    console.log(`would copy: ${src}  ->  docs/${rel}  (${bytes.length} bytes)`);
  } else {
    write(rel, bytes);
    console.log(`copied: docs/${rel}  (${bytes.length} bytes)`);
  }
  copied++;
}

const svg = iconSvg();
if (dryRun) {
  console.log(`would write: docs/assets/cm-icon.svg  (${svg.length} bytes)`);
} else {
  write('assets/cm-icon.svg', svg);
  console.log(`wrote: docs/assets/cm-icon.svg  (${svg.length} bytes)`);
}

for (const rel of STALE) {
  const target = join(DOCS, rel);
  if (!existsSync(target)) continue;
  if (dryRun) {
    console.log(`would remove: docs/${rel}  (superseded)`);
  } else {
    unlinkSync(target);
    console.log(`removed: docs/${rel}  (superseded)`);
  }
}

console.log(`${dryRun ? 'would sync' : 'synced'} ${copied} files from ${KIT}`);
console.log('next: node scripts/build-ico.mjs');
