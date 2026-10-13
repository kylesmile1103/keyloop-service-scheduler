#!/usr/bin/env bash
set -euo pipefail
: "${GITHUB_REPOSITORY:?}"
sha=$(git rev-parse HEAD)
main_sha=$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/main" --jq '.object.sha')
if [[ "$sha" != "$main_sha" ]]; then
  echo 'Refusing a stale or non-main commit. Run deployment for the current main after CI passes.' >&2
  exit 1
fi
