#!/usr/bin/env bash
set -euo pipefail

load_test_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
scenario="${1:-}"
case "$scenario" in
  availability-read.js|booking-contention.js|mixed-workload.js|soak.js|spike.js) ;;
  *) printf 'Usage: %s <scenario.js> [k6 run flags]\n' "$0" >&2; exit 2 ;;
esac
shift
mkdir -p "${SUMMARY_DIR:-$load_test_dir/results}"

# Force local defaults even if a user's personal k6 config enables outputs.
# Explicit command-line outputs are opt-in. No remote JS or extensions needed.
export K6_NO_USAGE_REPORT=true K6_AUTO_EXTENSION_RESOLUTION=false K6_OUT=''
export K6_TRACES_OUTPUT=none K6_LOG_OUTPUT=stderr K6_WEB_DASHBOARD=false
export SUMMARY_DIR="${SUMMARY_DIR:-$load_test_dir/results}"
exec "${K6_BIN:-k6}" run --config "$load_test_dir/k6.config.json" \
  --no-usage-report --new-machine-readable-summary=false --traces-output=none \
  "$@" "$load_test_dir/$scenario"
