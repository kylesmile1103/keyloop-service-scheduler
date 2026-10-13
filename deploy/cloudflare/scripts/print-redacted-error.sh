#!/usr/bin/env bash
set -euo pipefail

# Print cf's error message from a captured log to stderr with identifiers removed. Actions logs of this public
# repository are public, and the rest of the log can list private bindings, so only the lines from the first one that
# mentions an error are printed. GitHub masks each secret's whole value; this also removes what a whole-value mask
# misses, such as one address from a role list or an account ID inside a registry URL.
log=$1
excerpt=$(awk 'found || /[Ee]rror/ { found = 1; print }' "$log" 2> /dev/null || true)
if [[ -z "$excerpt" ]]; then
  echo '(cf printed no error line; reproduce locally with the runbook)' >&2
  exit 0
fi
printf '%s\n' "$excerpt" \
  | sed -E 's/[[:alnum:]._%+-]+@[[:alnum:].-]+/<email>/g; s/[0-9a-fA-F]{32,}/<id>/g; s/[A-Za-z0-9_-]{40,}/<redacted>/g' \
  | head -n 15 >&2
