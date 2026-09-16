/*
 * Renders the Open Graph share cards in docs/assets/ from scripts/og-card.html.
 *
 *   node scripts/build-og.mjs            render every card
 *   node scripts/build-og.mjs loan       render only cards whose name matches
 *   node scripts/build-og.mjs --dry-run  report what would be written
 *
 * The cards are committed, because the site has no build step and GitHub Pages
 * serves what is in the repository. This exists so they can be reproduced and
 * restyled rather than being seven binaries nobody can regenerate. Nothing about
 * serving or testing the site depends on running it.
 *
 * The art is the kit's transparent hero_dark render, read from CM_RENDERS (default
 * ../cm-universe/renders5/kit), and the card is laid out to match the kit's own
 * social card (cm-universe/source/pipeline/cm5_compose/kit.html), so a link
 * preview and the kit's og-image are the same picture. Cards are JPEG: over a
 * photographic render a PNG runs to a megabyte or more, and some link scrapers
 * drop previews that large.
 *
 * Zero dependencies; the browser plumbing lives in scripts/chrome.mjs.
 */

import { existsSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchChrome, sleep } from './chrome.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const TEMPLATE = join(HERE, 'og-card.html');
const RENDERS = process.env.CM_RENDERS || join(ROOT, '..', 'cm-universe', 'renders5', 'kit');
const ART = join(RENDERS, 'front_dark.png');
const OUT = join(ROOT, 'docs', 'assets');
const WIDTH = 1200;
const HEIGHT = 630;
const PORT = 9333;
const QUALITY = 85;

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
  { name: 'og-about', eyebrow: 'About', title: 'About',
    subtitle: 'Useful first.\nDeeper if you want it.' },
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
  for (const c of wanted) console.log(`would render: docs/assets/${c.name}.jpg  (${c.title})`);
  process.exit(0);
}

for (const file of [TEMPLATE, ART]) {
  if (!existsSync(file)) {
    console.error(`error: ${file} is missing`);
    process.exit(1);
  }
}

let browser;
try {
  browser = await launchChrome({ port: PORT, width: WIDTH, height: HEIGHT });

  for (const card of wanted) {
    const query = new URLSearchParams({
      eyebrow: card.eyebrow,
      title: card.title,
      subtitle: card.subtitle.split('\n').join('|'),
      art: pathToFileURL(ART).href
    });
    await browser.send('Page.navigate', { url: `${pathToFileURL(TEMPLATE).href}?${query}` });

    /* The template sets data-ready once the art has decoded and the title is
       laid out; waiting for it beats waiting for a duration that is right on this
       machine and wrong on the next one. */
    let ready = false;
    for (let attempt = 0; attempt < 60 && !ready; attempt++) {
      await sleep(100);
      ready = await browser.evaluate('document.documentElement.dataset.ready === "1"').catch(() => false);
    }
    if (!ready) throw new Error(`${card.name}: the template never finished laying out`);

    const shot = await browser.send('Page.captureScreenshot', { format: 'jpeg', quality: QUALITY });
    const bytes = Buffer.from(shot.result.data, 'base64');
    writeFileSync(join(OUT, `${card.name}.jpg`), bytes);

    /* The PNG cards this replaces; left behind they would still be served. */
    const stale = join(OUT, `${card.name}.png`);
    if (existsSync(stale)) unlinkSync(stale);

    console.log(`rendered: docs/assets/${card.name}.jpg  (${bytes.length} bytes)`);
  }
} catch (err) {
  console.error(`error: ${err.message}`);
  process.exitCode = 1;
} finally {
  if (browser) browser.close();
}
process.exit(process.exitCode || 0);
