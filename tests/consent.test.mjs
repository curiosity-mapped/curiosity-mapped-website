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
  'docs/tools/compound-interest-calculator.html',
  'docs/tools/loan-calculator.html'
];

/*
 * The tool pages, each with the script that drives it and the number of forms it
 * is allowed to have. One list, because every assertion below that used to name
 * the compound page now runs over all three: a check written for one tool is a
 * check the next tool silently does not get.
 */
const TOOLS = [
  { page: 'docs/tools/mortgage-calculator.html', script: 'docs/js/mortgage.js', forms: 2 },
  { page: 'docs/tools/compound-interest-calculator.html', script: 'docs/js/compound.js', forms: 1 },
  { page: 'docs/tools/loan-calculator.html', script: 'docs/js/loan.js', forms: 1 }
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
  for (const { script: path } of TOOLS) {
    const js = code(path);
    for (const forbidden of FORBIDDEN) {
      assert.ok(!js.includes(forbidden), `${path} must not reference ${forbidden}`);
    }
  }
});

test('no calculator form can put its fields into the URL', () => {
  /* The form count is asserted per page rather than in general: a page growing a
     form nobody wrote a rule for is exactly the regression this catches. */
  for (const { page, script, forms: expected } of TOOLS) {
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

test('every element a calculator reaches for exists in its page', () => {
  for (const { page, script } of TOOLS) {
    const js = read(script);
    const html = read(page);
    const wanted = [...js.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);
    assert.ok(wanted.length > 40, `${script}: expected a full ui map, found ${wanted.length}`);
    for (const id of new Set(wanted)) {
      assert.ok(html.includes(`id="${id}"`),
        `${script} looks up #${id}, which ${page} does not contain`);
    }
  }
});

test('no page uses an id twice', () => {
  /*
   * getElementById returns the first match in document order, so a duplicate id
   * does not fail loudly: it silently hands the script the wrong element. On the
   * loan page a <select id="frequency"> shared a name with the <h2 id="frequency">
   * it linked to, and two <tbody> ids matched the <h3> headings above them, so
   * the first render emptied the real tables and appended their rows into a
   * heading. Nothing threw, the unit tests stayed green, and the only visible
   * symptom was 19px of horizontal scroll at 400px.
   */
  for (const page of PAGES) {
    const seen = new Set();
    for (const [, id] of read(page).matchAll(/\sid="([^"]+)"/g)) {
      assert.ok(!seen.has(id), `${page} uses id="${id}" more than once`);
      seen.add(id);
    }
  }
});

/*
 * Each tool declares how to rebuild its own default scenario and which strings
 * that scenario must put into the markup. Written as data rather than as one
 * test per page, so a fourth tool is a fourth entry rather than a fourth test
 * nobody remembers to write.
 */
/*
 * The text of one element, by id. `html.includes(value)` is too weak for a
 * figure the page prints in several places: corrupting the headline payment from
 * $495.03 to $495.04 leaves the string present in the explanation, the parameter
 * table and the FAQ, and a presence check waves it through. This reads the one
 * element that is supposed to carry it.
 */
const elementText = (html, id) => {
  const open = html.search(new RegExp(`<[a-z]+[^>]*\\sid="${id}"`));
  if (open === -1) return null;
  const gt = html.indexOf('>', open);
  const close = html.indexOf('<', gt);
  return html.slice(gt + 1, close).trim();
};

const ARTEFACTS = [
  {
    page: 'docs/tools/mortgage-calculator.html',
    build: () => {
      const M = require('../docs/js/mortgage.js');
      const m = M.buildModel({
        loanAmount: 320000, homePrice: 400000, downPayment: 80000, pinned: false,
        ratePct: 6, years: 30, costs: { tax: null, insurance: null, pmi: null, hoa: null }
      });
      const balances = [m.principal].concat(m.yearly.map((y) => M.fromCents(y.endingBalanceCents)));
      return {
        lib: M,
        model: m,
        values: [
          M.money(m.payment),
          M.money(M.fromCents(m.schedule.totalInterestCents)),
          M.money(M.fromCents(m.schedule.totalPaidCents)),
          M.money(M.fromCents(m.schedule.finalPaymentCents))
        ],
        paths: [M.seriesArea(balances, m.principal), M.seriesLine(balances, m.principal)]
      };
    }
  },
  {
    page: 'docs/tools/compound-interest-calculator.html',
    build: () => {
      const C = require('../docs/js/compound.js');
      const m = C.buildModel({
        principal: 1000, ratePct: 5, frequencyKey: '12', years: 10,
        unit: 'years', inflationPct: null
      });
      const balances = [m.principal].concat(m.yearly.map((y) => y.balance));
      const max = Math.max(m.principal, m.amount);
      return {
        lib: C,
        model: m,
        values: [
          C.money(m.amount),                    /* $1,647.01 */
          C.money(m.interest),                  /* $647.01   */
          C.pctTrim(m.ear),                     /* 5.116%    */
          C.multiple(m.growth),                 /* 1.65x     */
          C.pctSig(m.periodicRate),             /* 0.4167%   */
          'Balance after ' + m.durationText
        ],
        paths: [
          C.seriesLine(balances, max),
          C.seriesBand(balances.map(() => m.principal), balances, max)
        ]
      };
    }
  },
  {
    page: 'docs/tools/loan-calculator.html',
    build: () => {
      const L = require('../docs/js/loan.js');
      const m = L.buildModel({
        principal: 25000, ratePct: 7, years: 5, frequencyKey: '12', extra: null
      });
      const balances = [m.principal].concat(m.yearly.map((y) => L.fromCents(y.endingBalanceCents)));
      const interest = m.yearly.map((y) => L.fromCents(y.interestCents));
      const totals = m.yearly.map((y) => L.fromCents(y.interestCents + y.principalCents));
      const compMax = Math.max.apply(null, totals);
      return {
        lib: L,
        model: m,
        values: [
          L.money(m.payment),                            /* $495.03    */
          L.moneyCents(m.totalInterestCents),            /* $4,701.82  */
          L.moneyCents(m.totalPaidCents),                /* $29,701.82 */
          L.moneyCents(m.finalPaymentCents),             /* $495.05    */
          L.pctSig(m.periodicRate) + ' ' + m.freq.each,  /* 0.5833% each month */
          L.integer(m.n) + ' ' + m.freq.adjective + ' payments',
          L.chartDescription(m),
          L.rateCaptionText(m, L.sensitivity(m).rates),
          L.termCaptionText(m, L.sensitivity(m).terms)
        ],
        elements: {
          'result-amount': L.money(m.payment),
          'result-interest': L.moneyCents(m.totalInterestCents),
          'result-total': L.moneyCents(m.totalPaidCents),
          'result-count': L.integer(m.count),
          'result-final': L.moneyCents(m.finalPaymentCents),
          'result-label': L.capitalize(m.freq.adjective) + ' payment',
          'p-principal': L.moneyNatural(m.principal),
          'p-periodic': L.pctSig(m.periodicRate) + ' ' + m.freq.each,
          'p-count': L.integer(m.n) + ' ' + L.plural(m.n, 'payment'),
          'p-payment': L.money(m.payment),
          'term-readout': L.integer(m.n) + ' ' + m.freq.adjective + ' ' + L.plural(m.n, 'payment'),
          'chart-balance-ymax': L.moneyWhole(m.principal),
          'chart-balance-desc': L.chartDescription(m)
        },
        paths: [
          L.seriesArea(balances, m.principal),
          L.seriesLine(balances, m.principal),
          L.seriesBand(interest.map(() => 0), interest, compMax),
          L.seriesBand(interest, totals, compMax)
        ]
      };
    }
  }
];

test('every tool page ships the figures its own code produces', () => {
  /*
   * The default scenario is written into the markup so each page is complete and
   * correct without JavaScript. This asserts the markup is what the shipped
   * functions actually return, rather than what someone typed while looking at
   * them. The chart paths matter most: they are the one artefact nobody would
   * ever notice had drifted.
   */
  for (const { page, build } of ARTEFACTS) {
    const html = read(page);
    const { lib, model, values, paths } = build();

    for (const value of values) {
      assert.ok(html.includes(value), `${page} should carry ${value}`);
    }
    for (const [id, expected] of Object.entries(build().elements || {})) {
      assert.equal(elementText(html, id), expected,
        `${page}: #${id} has drifted from what the code produces`);
    }
    for (const d of paths) {
      assert.ok(html.includes(d), `${page}: a chart path has drifted from its generator`);
    }
    for (const paragraph of lib.explainParagraphs(model)) {
      if (!paragraph) continue;
      const escaped = paragraph.replace(/&/g, '&amp;').replace(/</g, '&lt;');
      assert.ok(html.includes(escaped),
        `${page}: explanation has drifted: ${paragraph.slice(0, 60)}...`);
    }
  }
});

test('every page points at a share card that exists and is the size it claims', () => {
  /*
   * A wrong og:image is invisible until someone shares a link, and then it is
   * wrong in front of an audience. The PNG header carries the real dimensions,
   * so the declared width and height can be checked against the file rather than
   * against each other.
   */
  const { readFileSync, existsSync } = require('node:fs');
  const seen = new Map();

  for (const page of PAGES) {
    const html = read(page);
    const image = html.match(/<meta property="og:image" content="([^"]+)">/);
    if (page.endsWith('404.html')) {
      /* Deliberately carries no card: it is noindex and there is nothing to
         share. If it grows one, this branch should grow an assertion. */
      assert.equal(image, null, '404.html is not shared and needs no card');
      continue;
    }
    assert.ok(image, `${page}: no og:image`);

    const url = image[1];
    assert.ok(url.startsWith('https://curiositymapped.com/assets/'),
      `${page}: og:image must be absolute; crawlers do not resolve relative ones`);

    const file = 'docs/assets/' + url.split('/').pop();
    assert.ok(existsSync(join(ROOT, file)), `${page}: og:image points at ${file}, which does not exist`);

    /* PNG: 8-byte signature, then the IHDR length and type, then width and
       height as big-endian 32-bit integers. */
    const bytes = readFileSync(join(ROOT, file));
    assert.equal(bytes.toString('ascii', 12, 16), 'IHDR', `${file}: not a PNG`);
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    assert.equal(width, Number(html.match(/<meta property="og:image:width" content="(\d+)">/)[1]),
      `${page}: og:image:width does not match ${file}`);
    assert.equal(height, Number(html.match(/<meta property="og:image:height" content="(\d+)">/)[1]),
      `${page}: og:image:height does not match ${file}`);
    assert.equal(width, 1200, `${file}: share cards are 1200 wide`);
    assert.equal(height, 630, `${file}: share cards are 630 tall`);

    const alt = html.match(/<meta property="og:image:alt" content="([^"]+)">/);
    assert.ok(alt && alt[1].length > 20, `${page}: og:image:alt should describe the card`);

    /* Two pages sharing one card is a card that describes at most one of them. */
    assert.ok(!seen.has(file), `${page} and ${seen.get(file)} share ${file}`);
    seen.set(file, page);
  }
});

test('no tool page or tool script uses an em dash in copy', () => {
  /*
   * A house rule, enforced because a prose rule nobody can check rots on the next
   * tool. Two exemptions, and only two.
   *
   * HTML comments are not copy. They explain the markup to whoever edits it next,
   * and they never reach a reader.
   *
   * An em dash alone in a table cell is not punctuation, it is the standard
   * typographic mark for "not applicable", and the sensitivity and frequency
   * tables use it for the row the other rows are measured against. Replacing
   * those with a comma would be replacing a symbol with a mistake. This is the
   * trap the rule contains: a find-and-replace over these files would look
   * finished and would have broken five tables.
   */
  const EM = /&mdash;|\u2014/;

  for (const { page } of TOOLS) {
    const copy = read(page)
      .replace(/<!--[\s\S]*?-->/g, ' ')          /* comments are not copy */
      .replace(/<td>(&mdash;|\u2014)<\/td>/g, ' '); /* the not-applicable cell */
    assert.ok(!EM.test(copy),
      `${page}: em dash in copy near ${JSON.stringify(
        copy.slice(Math.max(0, copy.search(EM) - 70), copy.search(EM) + 40))}`);
  }

  for (const { script } of TOOLS) {
    /* Comments stripped, then the standalone placeholder string removed; what is
       left is prose the page will print. */
    const prose = code(script).replace(/'(&mdash;|\u2014)'/g, "''");
    assert.ok(!EM.test(prose),
      `${script}: em dash in a prose string near ${JSON.stringify(
        prose.slice(Math.max(0, prose.search(EM) - 70), prose.search(EM) + 40))}`);
  }
});

test('every tool page cites the content standard at a path that exists', () => {
  /*
   * TOOL-TIERS.md is repository furniture: it is gitignored and never served, so
   * the tier comments' original "(see /TOOL-TIERS.md)" pointed at a URL that
   * would 404 for anyone who tried it.
   */
  for (const { page } of TOOLS) {
    const html = read(page);
    assert.ok(!html.includes('/TOOL-TIERS.md'),
      `${page}: cites TOOL-TIERS.md as a served path, which it is not`);
    assert.ok(html.includes('TOOL-TIERS.md in the repository root'),
      `${page}: should cite TOOL-TIERS.md in the repository root`);
  }
});

test('every tool page declares its tier, and every page links only to pages that exist', () => {
  for (const { page } of TOOLS) {
    assert.match(read(page), /CONTENT COMPLEXITY TIER: (SIMPLE|MODERATE|DEEP)/, page);
  }

  /* Every internal link must resolve to a file that is actually published. */
  const published = new Set([
    '/', '/tools/', '/privacy.html',
    '/tools/mortgage-calculator.html', '/tools/compound-interest-calculator.html',
    '/tools/loan-calculator.html'
  ]);
  for (const page of PAGES) {
    const html = read(page);
    for (const href of [...html.matchAll(/href="(\/[^"#]*)(#[^"]*)?"/g)].map((m) => m[1])) {
      if (href.startsWith('/css/') || href.startsWith('/js/') || href.startsWith('/assets/')) continue;
      if (href === '/site.webmanifest' || href === '/favicon.ico') continue;
      assert.ok(published.has(href), `${page} links to ${href}, which is not a published page`);
    }
  }
});
