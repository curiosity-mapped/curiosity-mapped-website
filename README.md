# curiosity-mapped-website

The Curiosity Mapped placeholder site — a single static page, hand-written, with no
build step, no dependencies, and no framework. What is in `docs/` is what is served.

Live at **https://curiositymapped.com/**

## Layout

`docs/` is the site and nothing else is. GitHub Pages publishes that one directory,
so `docs/` is the served root: a file at `docs/privacy.html` is served at
`/privacy.html`. Everything outside it — this README, the script — is repository
furniture that never reaches the web.

```
docs/index.html          the page
docs/privacy.html        privacy policy; the template for any indexable page
docs/404.html            not-found page (GitHub Pages serves it for any missing path)
docs/css/tokens.css      colour / type / space tokens, and the light + dark + high-contrast ramps
docs/css/base.css        element defaults
docs/css/components.css  the blocks on the page
docs/css/utilities.css   last layer, so it wins
docs/js/main.js          theme toggle and footer year; the page works without it
docs/assets/             og image and raster icons
docs/favicon.ico         the bare /favicon.ico browsers ask for unprompted
docs/site.webmanifest    name, colours, and the 192/512 icons
docs/robots.txt          and docs/sitemap.xml
docs/CNAME               custom domain, read by GitHub Pages
docs/.nojekyll           serve files as-is instead of running them through Jekyll

scripts/apply-gtag.sh    inserts or replaces the Google Analytics tag in every page
README.md                this file
```

`CNAME` and `.nojekyll` are read from the publishing source, not the repository root,
which is why they sit inside `docs/` rather than beside this file.

Cascade layer order is declared in `index.html`, not in the stylesheets, so it does
not depend on which sheet loads first.

## Running it locally

Any static server will do. There is nothing to install and nothing to compile.

```sh
python3 -m http.server 8000 --directory docs
# then open http://localhost:8000
```

Serve `docs/`, not the repository root — pointing a server at the root gets you a
directory listing, and every root-absolute path in the pages resolves one level too
high.

All three pages use root-absolute asset paths (`/css/...`), so all three need a server
and none of them render over `file://`. `404.html` is the reason the convention exists:
Pages serves that one file for a missing path at any depth, and a relative path would
resolve against the missing directory and 404 in turn.

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

## When the site grows

A few things hold absolute URLs and need updating together, since nothing generates
them:

- `docs/index.html` — `link[rel=canonical]`, `og:url`, `og:image`, and the `@id`/`url`
  fields in the JSON-LD block.
- `docs/privacy.html` — its own `canonical` and `og:url`. Copy its head as the starting
  point for a new indexable page; `404.html` is the `noindex` variant, and only
  `index.html` carries the JSON-LD graph.
- `docs/index.html` and `docs/privacy.html` share the `.footer__legal` nav. Publishing one of
  its remaining spans means turning it into an `<a>` in both files and rewording the
  visually-hidden line above them, which explains why the rest are inert.
- `docs/sitemap.xml` — add each new page, and bump `lastmod`.
- `docs/robots.txt` — only the `Sitemap:` line is absolute.
- The Google Analytics tag is per-file, since nothing templates the head. Run
  `./scripts/apply-gtag.sh` after adding a page; it inserts the tag directly after
  `<head>` in every `.html` file under `docs/`, replacing a tag that is already there
  rather than duplicating it, so it is safe to run at any time. The measurement ID is
  the `GTAG_ID` constant at the top of the script — change it there and re-run, or pass
  a different one as an argument. `-n` reports what would change without writing.

`docs/assets/og.png` is 1200×630 and is referenced by absolute URL, because crawlers do
not resolve relative `og:image` values. If the wordmark or palette changes, that
image has to be regenerated to match.
