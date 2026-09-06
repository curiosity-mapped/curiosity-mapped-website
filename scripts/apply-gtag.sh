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
export GTAG_SNIPPET="$(cat <<EOF
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${GTAG_ID}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', '${GTAG_ID}');
</script>
<!-- End Google tag -->
EOF
)"

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
             s ~ /gtag\([\x27"]config[\x27"]/
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
    # element is buffered and reprinted unless it turns out to be gtag.
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
