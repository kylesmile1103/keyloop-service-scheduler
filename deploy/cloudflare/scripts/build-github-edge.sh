#!/usr/bin/env bash
set -euo pipefail

# Run from the repository root. No output is shared between jobs.
: "${CLOUDFLARE_ACCOUNT_ID:?Set CLOUDFLARE_ACCOUNT_ID}"
sha=$(git rev-parse HEAD)
tag=${sha:0:12}
export KEYLOOP_API_IMAGE="registry.cloudflare.com/$CLOUDFLARE_ACCOUNT_ID/keyloop-scheduler-api:$tag"
(
  cd src/Keyloop.ServiceScheduler.Web
  pnpm install --frozen-lockfile
  env -u VITE_OTEL_EXPORTER_OTLP_ENDPOINT -u OTEL_EXPORTER_OTLP_ENDPOINT -u VITE_API_BASE_URL pnpm build
)
(
  cd deploy/cloudflare
  npm ci --no-audit --no-fund
  mkdir -p build
  # Build output can contain role lists. Do not send it to the Actions log.
  if ! npm run build > build/github-build.log 2>&1; then
    echo 'Edge build failed; output withheld because the configuration contains private values.' >&2
    exit 1
  fi
)
