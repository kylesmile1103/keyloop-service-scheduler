#!/usr/bin/env bash
# Deploy rehearsal: 30 concurrent bookings of one single-capacity slot must give exactly one 201 and 29 409s (ARCHITECTURE §14.4).
#
#   deploy/cloudflare/scripts/rehearse-contention.sh https://<host>
#
# Writes require an Access session with the ServiceAdvisor or Admin role. The script asks for that browser session's
# CF_Authorization cookie value without echoing it, keeps it only in a mode-600 curl config in a private temporary directory,
# and deletes that directory on exit; the value never appears in arguments, history or output. Customers are on example.com,
# which the API never emails. The winning booking is cancelled afterwards unless KEEP_WINNER=true. Needs curl, jq and uuidgen.
#
# Options (environment): CONTENDERS (default 30), DAY_OFFSET (first day searched, default 7), SEARCH_DAYS (default 14),
# DEALERSHIP_NAME (default "Keyloop Motors Reading"), SERVICE_CODE (default EV-BATTERY-CHECK), KEEP_WINNER (default false).
set -euo pipefail

base="${1:?Usage: $0 https://<host>}"
base="${base%/}"
contenders="${CONTENDERS:-30}"
day_offset="${DAY_OFFSET:-7}"
search_days="${SEARCH_DAYS:-14}"
dealership_name="${DEALERSHIP_NAME:-Keyloop Motors Reading}"
service_code="${SERVICE_CODE:-EV-BATTERY-CHECK}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
chmod 700 "$work"

if [ -t 0 ]; then
  printf 'CF_Authorization cookie value (input hidden): ' >&2
  IFS= read -rs cookie
  printf '\n' >&2
else
  IFS= read -r cookie
fi
[ -n "$cookie" ] || { echo "No cookie value given" >&2; exit 2; }
( umask 077; printf 'header = "Cookie: CF_Authorization=%s"\n' "$cookie" > "$work/auth.curlrc" )
unset cookie

api() { curl --silent --show-error --config "$work/auth.curlrc" "$@"; }

me="$(api --fail "$base/api/v1/me")"
roles="$(jq -r '.roles | join(",")' <<<"$me")"
case ",$roles," in
  *,ServiceAdvisor,*|*,Admin,*) ;;
  *) echo "This session cannot book (authenticated=$(jq -r .authenticated <<<"$me"), roles=[$roles])" >&2; exit 2 ;;
esac

dealership="$(curl --silent --show-error --fail "$base/api/v1/dealerships" | jq -er --arg name "$dealership_name" '.[] | select(.name == $name) | .id')"
service="$(curl --silent --show-error --fail "$base/api/v1/dealerships/$dealership/service-types" \
  | jq -er --arg code "$service_code" '.[] | select(.code == $code and .bookable) | .id')"

# The first slot with exactly one free bay and one free technician, so that only one contender can win it.
slot=""
for offset in $(seq "$day_offset" $((day_offset + search_days - 1))); do
  date="$(date -u -v+"${offset}"d +%F 2>/dev/null || date -u -d "+${offset} days" +%F)"
  slot="$(curl --silent --show-error --fail --get "$base/api/v1/dealerships/$dealership/availability" \
      --data-urlencode "serviceTypeId=$service" --data-urlencode "date=$date" \
    | jq -r '[.slots[] | select(.freeBays == 1 and .freeTechnicians == 1)][0].startUtc // empty')"
  [ -n "$slot" ] && break
done
[ -n "$slot" ] || { echo "No single-capacity slot in $search_days days from day +$day_offset" >&2; exit 2; }
echo "Contending for $slot ($date) with $contenders requests"

for i in $(seq 1 "$contenders"); do
  jq -n --arg service "$service" --arg start "$slot" --arg i "$i" '{
    serviceTypeId: $service, startUtc: $start,
    customer: {name: "Contention Rehearsal \($i)", email: "contention.\($i)@example.com", phone: "+44 7700 900123"},
    vehicle: {vin: "WVWZZZ1KZAW123456", registration: "AB12 CDE", make: "Volkswagen", model: "Golf"}
  }' > "$work/body-$i.json"
done
for i in $(seq 1 "$contenders"); do
  api --output "$work/response-$i.json" --write-out '%{http_code}' -X POST \
    -H 'Content-Type: application/json' -H "Idempotency-Key: $(uuidgen)" \
    --data-binary "@$work/body-$i.json" "$base/api/v1/dealerships/$dealership/appointments" > "$work/status-$i" &
done
wait

created=0 conflicts=0 other=0 winner=""
for i in $(seq 1 "$contenders"); do
  case "$(cat "$work/status-$i")" in
    201) created=$((created + 1)); winner="$(jq -r .id "$work/response-$i.json")" ;;
    409) conflicts=$((conflicts + 1)) ;;
    *) other=$((other + 1)); echo "Request $i: HTTP $(cat "$work/status-$i") $(jq -c '{type, title, status}' "$work/response-$i.json" 2>/dev/null)" >&2 ;;
  esac
done
echo "201: $created   409: $conflicts   other: $other"
cat "$work"/response-*.json | jq -rs '[.[] | select(.status == 409) | .type] | unique | .[]' 2>/dev/null | sed 's/^/409 type: /'

if [ -n "$winner" ] && [ "${KEEP_WINNER:-false}" != true ]; then
  api --fail --output /dev/null -X POST -H 'Content-Type: application/json' \
    --data '{"reason":"Contention rehearsal clean-up."}' "$base/api/v1/appointments/$winner/cancel"
  echo "Cancelled the winning booking $winner"
fi

if [ "$created" -eq 1 ] && [ "$conflicts" -eq $((contenders - 1)) ]; then
  echo "PASS: exactly one booking won"
else
  echo "FAIL: expected 1 x 201 and $((contenders - 1)) x 409" >&2
  exit 1
fi
