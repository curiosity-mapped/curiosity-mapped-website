# curiosity-mapped-website

The Curiosity Mapped site — hand-written static pages with no build step, no
dependencies, and no framework. What is in `docs/` is what is served.

Live at **https://curiositymapped.com/**

## Layout

`docs/` is the site and nothing else is. GitHub Pages publishes that one directory,
so `docs/` is the served root: a file at `docs/privacy.html` is served at
`/privacy.html`. Everything outside it — this README, the script — is repository
furniture that never reaches the web.

```
docs/index.html          the home page
docs/privacy.html        privacy policy; the template for any indexable page
docs/404.html            not-found page (GitHub Pages serves it for any missing path)
docs/tools/index.html    the Tools hub, served at /tools/
docs/tools/mortgage-calculator.html
                         what a house costs each month, and what else arrives with it
docs/tools/compound-interest-calculator.html
                         what a balance grows to, when it is left alone
docs/tools/loan-calculator.html
                         what it takes to retire a balance, in level instalments
docs/css/tokens.css      colour / type / space tokens, and the light + dark + high-contrast ramps
docs/css/base.css        element defaults
docs/css/components.css  the blocks on the page
docs/css/calculator.css  page-scoped; loaded ONLY by the calculator pages
docs/css/utilities.css   last layer, so it wins
docs/js/main.js          theme toggle and footer year; every page works without it
docs/js/consent.js       the analytics consent panel and the footer control; every page
docs/js/mortgage.js      the mortgage calculator's arithmetic and behaviour; that page only
docs/js/compound.js      the compound interest calculator's; that page only
docs/js/loan.js          the loan calculator's; that page only
docs/assets/             one og card per indexable page, the brand mark, and the raster icons
docs/assets/cm-icon.svg  the mark itself; the favicon and the header logo are the same file
docs/favicon.ico         the bare /favicon.ico browsers ask for unprompted
docs/site.webmanifest    name, colours, and the 192/512 icons
docs/robots.txt          and docs/sitemap.xml
docs/CNAME               custom domain, read by GitHub Pages
docs/.nojekyll           serve files as-is instead of running them through Jekyll

tests/mortgage.test.mjs  the mortgage calculator's unit tests; repository furniture, never served
tests/compound.test.mjs  the compound interest calculator's, on the same pattern
tests/loan.test.mjs      the loan calculator's, likewise
tests/consent.test.mjs   the stored-choice logic, plus assertions over the built pages
scripts/apply-gtag.sh    inserts or replaces the Google Analytics tag in every page
scripts/build-og.mjs     re-renders the share cards from scripts/og-card.html
scripts/og-card.html     the share card design; never served, rendered to PNG
scripts/build-ico.mjs    repacks docs/favicon.ico from the two favicon PNGs
README.md                this file
TOOL-TIERS.md            the content standard every tool page is written against
```

`docs/tools/` is the first subdirectory in the published tree. Every path in the site
is root-absolute, so its depth changes nothing.

`calculator.css` is shared by both calculator pages. Most of it always was generic --
the formula block, the parameter table, the result panel, the charts, the live region --
and the page-specific parts are small enough that the second page carrying a few rules
it never uses is cheaper than a third stylesheet. Where two pages need the same
treatment under different names, the selector list carries both names rather than the
declarations being copied: see `.result__housing, .result__real`.

The three calculators overlap in arithmetic and not in purpose, and each page says
which question it is answering in its opening paragraph. The **compound interest
calculator** runs the arithmetic forwards: a balance is left alone and grows. The
**loan calculator** runs it backwards: a balance is retired by level instalments, and
the page is mostly about where each instalment goes and what it does not cover. The
**mortgage calculator** is the loan calculator's case with collateral attached, so it
adds the costs that travel with a property and keeps them visibly apart from principal
and interest. A reader who lands on the wrong one should be able to tell within a
paragraph, which is why the related lists on all three link sideways rather than
merely listing siblings.

What goes *on* a tool page is governed by `TOOL-TIERS.md`. Every tool is classified
`SIMPLE`, `MODERATE`, or `DEEP` before it is built, and the tier fixes the minimum
sections the page must carry. The mortgage calculator is the canonical `DEEP` page;
read the standard before adding a tool, not after. Every tool published so far is
`DEEP`, which is a fact about what has been built rather than a default: a tool whose
result is hard to misread belongs in a lower tier and should stay there. The loan
calculator departs from the standard's own example list, which files a loan payment
calculator under `MODERATE`; its tier comment argues the case rather than leaving the
discrepancy for someone to find.

Each tool page records its own tier. The classification and a map from every required
area of that tier to the section that satisfies it sit in an HTML comment at the top of
the page's `<article>` — there is no build step to hold that metadata anywhere else, and
a tier recorded only in a commit message is a tier nobody will find. Add the same block
to a new tool page, and keep it accurate when sections move.

`CNAME` and `.nojekyll` are read from the publishing source, not the repository root,
which is why they sit inside `docs/` rather than beside this file.

Cascade layer order is declared in each page's head, not in the stylesheets, so it
does not depend on which sheet loads first. `calculator.css` declares into the same
`components` layer as `components.css`, which is why it can be linked in any position.

## Running it locally

Any static server will do. There is nothing to install and nothing to compile.

```sh
python3 -m http.server 8000 --directory docs
# then open http://localhost:8000
```

Serve `docs/`, not the repository root — pointing a server at the root gets you a
directory listing, and every root-absolute path in the pages resolves one level too
high.

Every page uses root-absolute asset paths (`/css/...`), so every page needs a server
and none of them render over `file://`. `404.html` is the reason the convention exists:
Pages serves that one file for a missing path at any depth, and a relative path would
resolve against the missing directory and 404 in turn.

## Tests

Both calculators' arithmetic and the analytics consent logic have tests. There
is nothing to install: they run on Node's own test runner against the files the browser
loads, not against copies of them.

```sh
node --test "tests/**/*.test.mjs"
```

`docs/js/mortgage.js` and `docs/js/compound.js` each end with a `typeof module` guard
whose only purpose is to make their pure functions reachable from Node. In a browser
that block is skipped and the file stays a plain `<script defer>`. Run the tests before
changing anything in the top half of either file.

The two suites assert different invariants, because the two files carry money
differently and deliberately so. `mortgage.test.mjs` asserts that the schedule sums to
the loan amount exactly, in integer cents, across a matrix of rates, terms, and
principals. `compound.test.mjs` asserts closed-form values against independently derived
ones, reaches the same balance by a second route, and sweeps the whole accepted input
range for a non-finite result — because compound growth has no accumulation to drift,
and at the bounds the form accepts, a balance in cents would exceed the largest integer
a double can hold exactly.

`tests/consent.test.mjs` does the same for `docs/js/consent.js`, and then reads the
published HTML, because with no build step the generated pages *are* the artefact. It
asserts that the consent defaults are queued before `gtag.js` is fetched, that the block
appears exactly once per page, that both default calls carry all four Consent Mode
signals with the regional one first, and that neither calculator has grown a route to
the network. It also asserts two things that can only rot silently on a site with no
build step: that every element a calculator's script reaches for still exists in its
page, and that the static default figures each page ships — for readers without
JavaScript — are still what the shipped functions actually produce. Run it after
`./scripts/apply-gtag.sh`, since half of what it checks is that script's output.

## Deploying

Deployment is "push to `main`". GitHub Pages serves `docs/`; there is no workflow and
no build.

**One-time setup**, in *Settings → Pages*:

1. **Source**: *Deploy from a branch*.
2. **Branch**: `main`, folder `/docs`. Save.
3. **Custom domain**: `curiositymapped.com`. This is already committed as `CNAME`, so
   the field should populate on its own — confirm rather than retype it.
4. Wait for the DNS check to pass, then tick **Enforce HTTPS**. The checkbox stays
   disabled until GitHub has issued the certificate, which can take up to an hour.

**DNS**, at the registrar for `curiositymapped.com`. Four A records and four AAAA
records on the apex, and one CNAME for `www`:

| Type  | Name  | Value                      |
|-------|-------|----------------------------|
| A     | `@`   | `185.199.108.153`          |
| A     | `@`   | `185.199.109.153`          |
| A     | `@`   | `185.199.110.153`          |
| A     | `@`   | `185.199.111.153`          |
| AAAA  | `@`   | `2606:50c0:8000::153`      |
| AAAA  | `@`   | `2606:50c0:8001::153`      |
| AAAA  | `@`   | `2606:50c0:8002::153`      |
| AAAA  | `@`   | `2606:50c0:8003::153`      |
| CNAME | `www` | `curiosity-mapped.github.io.` |

All four A and all four AAAA records are needed — they are load-balanced, not
alternatives. Confirm the addresses against GitHub's *Managing a custom domain*
documentation before entering them; GitHub has changed them before.

Verify once DNS has propagated:

```sh
dig +short curiositymapped.com
curl -sI https://curiositymapped.com/ | head -1
curl -sI https://curiositymapped.com/nope | head -1   # expect 404
```

## Analytics consent

Analytics is consented, not assumed. Three pieces, and the split between them is the
point:

- **The inline block at the top of every `<head>`**, written by `scripts/apply-gtag.sh`.
  It is the only code on the site that speaks to Google. It declares the Consent Mode
  defaults, reads the stored choice, applies it, and only then lets `gtag.js` load.
- **`docs/js/consent.js`**, deferred. The panel and the footer control. It asks the
  question and records the answer through `window.cmConsent`; it never calls `gtag`.
- **`.consent*` in `docs/css/components.css`.** Presentation only.

Because the interface layer never touches Google, it can be replaced -- by a certified
consent platform, which Google requires for serving ads in the EEA, the UK, and
Switzerland -- without any of the Google-facing code moving.

### Why the block lives in the shell script

Consent Mode defaults have to be queued *before* `gtag.js` loads, or they do not apply
to the first hit. `apply-gtag.sh` re-inserts its block as the first element of `<head>`
on every run, so a default hand-placed above the tag would be pushed below it on the
next run -- silently, and in the wrong order. Keeping the whole thing in `GTAG_SNIPPET`
is what makes the ordering hold across five hand-written heads. `tests/consent.test.mjs`
asserts the byte offsets, so a regression fails the suite rather than the site.

### The default is regional; the panel is not

`analytics_storage` defaults to `denied` in the EEA, the UK, and Switzerland, and to
`granted` everywhere else. The region list is an array in `GTAG_SNIPPET`; Google
resolves the visitor's region from the request IP, which is the only geography a static
site can consult without adding a third-party lookup to every page load. Revisit the
list if a country joins or leaves the EEA.

The panel itself is shown to everyone, because the page cannot know where the reader is.
The three advertising signals are declared and denied in every region: the panel asks
about analytics only, and granting what was never asked for would misreport it.

**The tradeoff this carries.** Before a choice is made, a reader in a denied region
still causes one cookieless request to Google -- timestamp, user agent, referrer, page
address, consent status. No cookie, no identifier. That is inherent to loading the tag
at all, and it is what buys jurisdiction-appropriate defaults with no geography lookup.
An *explicit* decline goes further and sets `window['ga-disable-<ID>']`, so nothing is
sent at all; that is the difference between "not answered yet" and "answered no".

### The stored choice

`localStorage`, under `cm-consent` -- the same `cm-` convention as `cm-theme`, and for
the same reason wrapped in `try`/`catch` everywhere, since it *throws* in a private
window rather than returning null.

```json
{ "v": 1, "analytics": "granted", "ts": 1757337600000 }
```

Three fields, no identifier, nothing that distinguishes one reader from another, and it
never leaves the browser. Reading fails closed: an unparseable value, an unknown
version, an unrecognised choice, a missing or stale timestamp, or a thrown exception all
read as *no choice*, which shows the panel and leaves the regional default in force.

`VERSION` is stored so the format can change. **Bump it** when a consent category is
added or removed (advertising would make it `2`), when Google changes what the signals
mean, or when the policy changes the basis of the choice. **Do not bump it** for copy or
styling: re-prompting without cause teaches people to dismiss the panel. A choice also
lapses after twelve months (`MAX_AGE`).

`VERSION`, `KEY`, and `MAX_AGE` appear in both the inline block and `consent.js`. They
are held together by a test, not by shared code, because the inline copy has to run
before anything can be fetched and so cannot be a module.

### One thing the calculator must never do

> Analytics consent governs whether the visit is measured. It does not govern what a
> tool does with what you type, because nothing typed into a tool is supposed to leave
> the browser -- in any consent state.

Nothing on the site writes to the URL, and `page_location` is sanitised to origin and
path plus an allowlist of campaign parameters, so a value that reached a URL still could
not reach analytics. `#calc-form` and `#costs-form` also block submission outright:
neither can submit today -- no action, no submit button -- but adding one button would
turn Enter into a GET of the same page with the loan amount in the query string.

`tests/consent.test.mjs` fails if either calculator's script grows a reference to
`gtag`, `fetch`, `document.cookie`, `location`, or the History API. That is the
invariant, enforced. It is also why neither page offers a shareable link carrying the
reader's figures: a URL is the one thing analytics records verbatim.

## When the site grows

A few things hold absolute URLs and need updating together, since nothing generates
them:

- `docs/index.html` — `link[rel=canonical]`, `og:url`, `og:image`, and the `@id`/`url`
  fields in the JSON-LD block. It defines the `#website` and `#org` nodes that every
  other page's JSON-LD references by `@id`; reference them, never redefine them.
- `docs/privacy.html` — its own `canonical` and `og:url`. Copy its head as the starting
  point for a new indexable page; `404.html` is the `noindex` variant.
- `docs/tools/index.html`, `docs/tools/mortgage-calculator.html`, and
  `docs/tools/compound-interest-calculator.html` — their own `canonical`, `og:url`, and
  the absolute URLs throughout their JSON-LD graphs, including every `BreadcrumbList`
  item.
- Every page with the primary nav shares it: `index.html`, `tools/index.html`, and both
  calculators. Publishing one of its remaining spans means turning it into an
  `<a class="nav__item nav__item--link">` in all three and rewording the
  visually-hidden line above them, which explains why the rest are inert. The same
  applies to the `.footer__legal` nav, which every page carries.
- The Tools hub lists planned calculators as inert `.card__soon` tiles. Publishing one
  means turning its `<li class="card">` into `<li><a class="card card--link">` and
  rewording the visually-hidden line below the list.
- **Prose that counts things has to be found and edited every time; prose that
  describes them does not.** The home page's hero note said Tools "has its first
  square on it, a mortgage calculator" and went stale the day a second tool
  shipped. That rule retired "the mortgage calculator already borders on them" on
  the Tools hub, the "only the X calculator above is published" lines under each
  tool page's related list, and the footer's "only the Privacy page is published
  so far" on all six pages. The nav's visually-hidden sentence is the model to
  copy: "Tools is the first area to take shape; Journal and Reference will follow"
  is a claim about the three sections, not an inventory, so it stays true at any
  number of tools. Before writing a sentence about what exists, check whether
  publishing the next thing would make it false.
- `docs/index.html` — **the hero note names every published tool, and it is the one
  deliberate exception to the rule above: the only copy on the site that has to
  change when a tool ships.** It names each calculator and links to it, because the
  home page is the strongest page on the site and a link from it into a tool is
  worth more than a link into `/tools/`. The cost is one sentence to edit per tool;
  "Tools is growing" carries the part that would otherwise need counting. Add the
  new tool to that sentence when you publish it.
- `docs/sitemap.xml` — add each new page, and bump `lastmod`.
- `docs/robots.txt` — only the `Sitemap:` line is absolute.
- The Google Analytics tag is per-file, since nothing templates the head. Run
  `./scripts/apply-gtag.sh` after adding a page; it inserts the tag directly after
  `<head>` in every `.html` file under `docs/`, replacing a tag that is already there
  rather than duplicating it, so it is safe to run at any time. The measurement ID is
  the `GTAG_ID` constant at the top of the script — change it there and re-run, or pass
  a different one as an argument. `-n` reports what would change without writing.

Every indexable page carries its own 1200×630 share card in `docs/assets/`, referenced
by absolute URL because crawlers do not resolve relative `og:image` values. The cards
are committed, since Pages serves what is in the repository; `node scripts/build-og.mjs`
re-renders them from `scripts/og-card.html`, which is where the design lives. A new
page needs an entry in that script's `CARDS` list and its own `og:image`, and the test
suite fails if two pages share one or if a card's real dimensions disagree with the
meta tags that describe it. `docs/404.html` has no card on purpose: it is `noindex` and
there is nothing to share.

## The mark

Everything with the logo in it comes from the `curiosity-mapped-brand-v1` package, which
is the source of truth and is not vendored here — only its output is. The mark is the
C and M read as one figure: a cartographic C, an engineered M, and a wayfinding axis
through the middle, in a violet-to-green gradient.

It reaches the site in three forms, and they are not interchangeable.

- `docs/assets/cm-icon.svg` is the square tile, and it does double duty as the favicon
  and as the logo in every page header. It carries its own navy ground, which is why it
  is the one piece of artwork on the site with no light and dark variant: a tile reads
  against paper and against ink alike, and a theme-switching SVG would in any case have
  disagreed with the fixed-colour PNGs sitting behind it in the `rel=icon` list.
- The raster icons beside it — `favicon-16`, `favicon-32`, `apple-touch-icon`,
  `icon-192`, `icon-512` — are the same tile, copied from the package for the browsers
  and platforms that will not take an SVG. `docs/favicon.ico` wraps the 16 and 32px PNGs
  in an icon directory; `node scripts/build-ico.mjs` rebuilds it after they change.
- `scripts/og-card.html` inlines the *untiled* mark instead, because the tile's navy
  would read as a panel against the card's near-black ground. It is the only copy of the
  artwork that lives in markup rather than in a file, and it is inline because the card
  is rasterised locally and never served.

The brand package also ships a palette and full horizontal and stacked lockups. Neither
is used: the site keeps its own colour tokens, and the header sets "Curiosity Mapped" in
the site's own type next to the mark rather than dropping in a lockup whose wordmark
would not follow the tokens or the dark theme.
