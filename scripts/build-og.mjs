/*
 * Renders the Open Graph share cards in docs/assets/ from scripts/og-card.html.
 *
 *   node scripts/build-og.mjs            render every card
 *   node scripts/build-og.mjs loan       render only cards whose name matches
 *   node scripts/build-og.mjs --dry-run  report what would be written
 *
 * The cards are committed, because the site has no build step and GitHub Pages
 * serves what is in the repository. This exists so they can be reproduced and
 * restyled rather than being six binaries nobody can regenerate. Nothing about
 * serving or testing the site depends on running it.
 *
 * Zero dependencies, like everything else here. It starts one Chrome and drives
 * it over the DevTools protocol using Node's built-in WebSocket.
 *
 * WHY NOT `chrome --headless --screenshot`, which is one line per card: headless
 * Chrome does not reliably exit after writing a screenshot, so a shell loop over
 * six cards renders the first and then hangs forever on the second. One browser
 * driven over CDP renders all six and is told when to stop.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync, accessSync, constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const TEMPLATE = join(HERE, 'og-card.html');
const OUT = join(ROOT, 'docs', 'assets');
const WIDTH = 1200;
const HEIGHT = 630;
const PORT = 9333;

/*
 * Every subtitle says what the page is for rather than repeating its title, and
 * none of them counts anything: a card reading "three calculators" is a card
 * that has to be regenerated the day a fourth ships. `\n` is the line break.
 */
const CARDS = [
  { name: 'og', eyebrow: 'Survey in progress', title: 'Curiosity Mapped',
    subtitle: 'Follow the curiosity. Map what you find.\nSee where it leads.' },
  { name: 'og-tools', eyebrow: 'Tools', title: 'Tools',
    subtitle: 'Calculators that show their working,\nnot only their answers.' },
  { name: 'og-privacy', eyebrow: 'Privacy', title: 'Privacy Policy',
    subtitle: 'What is collected, what is not,\nand the choices you have.' },
  { name: 'og-mortgage-calculator', eyebrow: 'Calculator', title: 'Mortgage Calculator',
    subtitle: 'The payment, the formula that produced it,\nand the costs kept separate from it.' },
  { name: 'og-compound-interest-calculator', eyebrow: 'Calculator', title: 'Compound Interest Calculator',
    subtitle: 'What a balance grows to when interest\nstarts earning interest of its own.' },
  { name: 'og-loan-calculator', eyebrow: 'Calculator', title: 'Loan Calculator',
    subtitle: 'The payment, where each one goes,\nand what it does not cover.' }
];

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || args.includes('-n');
const filter = args.find((a) => !a.startsWith('-')) || '';
const wanted = CARDS.filter((c) => !filter || c.name.includes(filter));

if (!wanted.length) {
  console.error(`no card matched ${filter}`);
  process.exit(1);
}

if (dryRun) {
  for (const c of wanted) console.log(`would render: docs/assets/${c.name}.png  (${c.title})`);
  process.exit(0);
}

function findChrome() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser'
  ];
  for (const c of candidates) {
    try { accessSync(c, constants.X_OK); return c; } catch { /* keep looking */ }
  }
  return null;
}

const chromePath = findChrome();
if (!chromePath) {
  console.error('error: no Chrome or Chromium found; cannot rasterise.');
  console.error('       The committed cards in docs/assets/ are unaffected.');
  process.exit(1);
}
if (!existsSync(TEMPLATE)) {
  console.error(`error: ${TEMPLATE} is missing`);
  process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), 'cm-og-'));
const chrome = spawn(chromePath, [
  '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check', '--force-device-scale-factor=1',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, 'about:blank'
], { stdio: 'ignore' });

let ws = null;
const shutdown = () => {
  try { ws && ws.close(); } catch { /* already gone */ }
  try { chrome.kill('SIGTERM'); } catch { /* already gone */ }
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* nothing to clean */ }
};
process.on('exit', shutdown);
process.on('SIGINT', () => { shutdown(); process.exit(130); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Chrome takes a moment to open the port. Poll rather than guess at a delay. */
async function target() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch { /* not listening yet */ }
    await sleep(250);
  }
  throw new Error('Chrome did not open its debugging port');
}

const page = await target();
ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve);
  ws.addEventListener('error', reject);
});

let nextId = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++nextId;
  pending.set(id, resolve);
  ws.send(JSON.stringify({ id, method, params }));
});

await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride',
  { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });

for (const card of wanted) {
  const query = new URLSearchParams({
    eyebrow: card.eyebrow,
    title: card.title,
    subtitle: card.subtitle.split('\n').join('|')
  });
  await send('Page.navigate', { url: `${pathToFileURL(TEMPLATE).href}?${query}` });

  /* The template sets data-ready once it has laid the title out; waiting for it
     beats waiting for a duration that is right on this machine and wrong on the
     next one. */
  let ready = false;
  for (let attempt = 0; attempt < 40 && !ready; attempt++) {
    await sleep(100);
    const r = await send('Runtime.evaluate',
      { expression: 'document.documentElement.dataset.ready === "1"', returnByValue: true });
    ready = r.result && r.result.result && r.result.result.value === true;
  }
  if (!ready) throw new Error(`${card.name}: the template never finished laying out`);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const bytes = Buffer.from(shot.result.data, 'base64');
  const target = join(OUT, `${card.name}.png`);
  writeFileSync(target, bytes);
  console.log(`rendered: docs/assets/${card.name}.png  (${bytes.length} bytes)`);
}

shutdown();
process.exit(0);
