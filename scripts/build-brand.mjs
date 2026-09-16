/*
 * Builds the brand rasters in docs/assets/ from the Blender renders in the
 * cm-universe kit (the v5 component rebuild): the header mark, the home hero and
 * the About board.
 *
 *   node scripts/build-brand.mjs
 *   CM_RENDERS=/path/to/renders5/assembly CM_KIT_RENDERS=/path/to/renders5/kit node scripts/build-brand.mjs
 *
 * Two folders, because the art comes from two of the kit's render modes. The mark
 * and the hero use the kit's frontal `front_*` cutouts: the letters stand upright
 * and fill the frame, where the 3/4 view spreads them across a receding ground.
 * The About board is a wall-backed photograph and only `assembly` has one.
 *
 * The icons and the About detail plates are NOT built here. The kit composes its
 * own, from art drawn for those jobs, and `node scripts/sync-kit.mjs` copies them
 * in; this file and that one never write the same path.
 *
 * Zero dependencies, like everything else here: the resizing and encoding is done
 * by headless Chrome (createImageBitmap for the resample, OffscreenCanvas for the
 * WebP and PNG encode). The renders are served to it from a localhost server on
 * the same origin as the build page, so the canvas is never tainted and no
 * multi-megabyte data URL has to cross the DevTools socket; the page PUTs each
 * finished file back to the same server, which writes it into docs/assets/.
 *
 * Two kinds of render are used. The site_* cutouts are transparent and rendered
 * for the home hero slot, and they also yield the header mark and the icons. The
 * board_* and the canopy/falls/cooling details are wall-backed photographs,
 * shown whole in framed plates on About. The kit's hero, front, portrait, og and
 * icon renders carry a grey ground that shows as a rectangle against the site's
 * own background; the _page, _480 and site_mock files are the kit's previews of
 * this site, not art for it.
 */

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, sleep } from './chrome.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const RENDERS = process.env.CM_RENDERS || join(ROOT, '..', 'cm-universe', 'renders5', 'assembly');
const KIT = process.env.CM_KIT_RENDERS || join(ROOT, '..', 'cm-universe', 'renders5', 'kit');
const OUT = join(ROOT, 'docs', 'assets');
const HTTP_PORT = 9345;
const CDP_PORT = 9334;

/* Render name -> the folder it lives in, so /src/ can serve both. */
const SOURCES = {};
for (const theme of ['light', 'dark']) {
  SOURCES[`front_${theme}.png`] = KIT;
  SOURCES[`board_${theme}.png`] = RENDERS;
}
for (const [name, folder] of Object.entries(SOURCES)) {
  if (!existsSync(join(folder, name))) {
    console.error(`error: ${join(folder, name)} is missing (point CM_RENDERS / CM_KIT_RENDERS at the renders folders)`);
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
   * The box holding every pixel more than `threshold` opaque. The site cutouts
   * carry their bloom, contact shadows and the faint outer contours of the survey
   * ground in the alpha channel, right out to the frame's edge, so only a high
   * threshold isolates the letters: the box is the monogram, not the frame. A 1%
   * margin keeps the edge from being cut flush.
   */
  function alphaBox(bmp, threshold) {
    const [, ctx] = surface(bmp.width, bmp.height);
    ctx.drawImage(bmp, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, bmp.width, bmp.height);
    let clear = 0;
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        const a = data[(row + x) * 4 + 3];
        if (a === 0) clear++;
        if (a > threshold) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    /* A wall-backed render passed by mistake has no clear pixels at all. */
    if (clear < width * height / 4) {
      throw new Error(`expected a transparent cutout; only ${Math.round(100 * clear / (width * height))}% of it is clear`);
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

  return async function run() {
    const written = [];
    const save = async (path, c, type, quality) => {
      const blob = await encode(c, type, quality);
      await put(path, blob);
      written.push({ path, width: c.width, height: c.height, bytes: blob.size });
    };

    const marks = {};
    for (const theme of ['light', 'dark']) {
      const bmp = await bitmap(`front_${theme}.png`);
      marks[theme] = { bmp, box: alphaBox(bmp, 250) };
    }

    for (const theme of ['light', 'dark']) {
      const { bmp, box } = marks[theme];

      /* Header mark: 2.25rem (36px) tall at 1x, 2x and 3x. */
      for (const k of [1, 2, 3]) {
        const h = 36 * k;
        const w = Math.round(h * box.w / box.h);
        await save(`brand/mark-${theme}@${k}x.webp`, await place(bmp, box, w, h, w, h), 'image/webp', 0.9);
      }

      /* Home hero: the whole frame, untrimmed. The kit renders it at the hero
         slot's own proportions with its margin, contact shadows and bloom already
         placed, so trimming would crop the halo the frame was sized to hold.
         Never upscaled past the source. */
      const frame = { x: 0, y: 0, w: bmp.width, h: bmp.height };
      for (const nominal of [640, 1024, 1440]) {
        const w = Math.min(nominal, frame.w);
        const h = Math.round(w * frame.h / frame.w);
        await save(`brand/hero-${theme}-${nominal}.webp`, await place(bmp, frame, w, h, w, h), 'image/webp', 0.86);
      }
    }

    /* The board that opens About: a wall-backed photograph, used whole (3:1). The
       detail plates below it come from the kit, through sync-kit.mjs. */
    const photos = [['board', [960, 1600, 2400]]];
    for (const [name, widths] of photos) {
      for (const theme of ['light', 'dark']) {
        const bmp = await bitmap(`${name}_${theme}.png`);
        const box = { x: 0, y: 0, w: bmp.width, h: bmp.height };
        for (const w of widths) {
          const h = Math.round(w * box.h / box.w);
          await save(`brand/${name}-${theme}-${w}.webp`, await place(bmp, box, w, h, w, h), 'image/webp', 0.82);
        }
      }
    }

    const light = marks.light;
    const dark = marks.dark;
    /* A touch of contrast, because at 16px the canopy and the M's traces are a
       handful of pixels and read as mud without it. */
    const small = 'contrast(1.12) saturate(1.15)';

    /* The favicons, the SVG icon and the launcher icons used to be trimmed from these
       same cutouts. They now come from the kit's simplified icon mark instead, which
       is drawn to survive 16px, and sync-kit.mjs copies them in. */

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
    if (!Object.hasOwn(SOURCES, name)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(readFileSync(join(SOURCES[name], name)));
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
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
} finally {
  if (browser) browser.close();
  server.close();
}
process.exit(process.exitCode || 0);
