/*
 * node --test tests/
 *
 * Two halves. The first exercises the stored-choice logic the way
 * mortgage.test.mjs exercises the maths -- by loading the shipped file. The
 * second reads the published HTML, because with no build step the generated
 * pages are the artefact, and the properties that matter most here are
 * properties of those pages: that the consent defaults are queued before
 * gtag.js is fetched, that the block appears exactly once, and that nothing in
 * the calculator has grown a route to the network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const C = require('../docs/js/consent.js');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const PAGES = [
  'docs/index.html',
  'docs/404.html',
  'docs/privacy.html',
  'docs/tools/index.html',
  'docs/tools/mortgage-calculator.html',
  'docs/tools/compound-interest-calculator.html'
];

/* ------------------------------------------------------- stored choice */

const now = 1757337600000;

test('a written choice reads back', () => {
  assert.equal(C.parse(C.serialize('granted', now), now), 'granted');
  assert.equal(C.parse(C.serialize('denied', now), now), 'denied');
});

test('the stored value carries no identifier', () => {
  assert.deepEqual(
    Object.keys(JSON.parse(C.serialize('granted', now))).sort(),
    ['analytics', 'ts', 'v']
  );
});

test('a choice survives up to twelve months and then lapses', () => {
  const old = C.serialize('granted', now - C.MAX_AGE);
  assert.equal(C.parse(old, now), 'granted');
  assert.equal(C.parse(C.serialize('granted', now - C.MAX_AGE - 1), now), null);
});

test('reading fails closed', () => {
  for (const raw of [
    null,
    undefined,
    '',
    '{',
    '[]',
    'null',
    '"granted"',
    JSON.stringify({ v: 0, analytics: 'granted', ts: now }),
    JSON.stringify({ v: C.VERSION, analytics: 'yes', ts: now }),
    JSON.stringify({ v: C.VERSION, analytics: 'granted' }),
    JSON.stringify({ v: C.VERSION, analytics: 'granted', ts: String(now) }),
    JSON.stringify({ analytics: 'granted', ts: now })
  ]) {
    assert.equal(C.parse(raw, now), null, `expected null for ${JSON.stringify(raw)}`);
  }
});

/* --------------------------------------------------- the published pages */

test('every page queues the consent defaults before gtag.js is fetched', () => {
  for (const page of PAGES) {
    const html = read(page);
    const dflt = html.indexOf("gtag('consent', 'default'");
    const loader = html.indexOf('googletagmanager.com/gtag/js');
    assert.notEqual(dflt, -1, `${page}: no consent default`);
    assert.notEqual(loader, -1, `${page}: no gtag loader`);
    assert.ok(dflt < loader,
      `${page}: consent default at ${dflt} must precede the loader at ${loader}`);
  }
});

test('every page carries exactly one Google tag block', () => {
  for (const page of PAGES) {
    const html = read(page);
    assert.equal(html.split('<!-- Google tag (gtag.js) -->').length - 1, 1, page);
    assert.equal(html.split('<!-- End Google tag -->').length - 1, 1, page);
    assert.equal(html.split('googletagmanager.com/gtag/js').length - 1, 1, page);
  }
});

test('both default calls declare all four consent mode v2 signals', () => {
  for (const page of PAGES) {
    const defaults = read(page).match(/gtag\('consent', 'default', \{[^}]*\}/g) || [];
    assert.equal(defaults.length, 2,
      `${page}: expected a regional default and a fallback, got ${defaults.length}`);
    for (const call of defaults) {
      for (const signal of
           ['ad_storage', 'ad_user_data', 'ad_personalization', 'analytics_storage']) {
        assert.match(call, new RegExp(signal + ": '(granted|denied)'"),
          `${page}: ${signal} missing from a default call`);
      }
    }
    /* The regional call is the one that has to come first: a later default
       without a region would otherwise be the more specific match. */
    assert.match(defaults[0], /region:/, `${page}: regional default must come first`);
    assert.ok(!/region:/.test(defaults[1]), `${page}: the fallback must carry no region`);
  }
});

test('the denied region covers the EEA, the UK, and Switzerland', () => {
  const expected = [
    'AT', 'BE', 'BG', 'CH', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR',
    'GB', 'GR', 'HR', 'HU', 'IE', 'IS', 'IT', 'LI', 'LT', 'LU', 'LV', 'MT',
    'NL', 'NO', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'
  ];
  for (const page of PAGES) {
    const block = /region:\s*\[([^\]]*)\]/.exec(read(page));
    assert.ok(block, `${page}: no region list`);
    const codes = block[1].match(/[A-Z]{2}/g);
    assert.deepEqual(codes.slice().sort(), expected, page);
  }
});

test('page_location is sanitised on every page', () => {
  for (const page of PAGES) {
    assert.match(read(page), /page_location:\s*cmConsent\.url\(location\.href\)/, page);
  }
});

test('every page loads the consent interface and offers the control', () => {
  for (const page of PAGES) {
    const html = read(page);
    assert.match(html, /<script src="\/js\/consent\.js" defer><\/script>/, page);
    assert.match(html, /id="consent-manage"/, page);
    assert.match(html, /id="consent-status"/, page);
    /* The 404 page measures a visit like any other, so it needs the route to
       the policy that says so; it was the one page without a legal nav. */
    assert.match(html, /href="\/privacy\.html"/, page);
  }
});

test('the inline block and consent.js agree on the stored format', () => {
  const script = read('scripts/apply-gtag.sh');
  assert.match(script, new RegExp(`var KEY = '${C.KEY}';`));
  assert.match(script, new RegExp(`var VERSION = ${C.VERSION};`));
  assert.match(script, new RegExp(`var MAX_AGE = ${C.MAX_AGE};`));
  for (const page of PAGES) {
    const html = read(page);
    assert.ok(html.includes(`var KEY = '${C.KEY}';`), page);
    assert.ok(html.includes(`var VERSION = ${C.VERSION};`), page);
    assert.ok(html.includes(`var MAX_AGE = ${C.MAX_AGE};`), page);
  }
});

/* --------------------------------------------- browser-tool privacy invariant */

/*
 * Analytics consent governs whether the visit is measured. It does not govern
 * what a tool does with what you type, because nothing typed into a tool is
 * ever supposed to leave the browser -- in any consent state. That has been
 * true by accident of implementation; this is what makes it true on purpose.
 */
/* Comments are stripped first: this file explains at length why it does not do
   these things, and naming a thing is not doing it. */
const code = (path) =>
  read(path).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const FORBIDDEN = [
  'gtag', 'dataLayer', 'fetch(', 'XMLHttpRequest', 'sendBeacon', 'new Image',
  'document.cookie', 'document.title', 'localStorage', 'sessionStorage',
  'location', 'pushState', 'replaceState', 'URLSearchParams', 'innerHTML'
];

test('no calculator has a route to analytics or to the network', () => {
  /* Every tool that takes a number from a reader, not just the first one. */
  for (const path of ['docs/js/mortgage.js', 'docs/js/compound.js']) {
    const js = code(path);
    for (const forbidden of FORBIDDEN) {
      assert.ok(!js.includes(forbidden), `${path} must not reference ${forbidden}`);
    }
  }
});

test('no calculator form can put its fields into the URL', () => {
  /* The form count is asserted per page rather than in general: a page growing a
     form nobody wrote a rule for is exactly the regression this catches. */
  for (const [page, script, expected] of [
    ['docs/tools/mortgage-calculator.html', 'docs/js/mortgage.js', 2],
    ['docs/tools/compound-interest-calculator.html', 'docs/js/compound.js', 1]
  ]) {
    const html = read(page);
    const forms = html.match(/<form[^>]*>/g) || [];
    assert.equal(forms.length, expected, `${page}: expected exactly the known forms`);
    for (const form of forms) {
      assert.ok(!/\saction=/.test(form), `${page}: form must have no action: ${form}`);
      assert.ok(!/\smethod=/.test(form), `${page}: form must have no method: ${form}`);
    }
    assert.ok(!/type="submit"/.test(html), `${page}: no submit button may exist`);
    /* Belt to that braces: implicit submission is suppressed outright. */
    assert.match(read(script), /addEventListener\('submit', blockSubmit\)/, script);
  }
});

/* ------------------------------------------------- the pages as artefacts */

/*
 * With no build step the published HTML is the artefact, and two things about a
 * tool page can rot silently: an element the script reaches for can be renamed,
 * and the static figures the page ships for readers without JavaScript can drift
 * away from what the code actually produces. Neither shows up in a unit test of
 * the maths, and neither is visible on the page with JavaScript switched on.
 */

test('every element the compound calculator reaches for exists in its page', () => {
  const js = read('docs/js/compound.js');
  const html = read('docs/tools/compound-interest-calculator.html');
  const wanted = [...js.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);
  assert.ok(wanted.length > 40, `expected a full ui map, found ${wanted.length}`);
  for (const id of new Set(wanted)) {
    assert.ok(html.includes(`id="${id}"`),
      `compound.js looks up #${id}, which the page does not contain`);
  }
});

test('the compound page ships the figures its own code produces', () => {
  /*
   * The default scenario is written into the markup so the page is complete and
   * correct without JavaScript. This asserts the markup is what the shipped
   * functions actually return, rather than what someone typed while looking at
   * them.
   */
  const C = require('../docs/js/compound.js');
  const html = read('docs/tools/compound-interest-calculator.html');
  const m = C.buildModel({
    principal: 1000, ratePct: 5, frequencyKey: '12', years: 10,
    unit: 'years', inflationPct: null
  });

  for (const value of [
    C.money(m.amount),                    /* $1,647.01 */
    C.money(m.interest),                  /* $647.01   */
    C.pctTrim(m.ear),                     /* 5.116%    */
    C.multiple(m.growth),                 /* 1.65x     */
    C.pctSig(m.periodicRate),             /* 0.4167%   */
    'Balance after ' + m.durationText
  ]) {
    assert.ok(html.includes(value), `the page should carry ${value}`);
  }

  /* Both chart paths, generated by the same functions that redraw them. */
  const balances = [m.principal].concat(m.yearly.map((y) => y.balance));
  const max = Math.max(m.principal, m.amount);
  assert.ok(html.includes(C.seriesLine(balances, max)), 'balance line path has drifted');
  assert.ok(html.includes(C.seriesBand(balances.map(() => m.principal), balances, max)),
    'interest band path has drifted');

  /* And the explanation, sentence for sentence. */
  for (const paragraph of C.explainParagraphs(m)) {
    if (!paragraph) continue;
    const escaped = paragraph.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    assert.ok(html.includes(escaped), `explanation has drifted: ${paragraph.slice(0, 60)}...`);
  }
});

test('the compound page declares its tier and links only to pages that exist', () => {
  const html = read('docs/tools/compound-interest-calculator.html');
  assert.match(html, /CONTENT COMPLEXITY TIER: DEEP/);
  /* Every internal link must resolve to a file that is actually published. */
  const published = new Set([
    '/', '/tools/', '/privacy.html',
    '/tools/mortgage-calculator.html', '/tools/compound-interest-calculator.html'
  ]);
  for (const href of [...html.matchAll(/href="(\/[^"#]*)(#[^"]*)?"/g)].map((m) => m[1])) {
    if (href.startsWith('/css/') || href.startsWith('/js/') || href.startsWith('/assets/')) continue;
    if (href === '/site.webmanifest' || href === '/favicon.ico') continue;
    assert.ok(published.has(href), `links to ${href}, which is not a published page`);
  }
});
