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
  'docs/about.html',
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

/* ------------------------------------------------------- the deferral */

/*
 * The record of the question having been asked and not answered. It is not a
 * choice and must never be able to pass for one, which is what most of these
 * assert. Fails closed in the same direction as the choice above -- anything
 * unreadable means ask -- so the failure mode of every one of these is an extra
 * prompt, never a silenced one.
 */

test('a deferral reads back', () => {
  assert.equal(C.parseDefer(C.serializeDefer('shown', now), now), 'shown');
  assert.equal(C.parseDefer(C.serializeDefer('dismissed', now), now), 'dismissed');
});

test('the deferral carries no choice and no identifier', () => {
  const raw = C.serializeDefer('shown', now);
  assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ['defer', 'ts', 'v']);
  for (const word of ['analytics', 'granted', 'denied']) {
    assert.ok(!raw.includes(word), `a deferral must not contain ${word}`);
  }
});

test('a deferral cannot be mistaken for a choice, or a choice for a deferral', () => {
  /* The two records live in one storage area under two keys, and the only thing
     keeping them apart is that neither parser accepts the other's output. */
  assert.equal(C.parseDefer(C.serialize('granted', now), now), null);
  assert.equal(C.parseDefer(C.serialize('denied', now), now), null);
  assert.equal(C.parse(C.serializeDefer('shown', now), now), null);
  assert.equal(C.parse(C.serializeDefer('dismissed', now), now), null);
});

test('a shown panel is quiet for a day, a dismissal for a month', () => {
  const shown = (age) => C.parseDefer(C.serializeDefer('shown', now - age), now);
  const gone = (age) => C.parseDefer(C.serializeDefer('dismissed', now - age), now);
  assert.equal(shown(C.DEFER_SHOWN_AGE), 'shown');
  assert.equal(shown(C.DEFER_SHOWN_AGE + 1), null);
  assert.equal(gone(C.DEFER_DISMISSED_AGE), 'dismissed');
  assert.equal(gone(C.DEFER_DISMISSED_AGE + 1), null);
  /* Each kind is read against its own window, not the longer of the two. */
  assert.equal(shown(C.DEFER_SHOWN_AGE + 1000), null);
  assert.equal(gone(C.DEFER_SHOWN_AGE + 1000), 'dismissed');
});

test('reading a deferral fails closed', () => {
  for (const raw of [
    null,
    undefined,
    '',
    '{',
    '[]',
    'null',
    '"shown"',
    JSON.stringify({ v: 0, defer: 'shown', ts: now }),
    JSON.stringify({ v: C.VERSION, defer: 'maybe', ts: now }),
    JSON.stringify({ v: C.VERSION, defer: 'shown' }),
    JSON.stringify({ v: C.VERSION, defer: 'shown', ts: String(now) }),
    JSON.stringify({ defer: 'shown', ts: now }),
    /* A clock set forward, or a hand-edited value. The choice record can afford
       to be lax about this because it grants something; a deferral suppresses a
       prompt, so a timestamp in the future would silence the panel for good. */
    JSON.stringify({ v: C.VERSION, defer: 'shown', ts: now + 1 }),
    JSON.stringify({ v: C.VERSION, defer: 'dismissed', ts: now + 1 })
  ]) {
    assert.equal(C.parseDefer(raw, now), null, `expected null for ${JSON.stringify(raw)}`);
  }
});

test('a non-answer is never honoured longer than an answer', () => {
  assert.ok(C.DEFER_SHOWN_AGE < C.DEFER_DISMISSED_AGE);
  assert.ok(C.DEFER_DISMISSED_AGE < C.MAX_AGE);
  /* The deferral rides the consent VERSION, so bumping it to force a re-prompt
     cannot be quietly suppressed by a deferral written under the old one. */
  assert.equal(JSON.parse(C.serializeDefer('shown', now)).v, C.VERSION);
});

test('the deferral is its own key', () => {
  assert.notEqual(C.DEFER_KEY, C.KEY);
  assert.ok(C.DEFER_KEY.startsWith('cm-'));
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

/*
 * The load-bearing one. The deferral means nothing to Google -- "asked and
 * unanswered" and "asked, unanswered, and not being re-asked" are the same
 * consent state -- so the block that speaks to Google must never learn the key.
 * Sliced rather than searched whole, because the policy page names both keys in
 * its prose on purpose, and that is exactly where they should be named.
 */
const googleBlock = (html) => {
  const start = html.indexOf('<!-- Google tag (gtag.js) -->');
  const end = html.indexOf('<!-- End Google tag -->');
  assert.ok(start !== -1 && end > start, 'the Google tag block must be findable');
  return html.slice(start, end);
};

test('the Google block never learns about the deferral', () => {
  for (const page of PAGES) {
    const block = googleBlock(read(page));
    assert.ok(!block.includes(C.DEFER_KEY), `${page}: block must not name ${C.DEFER_KEY}`);
    assert.ok(!block.includes('defer'), `${page}: block must not mention the deferral`);
  }
  /* The pages are only its output; this is the file it comes from. */
  const script = read('scripts/apply-gtag.sh');
  assert.ok(!script.includes(C.DEFER_KEY));
  assert.ok(!script.includes('DEFER_'));
});

test('the interface never grows a second way to signal Google', () => {
  /* Comments stripped: this file explains at length what it does not do. */
  const js = code('docs/js/consent.js');
  assert.equal((js.match(/consent\.set\(/g) || []).length, 1,
    'exactly one call site may record a choice');
  for (const forbidden of ['gtag', 'dataLayer', 'ga-disable']) {
    assert.ok(!js.includes(forbidden), `consent.js must not reference ${forbidden}`);
  }
});

test('the dismiss control exists in both files', () => {
  assert.match(read('docs/js/consent.js'), /'consent__dismiss'/);
  assert.match(read('docs/css/components.css'), /\.consent__dismiss\s*\{/);
});

test('Escape is scoped to the panel', () => {
  /* The panel is not modal -- it traps no focus and leaves the page usable --
     so a document-level key handler would be claiming Escape from whatever the
     reader is actually in, and the calculators are full of number inputs. */
  const js = code('docs/js/consent.js');
  assert.ok(js.includes("panel.addEventListener('keydown'"));
  assert.ok(!js.includes("document.addEventListener('keydown'"));
});

test('the policy names every consent key the code writes', () => {
  const html = read('docs/privacy.html');
  for (const key of [C.KEY, C.DEFER_KEY]) {
    assert.ok(html.includes(key), `privacy.html must disclose ${key}`);
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
   * wrong in front of an audience. The file header carries the real format and
   * dimensions, so the declared type, width and height can be checked against
   * the file rather than against each other.
   */
  const { readFileSync, existsSync } = require('node:fs');
  const seen = new Map();

  /* PNG: signature, then IHDR with width and height as big-endian uint32s.
     JPEG: walk the marker segments to the first start-of-frame (SOF0-SOF15,
     less DHT/JPG/DAC, which share the range), whose payload holds the height
     then the width as big-endian uint16s. */
  const imageInfo = (bytes) => {
    if (bytes.toString('ascii', 12, 16) === 'IHDR') {
      return { type: 'image/png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      let at = 2;
      while (at + 9 < bytes.length) {
        if (bytes[at] !== 0xff) { at++; continue; }
        const marker = bytes[at + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { type: 'image/jpeg', height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
        }
        at += 2 + bytes.readUInt16BE(at + 2);
      }
    }
    return { type: null, width: 0, height: 0 };
  };

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

    const bytes = readFileSync(join(ROOT, file));
    const { type, width, height } = imageInfo(bytes);
    assert.ok(type, `${file}: neither a PNG nor a JPEG`);
    assert.equal(type, (html.match(/<meta property="og:image:type" content="([^"]+)">/) || [])[1],
      `${page}: og:image:type does not match what ${file} actually is`);
    /* Photographic cards balloon as PNG, and some scrapers drop large previews. */
    assert.ok(bytes.length <= 400 * 1024, `${file}: ${bytes.length} bytes is over the 400KB card budget`);
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

test('every asset a page, a stylesheet or the manifest names is published', () => {
  /*
   * The link check below skips /assets/ because it is about pages, and nothing
   * else looks at src, srcset or CSS url(), so a mistyped image path would ship
   * as a silent gap in the header or a hero that never arrives. Query strings
   * (the ?v= on the icons) are cache-busting only and are stripped.
   */
  const { existsSync } = require('node:fs');
  const missing = [];
  let checked = 0;
  const check = (where, ref) => {
    if (!ref.startsWith('/')) return;
    checked++;
    if (!existsSync(join(ROOT, 'docs', ref.split(/[?#]/)[0]))) missing.push(`${where}: ${ref}`);
  };

  for (const page of PAGES) {
    const html = read(page);
    for (const m of html.matchAll(/\b(?:src|href)="(\/assets\/[^"]+)"/g)) check(page, m[1]);
    for (const m of html.matchAll(/\bsrcset="([^"]+)"/g)) {
      for (const candidate of m[1].split(',')) check(page, candidate.trim().split(/\s+/)[0]);
    }
  }
  for (const sheet of ['docs/css/tokens.css', 'docs/css/components.css']) {
    for (const m of read(sheet).matchAll(/url\(\s*['"]?(\/assets\/[^'")\s]+)/g)) check(sheet, m[1]);
  }
  for (const icon of JSON.parse(read('docs/site.webmanifest')).icons) {
    check('docs/site.webmanifest', icon.src);
  }

  assert.ok(checked > 30, `only ${checked} asset references found; has a pattern stopped matching?`);
  assert.deepEqual(missing, []);
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
    '/', '/tools/', '/privacy.html', '/about.html',
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
