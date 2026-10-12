#!/usr/bin/env bash
# Offline checks of the origin guards and each profile's thresholds per preset.
# `k6 inspect` evaluates the init code and options only: no setup, no requests.
# Requires k6 and jq. Exit status 0 means every case passed.
set -uo pipefail

load_test_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
k6_bin="${K6_BIN:-k6}"
export K6_NO_USAGE_REPORT=true K6_AUTO_EXTENSION_RESOLUTION=false
failures=0
local_origin='http://127.0.0.1:5420'

inspect() { # <scenario.js> [k6 -e flags]; prints the options JSON
  local scenario="$1"; shift
  "$k6_bin" inspect --config "$load_test_dir/k6.config.json" "$@" "$load_test_dir/$scenario" 2>/dev/null
}

report() { # <ok> <description>
  if [ "$1" = 0 ]; then printf 'PASS %s\n' "$2"; else printf 'FAIL %s\n' "$2"; failures=$((failures + 1)); fi
}

accepts() { # <scenario.js> <description> [k6 -e flags]
  local scenario="$1" description="$2"; shift 2
  inspect "$scenario" "$@" >/dev/null; report $? "accepts $description"
}

refuses() { # <scenario.js> <description> [k6 -e flags]; init must throw (k6 exit 107)
  local scenario="$1" description="$2" status; shift 2
  inspect "$scenario" "$@" >/dev/null; status=$?
  [ "$status" = 107 ]; report $? "refuses $description (k6 exit $status)"
}

thresholds() { # <scenario.js> <description> <jq predicate on .thresholds> [k6 -e flags]
  local scenario="$1" description="$2" predicate="$3"; shift 3
  inspect "$scenario" -e BASE_URL="$local_origin" "$@" | jq -e ".thresholds | $predicate" >/dev/null
  report $? "$scenario $description"
}

accepts availability-read.js 'an IPv4 loopback origin' -e BASE_URL=http://127.0.0.1:5420
accepts availability-read.js 'localhost with a trailing slash' -e BASE_URL=http://localhost:5420/
accepts availability-read.js 'the bracketed IPv6 loopback' -e 'BASE_URL=http://[::1]:5420'
refuses availability-read.js 'credentials in BASE_URL' -e BASE_URL=http://user:secret@127.0.0.1:5420
refuses availability-read.js 'a path in BASE_URL' -e BASE_URL=http://127.0.0.1:5420/api/v1
refuses availability-read.js 'a path after an IPv6 host' -e 'BASE_URL=http://[::1]:5420/api/v1'
refuses availability-read.js 'an unapproved remote origin' -e BASE_URL=https://scheduler.example.invalid
refuses availability-read.js 'an approved remote origin with Development presets' \
  -e BASE_URL=https://scheduler.example.invalid -e REMOTE_APPROVED=true -e RATE_LIMIT_ENV=Development
refuses availability-read.js 'a Production read rate above 120/min' \
  -e BASE_URL="$local_origin" -e RATE_LIMIT_ENV=Production -e RATE=121

availability_p95='."http_req_duration{endpoint:GetAvailability,phase:workload}" == ["p(95)<100", "p(99)<500"]'
capacity='.dropped_iterations == ["count<=0"] and .rate_limited == ["rate<=0.01"]'
for scenario in availability-read.js mixed-workload.js soak.js; do
  thresholds "$scenario" 'holds availability to the SYSTEM_DESIGN 4.2 p95 of 100ms' "$availability_p95"
  thresholds "$scenario" 'gates dropped iterations and throttling' "$capacity"
done
for scenario in mixed-workload.js soak.js; do
  thresholds "$scenario" 'fails when teardown had to cancel a leftover booking' '.orphans_cancelled == ["count==0"]'
done
thresholds booking-contention.js 'allows no throttling and no dropped iterations' \
  '.rate_limited == ["rate<=0"] and .dropped_iterations == ["count<=0"]'
thresholds spike.js 'reports, not gates, dropped iterations in Development' \
  'has("dropped_iterations") | not'
thresholds spike.js 'allows at most half of the attempts to be throttled' '.rate_limited == ["rate<=0.5"]'
thresholds spike.js 'times admitted reads only' \
  '."http_req_duration{endpoint:GetAvailability,phase:workload,status:200}" == ["p(95)<500", "p(99)<1000"] and
   ."http_req_duration{endpoint:GetWorkshopSchedule,phase:workload,status:200}" == ["p(95)<500", "p(99)<1000"]'
thresholds spike.js 'gates dropped iterations under the Production preset' \
  '.dropped_iterations == ["count<=0"]' -e RATE_LIMIT_ENV=Production
thresholds spike.js 'gates dropped iterations when MAX_DROPPED_ITERATIONS is set' \
  '.dropped_iterations == ["count<=0"]' -e MAX_DROPPED_ITERATIONS=0

if [ "$failures" -ne 0 ]; then printf '%d self-test case(s) failed\n' "$failures"; exit 1; fi
printf 'All self-test cases passed\n'
