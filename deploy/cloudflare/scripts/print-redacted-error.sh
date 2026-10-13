#!/usr/bin/env bash
set -euo pipefail

# Print cf error lines to stderr with emails, account IDs, and long tokens redacted.
log=$1
excerpt=$(awk 'found || /[Ee]rror/ { found = 1; print }' "$log" 2> /dev/null || true)
if [[ -z "$excerpt" ]]; then
  echo '(cf printed no error line; reproduce locally with the runbook)' >&2
  exit 0
fi
printf '%s\n' "$excerpt" \
  | sed -E 's/[[:alnum:]._%+-]+@[[:alnum:].-]+/<email>/g; s/[0-9a-fA-F]{32,}/<id>/g; s/[A-Za-z0-9_-]{40,}/<redacted>/g' \
  | head -n 15 >&2
