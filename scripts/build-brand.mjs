/*
 * Builds the brand rasters in docs/assets/ from the Blender renders in the
 * cm-universe kit (renders4, "Bonsai").
 *
 *   node scripts/build-brand.mjs
 *   CM_RENDERS=/path/to/renders4 node scripts/build-brand.mjs
 *
 * Then run `node scripts/build-ico.mjs`, which packs the new 16 and 32px PNGs.
 *
 * Zero dependencies, like everything else here: the resizing and encoding is done
 * by headless Chrome (createImageBitmap for the resample, OffscreenCanvas for the
 * WebP and PNG encode). The renders are served to it from a localhost server on
 * the same origin as the build page, so the canvas is never tainted and no
 * multi-megabyte data URL has to cross the DevTools socket; the page PUTs each
 * finished file back to the same server, which writes it into docs/assets/.
 *
 * Only the transparent cutouts and the legend board are used. The kit's
 * wall-backed hero, icon and "simple" renders carry a grey ground that shows as
 * a rectangle against the site's own background, and its legend_* and mark_full_*
 * files are close-up intermediates rather than finished art.
 */

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, sleep } from './chrome.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const RENDERS = process.env.CM_RENDERS || join(ROOT, '..', 'cm-universe', 'renders4');
const OUT = join(ROOT, 'docs', 'assets');
const HTTP_PORT = 9345;
const CDP_PORT = 9334;

const SOURCES = [
  'mark_reference.png', 'mark_reference_dark.png',
  'board_reference.png', 'board_reference_dark.png'
];
for (const s of SOURCES) {
  if (!existsSync(join(RENDERS, s))) {
    console.error(`error: ${join(RENDERS, s)} is missing (point CM_RENDERS at the renders folder)`);
    process.exit(1);
  }
}

/*
 * Everything below runs inside Chrome, not Node. It is written as a real function
 * so it is syntax-checked with the rest of the file, then shipped to the page as
 * source text.
 */
function page() {
  const INK = '#02090e';
  const PAPER = '#fbfcfa';

  async function bitmap(name) {
    const blob = await (await fetch('/src/' + name)).blob();
    return createImageBitmap(blob);
  }

  function surface(w, h) {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    return [c, ctx];
  }

  /*
   * The box holding every pixel more than `threshold` opaque. Not > 0: the
   * lightning and mist trail off into near-invisible wisps that would widen the
   * box without adding anything a reader can see. A 1% margin keeps the glow from
   * being cut flush.
   */
  function alphaBox(bmp, threshold) {
    const [, ctx] = surface(bmp.width, bmp.height);
    ctx.drawImage(bmp, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, bmp.width, bmp.height);
    const corners = [0, width - 1, (height - 1) * width, height * width - 1]
      .map((i) => data[i * 4 + 3]);
    if (corners.some((a) => a !== 0)) {
      throw new Error(`expected a transparent cutout; corner alpha is ${corners.join(',')}`);
    }
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        if (data[(row + x) * 4 + 3] > threshold) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.01);
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
    x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  /*
   * Draws `box` of the source into a W x H canvas, scaled to fit inside fitW x fitH
   * and centred. The resample is createImageBitmap's high-quality filter in one
   * step, which holds the fine circuit traces better than repeated halving.
   */
  async function place(bmp, box, W, H, fitW, fitH, { bg, filter } = {}) {
    const s = Math.min(fitW / box.w, fitH / box.h);
    const w = Math.max(1, Math.round(box.w * s));
    const h = Math.max(1, Math.round(box.h * s));
    const [c, ctx] = surface(W, H);
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H); }
    if (filter) ctx.filter = filter;
    const scaled = await createImageBitmap(bmp, box.x, box.y, box.w, box.h,
      { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
    ctx.drawImage(scaled, Math.round((W - w) / 2), Math.round((H - h) / 2));
    return c;
  }

  async function encode(c, type, quality) {
    const blob = await c.convertToBlob({ type, quality });
    /* Chrome quietly falls back to PNG for a type it cannot encode. */
    if (blob.type !== type) throw new Error(`asked for ${type}, got ${blob.type}`);
    return blob;
  }

  async function put(path, body) {
    const r = await fetch('/out/' + path, { method: 'PUT', body });
    if (!r.ok) throw new Error(`${path}: upload failed (${r.status})`);
  }

  async function base64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }

  return async function run() {
    const written = [];
    const save = async (path, c, type, quality) => {
      const blob = await encode(c, type, quality);
      await put(path, blob);
      written.push({ path, width: c.width, height: c.height, bytes: blob.size });
    };

    const marks = {};
    for (const [theme, file] of [['light', 'mark_reference.png'], ['dark', 'mark_reference_dark.png']]) {
      const bmp = await bitmap(file);
      marks[theme] = { bmp, box: alphaBox(bmp, 8) };
    }

    for (const theme of ['light', 'dark']) {
      const { bmp, box } = marks[theme];

      /* Header mark: 2.25rem (36px) tall at 1x, 2x and 3x. */
      for (const k of [1, 2, 3]) {
        const h = 36 * k;
        const w = Math.round(h * box.w / box.h);
        await save(`brand/mark-${theme}@${k}x.webp`, await place(bmp, box, w, h, w, h), 'image/webp', 0.9);
      }

      /* Home hero. Never upscaled past the trimmed source. */
      for (const nominal of [640, 1024, 1440]) {
        const w = Math.min(nominal, box.w);
        const h = Math.round(w * box.h / box.w);
        await save(`brand/hero-${theme}-${nominal}.webp`, await place(bmp, box, w, h, w, h), 'image/webp', 0.86);
      }
    }

    /* About board: a framed wall render, used whole. */
    for (const [theme, file] of [['light', 'board_reference.png'], ['dark', 'board_reference_dark.png']]) {
      const bmp = await bitmap(file);
      const box = { x: 0, y: 0, w: bmp.width, h: bmp.height };
      for (const w of [960, 1600, 2400]) {
        const h = Math.round(w * box.h / box.w);
        await save(`brand/board-${theme}-${w}.webp`, await place(bmp, box, w, h, w, h), 'image/webp', 0.82);
      }
    }

    const light = marks.light;
    const dark = marks.dark;
    /* A touch of contrast, because at 16px the canopy and the M's traces are a
       handful of pixels and read as mud without it. */
    const small = 'contrast(1.12) saturate(1.15)';

    /* The PNG favicons are what Safari uses, and Safari ignores the SVG's media
       query, so they carry the light mark: the default browser chrome is light. */
    for (const n of [16, 32]) {
      await save(`favicon-${n}.png`, await place(light.bmp, light.box, n, n, n, n, { filter: small }), 'image/png');
    }

    /* The SVG favicon holds both marks and lets the browser's own colour scheme
       pick, which is the right signal for a tab strip (the site toggle is not). */
    const favicon = async (m) => base64(await encode(
      await place(m.bmp, m.box, 64, 64, 64, 64, { filter: small }), 'image/png'));
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">',
      '<style>.d{display:none}@media (prefers-color-scheme:dark){.l{display:none}.d{display:inline}}</style>',
      `<image class="l" width="64" height="64" href="data:image/png;base64,${await favicon(light)}"/>`,
      `<image class="d" width="64" height="64" href="data:image/png;base64,${await favicon(dark)}"/>`,
      '</svg>',
      ''
    ].join('\n');
    await put('cm-icon.svg', svg);
    written.push({ path: 'cm-icon.svg', width: 64, height: 64, bytes: svg.length });

    /* Launcher icons are opaque (iOS paints transparency black) and use the glowing
       dark mark on the manifest's own background colour, so no seam shows where
       the platform pads or masks the tile. */
    for (const [path, n] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
      const inner = Math.round(n * 0.76);
      await save(path, await place(dark.bmp, dark.box, n, n, inner, inner, { bg: INK }), 'image/png');
    }
    /* Maskable: the whole mark inside the 80% safe-zone circle, so its diagonal,
       not its width, is what has to fit. */
    const diag = 512 * 0.78 / Math.hypot(dark.box.w, dark.box.h);
    await save('maskable-512.png',
      await place(dark.bmp, dark.box, 512, 512, dark.box.w * diag, dark.box.h * diag, { bg: INK }), 'image/png');

    /* Contact sheet for review; gitignored. Rows: light mark on paper, dark mark
       on ink, and the light PNG favicons on ink (Safari in a dark tab strip). */
    const [sheet, ctx] = surface(520, 330);
    const rows = [[PAPER, light], [INK, dark], [INK, light]];
    for (let r = 0; r < rows.length; r++) {
      const [bg, m] = rows[r];
      const top = r * 110;
      ctx.fillStyle = bg;
      ctx.fillRect(0, top, 520, 110);
      let x = 16;
      for (const n of [16, 32, 64]) {
        ctx.drawImage(await place(m.bmp, m.box, n, n, n, n, { filter: small }), x, top + (110 - n) / 2);
        x += n + 24;
      }
      for (const h of [36, 72]) {
        const w = Math.round(h * m.box.w / m.box.h);
        ctx.drawImage(await place(m.bmp, m.box, w, h, w, h), x, top + (110 - h) / 2);
        x += w + 24;
      }
    }
    await put('brand/contact-sheet.png', await encode(sheet, 'image/png'));

    return {
      written,
      trimmed: { light: light.box, dark: dark.box }
    };
  };
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>brand build</title>
<script>window.run = (${page.toString()})();</script>`;

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
    return;
  }
  if (req.method === 'GET' && url.pathname.startsWith('/src/')) {
    const name = decodeURIComponent(url.pathname.slice(5));
    if (!SOURCES.includes(name)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(readFileSync(join(RENDERS, name)));
    return;
  }
  if (req.method === 'PUT' && url.pathname.startsWith('/out/')) {
    const rel = normalize(decodeURIComponent(url.pathname.slice(5)));
    if (rel.startsWith('..') || !/^[\w@./-]+$/.test(rel)) { res.writeHead(400); res.end(); return; }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const target = join(OUT, rel);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, Buffer.concat(chunks));
      res.writeHead(204);
      res.end();
    });
    return;
  }
  res.writeHead(404);
  res.end();
});
await new Promise((resolve) => server.listen(HTTP_PORT, '127.0.0.1', resolve));

let browser;
try {
  browser = await launchChrome({ port: CDP_PORT, width: 800, height: 600 });
  await browser.send('Page.navigate', { url: `http://127.0.0.1:${HTTP_PORT}/` });
  let ready = false;
  for (let attempt = 0; attempt < 40 && !ready; attempt++) {
    await sleep(100);
    ready = await browser.evaluate('typeof window.run === "function"').catch(() => false);
  }
  if (!ready) throw new Error('the build page never loaded');

  const result = await browser.evaluate('window.run()');
  for (const f of result.written) {
    console.log(`wrote: docs/assets/${f.path}  (${f.width}x${f.height}, ${f.bytes} bytes)`);
  }
  for (const [theme, b] of Object.entries(result.trimmed)) {
    console.log(`trimmed ${theme}: ${b.w}x${b.h}  ratio ${(b.w / b.h).toFixed(4)}`);
  }
  console.log('wrote: docs/assets/brand/contact-sheet.png  (review only; gitignored)');
  console.log('next: node scripts/build-ico.mjs');
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
} finally {
  if (browser) browser.close();
  server.close();
}
process.exit(process.exitCode || 0);
