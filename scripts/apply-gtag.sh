#!/usr/bin/env bash
#
# Insert (or replace) the Google Analytics tag immediately after the first <head>
# in every .html file under docs/, the directory GitHub Pages publishes.
#
#   scripts/apply-gtag.sh              apply the ID below to every page
#   scripts/apply-gtag.sh G-OTHERID    apply a different measurement ID
#   scripts/apply-gtag.sh -n           dry run; report, change nothing
#
# Re-running is safe: an existing tag is replaced, never duplicated.
#
# The block this writes is consent-aware. Consent Mode defaults have to be
# queued before gtag.js loads, and this script re-inserts its block as the first
# element of <head> on every run, so a default hand-placed above the tag would
# be pushed below it -- silently, and in the wrong order. Keeping the whole
# thing here is what makes the ordering hold across five hand-written heads.

set -euo pipefail

GTAG_ID="G-6ZT7DLXEBG"

DRY_RUN=0
case "${1-}" in
  -n|--dry-run) DRY_RUN=1; shift ;;
esac
if [ $# -gt 0 ]; then
  GTAG_ID="$1"
  shift
fi
if [ $# -gt 0 ]; then
  echo "usage: $(basename "$0") [-n|--dry-run] [GTAG_ID]" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Only the published tree is rewritten. ROOT stays the repo root so that the
# paths reported below read "docs/index.html" rather than a bare "index.html".
SITE="$ROOT/docs"

# The block written into each page. The trailing marker is not part of Google's
# snippet; it is what makes the region unambiguous to replace on the next run.
#
# The heredoc is quoted and the ID substituted afterwards, so that the JavaScript
# below reads exactly as it will be served -- no escaping of $ or \ to get wrong.
GTAG_SNIPPET="$(cat <<'EOF'
<!-- Google tag (gtag.js) -->
<script>
  /* Consent Mode defaults, declared before the tag loads. The order is
     load-bearing: gtag.js drains whatever is already queued in dataLayer, so a
     default that arrived after the loader would not apply to the first hit. */
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}

  /* Denied by default in the EEA, the UK, and Switzerland. Google resolves the
     region from the request IP, which is the only geography a static site can
     consult without adding a third-party lookup to every page load. */
  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    region: ['AT','BE','BG','CH','CY','CZ','DE','DK','EE','ES','FI','FR','GB',
             'GR','HR','HU','IE','IS','IT','LI','LT','LU','LV','MT','NL','NO',
             'PL','PT','RO','SE','SI','SK']
  });

  /* Everywhere else analytics is on until the visitor says otherwise. The three
     advertising signals stay denied in every region: the banner asks about
     analytics only, and granting what was never asked for would misreport it. */
  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'granted'
  });

  gtag('set', 'ads_data_redaction', true);

  /* The only code on the site that speaks to Google. The banner in consent.js
     calls set() and never touches gtag itself, so the consent interface can be
     replaced -- by a certified CMP, if advertising is ever added -- without any
     of this moving. */
  window.cmConsent = (function () {
    var ID = '__GTAG_ID__';
    var KEY = 'cm-consent';
    var VERSION = 1;
    var MAX_AGE = 31536000000; /* 12 months, in milliseconds */
    var KEEP = /^(utm_source|utm_medium|utm_campaign|utm_term|utm_content|gclid|gbraid|wbraid)$/;

    /* Fails closed. Anything this cannot positively recognise as a current,
       unexpired choice reads as no choice at all, which leaves the regional
       default in force and shows the banner. localStorage throws rather than
       returning null in a private window, hence the catch. */
    function read() {
      try {
        var c = JSON.parse(localStorage.getItem(KEY));
        if (!c || c.v !== VERSION) return null;
        if (c.analytics !== 'granted' && c.analytics !== 'denied') return null;
        if (typeof c.ts !== 'number' || Date.now() - c.ts > MAX_AGE) return null;
        return c.analytics;
      } catch (e) { return null; }
    }

    function write(state) {
      try {
        localStorage.setItem(KEY, JSON.stringify(
          { v: VERSION, analytics: state, ts: Date.now() }
        ));
      } catch (e) {}
    }

    /* Strips every query parameter the site does not put there itself, so that
       no future URL can carry a browser-tool input into page_location. Nothing
       on the site writes to the URL today; this is what keeps that true if one
       day something does. The allowlist is what leaves campaign attribution
       working, should it ever be used. */
    function url(href) {
      if (!href) return href;
      var a = document.createElement('a');
      a.href = href;
      var kept = [];
      var parts = a.search.replace(/^\?/, '').split('&');
      for (var i = 0; i < parts.length; i++) {
        if (parts[i] && KEEP.test(parts[i].split('=')[0])) kept.push(parts[i]);
      }
      return a.protocol + '//' + a.host + a.pathname +
             (kept.length ? '?' + kept.join('&') : '');
    }

    /* Withdrawal has to remove what is already there: a consent update stops GA
       writing cookies, it does not clear the ones written before it. */
    function purge() {
      var all = document.cookie.split(';');
      for (var i = 0; i < all.length; i++) {
        var name = all[i].split('=')[0].replace(/^\s+|\s+$/g, '');
        if (name.indexOf('_ga') !== 0) continue;
        document.cookie = name + '=; Max-Age=0; path=/';
        var domain = location.hostname;
        while (domain.indexOf('.') > -1) {
          document.cookie = name + '=; Max-Age=0; path=/; domain=' + domain;
          document.cookie = name + '=; Max-Age=0; path=/; domain=.' + domain;
          domain = domain.slice(domain.indexOf('.') + 1);
        }
      }
    }

    function apply(state) {
      gtag('consent', 'update', { analytics_storage: state });
      /* Advanced consent mode keeps sending cookieless pings while storage is
         denied. That is the right behaviour for someone who has not answered
         yet, and it is not what Reject means, so an explicit denial also trips
         Google's own per-measurement-ID kill switch. Assigned rather than set,
         because the flag is read at hit time: leaving it true would silently
         make a later change of mind do nothing. */
      window['ga-disable-' + ID] = state === 'denied';
    }

    var api = {
      ID: ID,
      KEY: KEY,
      VERSION: VERSION,
      MAX_AGE: MAX_AGE,
      read: read,
      url: url,
      state: read(),

      set: function (state) {
        write(state);
        apply(state);
        /* No page view is replayed here. Where the default was already
           granted -- everywhere outside the denied regions -- this document was
           counted on load, and sending another would count it twice. Where the
           default was denied, accepting costs the entry page view and every
           page after it is measured normally. An overcount corrupts the numbers
           for most visitors; an undercount of one view understates them for
           some. gtag does not replay it either, which was measured rather than
           assumed. */
        if (state === 'denied') purge();
        api.state = state;
      },

      /* For another tab reacting to a storage event: the choice is already
         written, only this document's Google state needs to catch up. */
      sync: function (state) {
        if (state) apply(state);
        if (state === 'denied') purge();
        api.state = state;
      }
    };

    if (api.state) apply(api.state);
    return api;
  })();
</script>
<script async src="https://www.googletagmanager.com/gtag/js?id=__GTAG_ID__"></script>
<script>
  gtag('js', new Date());
  (function () {
    var cfg = { page_location: cmConsent.url(location.href) };
    /* An external referrer is Google's to interpret and cannot carry anything
       typed into this site. A same-origin one goes through the same sanitiser,
       so a value that reached one page's URL could not follow the reader to the
       next one either. */
    if (document.referrer && document.referrer.indexOf(location.origin) === 0) {
      cfg.page_referrer = cmConsent.url(document.referrer);
    }
    gtag('config', '__GTAG_ID__', cfg);
  })();
</script>
<!-- End Google tag -->
EOF
)"
export GTAG_SNIPPET="${GTAG_SNIPPET//__GTAG_ID__/$GTAG_ID}"

tmp=""
trap '[ -n "$tmp" ] && rm -f "$tmp"' EXIT

skipped=0

while IFS= read -r -d '' file; do
  rel="${file#"$ROOT"/}"
  tmp="$(mktemp "${file}.gtag.XXXXXX")"

  # Exit status carries the outcome: 0 inserted, 1 no <head> found.
  status=0
  awk '
    BEGIN { snippet = ENVIRON["GTAG_SNIPPET"] }

    function is_gtag(s) {
      return s ~ /googletagmanager\.com\/gtag\/js/ ||
             s ~ /gtag\([\x27"]js[\x27"]/ ||
             s ~ /gtag\([\x27"]config[\x27"]/ ||
             s ~ /gtag\([\x27"]consent[\x27"]/
    }

    # Before the head tag: pass everything through, then emit the snippet.
    !done {
      print
      if (tolower($0) ~ /<head([[:space:]>]|$)/) { print snippet; done = 1 }
      next
    }

    # Past </head>: the rest of the document is never touched.
    past_head { print; next }
    tolower($0) ~ /<\/head[[:space:]]*>/ { past_head = 1; print; next }

    # Inside the head: the markers from an earlier run are dropped on sight...
    $0 ~ /<!--[[:space:]]*Google tag \(gtag\.js\)[[:space:]]*-->/ { next }
    $0 ~ /<!--[[:space:]]*End Google tag[[:space:]]*-->/ { next }

    # ...and the scripts themselves are dropped by what they contain, not by
    # where the markers sit, so a hand-pasted tag is caught too and nothing
    # between the markers is ever swallowed along with them. Each script
    # element is buffered and reprinted unless it turns out to be gtag. The
    # consent pattern is what catches the defaults block, which mentions
    # neither the loader URL nor gtag('js') -- without it a re-run would keep
    # the old defaults and add a second set below them.
    in_script {
      buf = buf "\n" $0
      if (tolower($0) ~ /<\/script[[:space:]]*>/) {
        in_script = 0
        if (!is_gtag(buf)) print buf
        buf = ""
      }
      next
    }
    tolower($0) ~ /<script([[:space:]>]|$)/ {
      buf = $0
      if (tolower($0) ~ /<\/script[[:space:]]*>/) {
        if (!is_gtag(buf)) print buf
        buf = ""
      } else in_script = 1
      next
    }

    { print }

    END {
      # An unterminated script element is passed through rather than swallowed.
      if (in_script && buf != "") print buf
      if (!done) exit 1
    }
  ' "$file" > "$tmp" || status=$?

  if [ "$status" -eq 1 ]; then
    echo "skip:      $rel (no <head> found)"
    rm -f "$tmp"; tmp=""
    skipped=1
    continue
  elif [ "$status" -ne 0 ]; then
    echo "error:     $rel (awk exited $status)" >&2
    exit 1
  fi

  if cmp -s "$tmp" "$file"; then
    echo "unchanged: $rel"
    rm -f "$tmp"; tmp=""
    continue
  fi

  if grep -q "googletagmanager\.com/gtag/js" "$file"; then
    action="replace:  "
  else
    action="add:      "
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    echo "${action}$rel (dry run)"
    rm -f "$tmp"; tmp=""
  else
    # Written to a temp file and moved into place, so a failure mid-run can
    # never leave a half-written page behind.
    perms="$(stat -f '%Lp' "$file" 2>/dev/null || stat -c '%a' "$file")"
    chmod "$perms" "$tmp"
    mv "$tmp" "$file"; tmp=""
    echo "${action}$rel"
  fi
done < <(find "$SITE" -name '*.html' -print0 | sort -z)

exit "$skipped"
