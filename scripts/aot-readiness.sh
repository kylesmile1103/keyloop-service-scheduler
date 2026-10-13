#!/usr/bin/env bash
# Measures remaining trim/AOT analyzer warnings via an informational analysis build.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

output_dir="artifacts/aot-readiness"
build_log="$output_dir/build.log"
warnings_log="$output_dir/il-warnings.log"
unique_warnings_log="$output_dir/il-warnings-unique.log"
mkdir -p "$output_dir"

# Force compilation: an incremental build can otherwise report no analyzer findings.
build_command=(
  dotnet build src/Keyloop.ServiceScheduler.Api -c Release -t:Rebuild
  -p:IsAotCompatible=true -p:TreatWarningsAsErrors=false -warnAsMessage:none
)
printf 'AOT readiness analysis\nCommand: %s\n' "${build_command[*]}"
if "${build_command[@]}" > "$build_log" 2>&1; then
  build_status=0
else
  build_status=$?
fi

printf 'Build exit code: %s\nFull build log: %s\n' "$build_status" "$build_log"
if grep -E 'warning IL[0-9]{4}:' "$build_log" > "$warnings_log"; then
  # The build summary repeats diagnostics; preserve the raw log, count each finding once.
  sort -u "$warnings_log" > "$unique_warnings_log"
  printf '\nUnique warnings grouped by diagnostic (count, location, message):\n'
  uniq -c "$unique_warnings_log" | sort -rn
  printf '\nUnique findings by warning code:\n'
  sed -E 's/.*warning (IL[0-9]{4}):.*/\1/' "$unique_warnings_log" | sort | uniq -c | sort -rn
else
  grep_status=$?
  if [[ "$grep_status" -ne 1 ]]; then
    printf 'Could not extract IL diagnostics (grep exit %s).\n' "$grep_status" >&2
    exit "$grep_status"
  fi
  : > "$unique_warnings_log"
  printf '\nNo IL warnings were emitted.\n'
fi

# Keep real restore/compiler failures visible. Only the workflow makes this non-blocking.
if [[ "$build_status" -ne 0 ]]; then
  printf '\nAnalysis build failed; its full output follows:\n' >&2
  cat "$build_log" >&2
fi
exit "$build_status"
