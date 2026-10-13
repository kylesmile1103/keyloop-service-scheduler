#!/usr/bin/env bash
set -euo pipefail

# Run from the repository root. curl has no cookies/Access identity and uses a normal browser user agent.
: "${CLOUDFLARE_ACCOUNT_ID:?}"
: "${KEYLOOP_CONTAINER_APPLICATION_ID:?}"
: "${EXPECTED_VEHICLE_AWARE_REQUIREMENTS:?}"
sha=$(git rev-parse HEAD)
tag=${sha:0:12}
image="registry.cloudflare.com/$CLOUDFLARE_ACCOUNT_ID/keyloop-scheduler-api:$tag"
origin=https://keyloop.kylesmile.me
deadline=$((SECONDS + 360))
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
cf="$PWD/deploy/cloudflare/node_modules/.bin/cf"
check="$PWD/deploy/cloudflare/scripts/github-verification.mjs"

remaining() {
  local seconds=$((deadline - SECONDS))
  if ((seconds <= 0)); then
    echo 'Deployment verification exceeded its six-minute timeout.' >&2
    exit 1
  fi
  printf '%s' "$seconds"
}
get() {
  local path=$1 file=$2 seconds
  seconds=$(remaining)
  if ((seconds > 80)); then seconds=80; fi
  curl --silent --show-error --connect-timeout 10 --max-time "$seconds" \
    --user-agent 'Mozilla/5.0 (compatible; Keyloop deployment smoke check)' \
    --output "$file" --write-out '%{http_code}' "$origin$path"
}

# An API request wakes the singleton and reconciles its start options. Poll the actual instance image, not app config.
while true; do
  status=$(get /api/v1/dealerships "$scratch/dealerships.json") || status=000
  seconds=$(remaining)
  if timeout "$seconds" "$cf" containers applications instances list \
      --application-id "$KEYLOOP_CONTAINER_APPLICATION_ID" --state active \
      > "$scratch/instances.json" 2> "$scratch/cf-error.log"; then
    if node "$check" instances "$scratch/instances.json" "$image"; then
      [[ "$(get /api/ready "$scratch/ready")" == 200 ]] || {
        echo 'New image is running but schema readiness did not return 200.' >&2; exit 1;
      }
      [[ "$(get /api/v1/dealerships "$scratch/dealerships.json")" == 200 ]] || {
        echo 'New image is running but dealerships did not return 200.' >&2; exit 1;
      }
      break
    else
      result=$?
      [[ "$result" == 3 ]] || exit "$result"
    fi
  else
    echo 'Container instance inspection failed; check token permissions and application ID. API output withheld.' >&2
    exit 1
  fi
  echo "Waiting for image tag $tag and API readiness (HTTP $status)."
  seconds=$(remaining)
  if ((seconds > 10)); then seconds=10; fi
  sleep "$seconds"
done

[[ "$(get / "$scratch/index.html")" == 200 ]] || { echo 'SPA did not return 200.' >&2; exit 1; }
[[ "$(get /api/v1/features "$scratch/features.json")" == 200 ]] || { echo 'Features did not return 200.' >&2; exit 1; }
node "$check" features "$scratch/features.json" "$EXPECTED_VEHICLE_AWARE_REQUIREMENTS"
[[ "$(get /openapi/v1.json "$scratch/openapi.json")" == 200 ]] || { echo 'OpenAPI did not return 200.' >&2; exit 1; }
cmp -s "$scratch/openapi.json" contracts/openapi/v1.json || { echo 'Deployed OpenAPI differs from this commit.' >&2; exit 1; }
node "$check" dates "$scratch/dealerships.json" > "$scratch/schedule-paths"
masked=false
while IFS= read -r path; do
  [[ "$(get "$path" "$scratch/schedule.json")" == 200 ]] || { echo 'Anonymous schedule did not return 200.' >&2; exit 1; }
  if node "$check" schedule "$scratch/schedule.json"; then
    masked=true
    break
  else
    result=$?
    [[ "$result" == 3 ]] || exit "$result"
  fi
done < "$scratch/schedule-paths"
[[ "$masked" == true ]] || { echo 'No seeded appointments found: anonymous masking was not proven.' >&2; exit 1; }
printf 'PASS: image tag %s, schema readiness, API, SPA, feature flag, exact OpenAPI and non-empty anonymous masking.\n' "$tag"
