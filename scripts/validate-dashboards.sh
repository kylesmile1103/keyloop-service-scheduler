#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
grafana_root="$repo_root/observability/grafana"
python_bin="${GRAFANA_VALIDATION_PYTHON:-$grafana_root/.venv/bin/python}"

if [[ ! -x "$python_bin" ]]; then
  printf '%s\n' 'Install the validation requirements as described in observability/grafana/README.md.' >&2
  exit 1
fi
command -v gcx >/dev/null
# This command's help identifies it as a local resource linter. No remote validation.
gcx dev lint run --help >/dev/null
gcx dev lint run "$grafana_root/folders" "$grafana_root/dashboards" "$grafana_root/alertrules" -o compact
printf '%s\n' 'PASS: gcx built-in lint, 11 source manifests (no disabled rules).'
PYTHONDONTWRITEBYTECODE=1 "$python_bin" "$grafana_root/validation/validate.py" "$@"
# The Python check writes a temporary dashboard with alert PromQL targets because
# gcx's built-in PromQL rule only inspects dashboard targets, not alert expressions.
gcx dev lint run "$grafana_root/.validation/alert-queries.yaml" -o compact
printf '%s\n' 'PASS: gcx PromQL lint of alert query expressions.'
