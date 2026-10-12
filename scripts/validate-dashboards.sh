#!/usr/bin/env bash
# Offline checks for observability/grafana. Never contacts Grafana.
# Arguments pass through to validate.py: --notification-source DIR, --allow-planned-gauges, --alerts-dir DIR.
# Tools: gcx (GCX overrides the command) and Prometheus 3.x promtool (PROMTOOL overrides it, for example a
# docker run command that mounts this repository at the same path).
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
grafana_root="$repo_root/observability/grafana"
python_bin="${GRAFANA_VALIDATION_PYTHON:-$grafana_root/.venv/bin/python}"

if [[ ! -x "$python_bin" ]]; then
  printf '%s\n' 'Install the validation requirements as described in observability/grafana/README.md.' >&2
  exit 1
fi
export PYTHONDONTWRITEBYTECODE=1
# The validator's own guards first: each must reject the defect it exists for.
"$python_bin" -m unittest discover -s "$grafana_root/validation" -p 'test_*.py'
printf '%s\n' 'PASS: validator self-tests.'
"$python_bin" "$grafana_root/validation/validate.py" "$@"
