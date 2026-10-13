# Scheduler load and stress tests

These scripts use the committed [OpenAPI contract](../../../contracts/openapi/v1.json) and public `/api/v1` routes. They complement the [30-way PostgreSQL concurrency proof](../../Keyloop.ServiceScheduler.IntegrationTests/Concurrency/ConcurrentBookingTests.cs). The k6 proof checks HTTP outcomes and active appointments through the API; database constraints, audit rows, deadlocks and constraint-backstop counters remain integration-test assertions.

Bookings deliberately use `@example.invalid`, a reserved domain staged as `Suppressed` by the notification recipient policy. Load therefore never sends email. These scenarios exercise the atomic suppressed-outbox write, but leave Pending claims, rendering, provider sends, retries and delivery latency to notification integration tests.

Requires k6 2.1.0, .NET 10 and Docker for the local API, plus jq for `selftest.sh`. Run commands from the repository root. No remote JavaScript modules or extensions are downloaded. `run.sh` disables anonymous usage reporting, inherited metric outputs, tracing and the web dashboard. It reads the included config instead of personal k6 configuration. Local JSON and HTML reports are the default outputs.

## Isolated local stack

Use your own PostgreSQL container and API, with free port 5420. Do not use a running AppHost or another worktree's stack. The password below is a public disposable development value.

```bash
docker run -d --rm --name kl-k6-pg \
  -e POSTGRES_PASSWORD=devpass -e POSTGRES_DB=schedulerdb \
  -p 127.0.0.1::5432 postgres:17
docker port kl-k6-pg 5432/tcp
docker exec kl-k6-pg pg_isready -U postgres -d schedulerdb
```

Use the reported host port as `PG_PORT`. Start the API in another terminal:

```bash
PG_PORT=32818 # replace with your container's host port
ConnectionStrings__schedulerdb="Host=127.0.0.1;Port=$PG_PORT;Database=schedulerdb;Username=postgres;Password=devpass" \
ASPNETCORE_ENVIRONMENT=Development \
OTEL_SDK_DISABLED=true OTEL_EXPORTER_OTLP_ENDPOINT='' \
dotnet run --project src/Keyloop.ServiceScheduler.Api \
  --no-launch-profile --urls http://127.0.0.1:5420
```

Development migrates and seeds the catalogue and demo week. It permits 300 global requests/minute and 120 writes/minute per client IP. Booking and cancellation share the write limiter, including idempotent replays and rejected cancellations. All VUs normally share one IP. The limiter uses one-minute sliding windows with six segments and no queue. Leave time between runs or restart only your own API to reset its in-memory limiter. Building can regenerate `contracts/openapi/v1.json`; restore generated contract changes if they are outside your task.

When finished, stop your API with Ctrl+C, then `docker stop kl-k6-pg`. Never stop a container you did not start. The container is ephemeral; load-generated cancelled appointments and idempotency keys disappear with it.

## Small validation on a shared machine

Each command below uses at most 30 VUs and lasts less than 60 seconds with a healthy API. Run sequentially; do not combine arrival-rate scripts with contention. `K6_BIN=/opt/homebrew/bin/k6` selects the installed binary if it is absent from PATH. A k6 exit code of 0 means thresholds passed; 99 means a threshold failed; 108 means the run aborted, for example on a 429 under the Production preset. Keep the actual process exit code when collecting logs. The summary on stdout lists every threshold as PASS or FAIL, failures first.

`selftest.sh` needs no API. It uses `k6 inspect`, which evaluates options without running setup or sending requests, to check the BASE_URL and remote-approval guards, the Production rate ceiling and each profile's thresholds under both presets. Run it after changing a script.

```bash
tests/load/k6/selftest.sh
tests/load/k6/run.sh availability-read.js \
  -e RATE=60 -e RAMP_DURATION=1s -e HOLD_DURATION=8s -e GRACEFUL_STOP=1s
tests/load/k6/run.sh mixed-workload.js \
  -e RATE=60 -e DURATION=15s -e GRACEFUL_STOP=1s
tests/load/k6/run.sh soak.js \
  -e RATE=30 -e DURATION=20s -e GRACEFUL_STOP=1s
tests/load/k6/run.sh spike.js \
  -e RATE=180 -e WARM_DURATION=1s -e SPIKE_RAMP=1s \
  -e SPIKE_HOLD=5s -e RECOVERY_DURATION=3s -e GRACEFUL_STOP=1s
tests/load/k6/run.sh booking-contention.js \
  -e CONTENDERS=10 -e ROUNDS=5 -e ROUND_INTERVAL_SECONDS=8
tests/load/k6/run.sh booking-contention.js -e CONTENDERS=30 -e ROUNDS=1
```

The short soak validates its execution path; it does not establish long-term stability. The short spike stays below the default global quota, so it does not exercise the limiter; the full spike below does.

## Scenarios and thresholds

`RATE` always means iterations per minute, not requests per second. Each read iteration sends one availability query and one schedule query. Mixed/soak iterations follow a deterministic 60% availability, 20% booking lifecycle, 20% schedule mix. Each successful lifecycle performs eight requests: availability, booking, identical keyed retry, appointment read, cancellation, second cancellation, cancelled-appointment read and schedule read. There are four writes per lifecycle. This makes both reads and every lifecycle assertion reproducible in small runs.

| Profile | Development defaults | Production defaults | What the gate proves |
| --- | --- | --- | --- |
| availability-read | Ramp to 120/min, 30s ramp, 3m hold, 30s ramp down | 80/min with the same durations | Availability p95 < 100ms, schedule p95 < 200ms, both p99 < 500ms, unexpected status rate = 0, HTTP failure rate < 1%, throttled request rate <= 1%, no dropped iterations |
| booking-contention | 30 contenders, 5 rounds, 20s between round starts | 30 contenders, 5 rounds, 65s between round starts | Exactly one fresh 201 and N-1 valid slot conflicts in each round, unique participating VUs, start lag < 250ms, no 429/5xx, exactly one active appointment read back per slot |
| mixed-workload | 30/min for 5m | 10/min for 5m | Read p95/p99 as above, booking p95 < 150ms and p99 < 500ms; at least one completed replay/cancellation lifecycle; no booking of this run left for teardown to cancel; every check passes |
| soak | Mixed workload at 30/min for 30m | 10/min for 30m | The same gates across a sustained run; record memory, DB pool and server lock metrics separately if available |
| spike | 30/min for 15s, 1s rise, 360/min for 30s, 1m recovery | Peak 120/min, other timings unchanged | Development: admission control. Admitted (200) read p95 < 500ms and p99 < 1000ms, every 429 a valid `rate-limited` problem with matching Retry-After, no unexpected statuses or 5xx, <= 50% throttled requests; dropped iterations reported, not gated. Production: the same, any 429 aborts the run, and no dropped iterations |

All profiles require `checks: rate==1`, `server_errors: count==0`, `unexpected_statuses: rate==0` and `iterations: count>0`. Every profile except the Development spike also requires `dropped_iterations: count<=0`. Mixed and soak require positive `booking_success`, `replayed`, `cancelled`, `second_cancel_conflicts` and `lifecycle_completed` counts, so an entirely read-only run cannot pass. They also require `orphans_cancelled: count==0`: teardown reads the schedule for every booking date and cancels any appointment this run still holds, which happens only if a lifecycle was aborted or interrupted before its own cancellation. Read/booking latency thresholds select `phase:workload`, excluding discovery and teardown. The availability p95 of 100ms and booking p95 of 150ms are ARCHITECTURE section 4.2's targets, which that section states for single-dealership daily volumes; these profiles offer more. The schedule p95 and every p99 are local gate budgets with no design target, as are the looser spike limits for admitted requests under a burst. None of them is a claim about an unmeasured deployment.

Each request sets the stable OpenAPI operation id as both `endpoint` and `name`. HTTP expected-status callbacks accept only the successful or deliberate conflict statuses for that call, plus 429. Expected booking 409s and second-cancellation 409s do not raise `http_req_failed`. A 400, 404, 422, unexpected cancellation 409, redirect or transport failure fails the status/check gates. A valid 429 is tracked separately, with a validated `rate-limited` problem, trace id and matching integer `Retry-After`/`retryAfterSeconds`.

For normal requests, a VU that receives a 429 waits until Retry-After before it sends again and retries at most `RATE_LIMIT_RETRIES` times. Exhausted 429s remain visible in the rate metric. The cooldown is per VU by design: each VU models one client, and all VUs share the generator's IP like clients behind one NAT, so other VUs keep sending until they receive their own 429. k6 has no mutable state shared between VUs. The Production preset, which every remote run uses, does not rely on per-VU cooldowns: the first 429 outside setup and teardown aborts the whole test with exit code 108, so the IP stops sending. An abort skips in-flight cleanup, so the mixed and soak teardown cancels this run's leftover bookings, and every Production teardown first waits one 65s limiter window. Setup and teardown run alone in one VU and simply wait and retry.

A capped arrival-rate executor may run out of VUs while they wait, and then drops offered iterations. That fails the capacity gate in every profile except the Development spike. Its 360/min peak offers about 720 requests/min against the 300/min global quota, so throttling and dropped iterations are the expected outcome there, and the spike passes on a healthy API. A reduced run on a healthy local API (5s warm-up, the default 360/min peak held for 28s, 15s recovery) measured 24% throttled requests, all with valid Retry-After, and 43 dropped iterations, and exited 0. `MAX_DROPPED_ITERATIONS=0` restores the dropped-iteration gate, for example for the saturation run below. No rate limit is disabled by these scripts.

### Contention fixture and proof

Discovery reads dealerships, the bookable service catalogue, schedules and availability. By default it prefers Reading and `EV-BATTERY-CHECK`; the seed provides exactly one EV bay and one certified technician at Reading and Munich. GUIDs are never hardcoded. A different catalogue can use `DEALERSHIP_ID` and `SERVICE_CODE`. Preferred resources are hints in this API and cannot create single capacity; the script therefore verifies exactly one active qualified bay and technician before starting.

Setup finds non-overlapping slots where the service has exactly one qualified bay, that bay is free (`freeBays==1`, with at least one free qualified technician) and no active appointment overlaps it. The bay is the contended resource: every contender needs it, so exactly one can win however many technicians qualify. With vehicle-aware requirements on (Development), technicians qualify by HV level, and two can qualify for the EV check. It reserves one full alternative per day so later rounds still have suggestions. Dates start 14 days ahead, beyond the seeded demo week and Production lead time, and stay within the 90-day horizon. Normal reads include closed days. Booking lifecycles select open weekdays from dealership operating hours and fetch currently available slots before booking.

Each round is a separate `shared-iterations` scenario with N VUs and N iterations. VUs prepare distinct valid customers/VINs, then sleep until the same `scenario.startTime + GATE_MS` timestamp. A maximum start-lag threshold detects a missed release. Since shared iterations are not guaranteed to be evenly distributed, a VU taking a second iteration fails the unique-participant gate. Round counts prevent one round's extra successes from compensating for another's missing winner. Odd rounds omit idempotency keys; even rounds use a distinct key per contender.

Losers must return 409 `slot-unavailable` or `slot-conflict`, problem JSON, a trace id and non-empty suggestions that exclude the requested start. A 429 is never retried as a contention booking; it fails the exact outcome gate. Teardown queries GetWorkshopSchedule and GetAppointment, checks exactly one active overlapping appointment across the qualified bay/technician and verifies its interval, service, resources and run-specific customer. It then cancels only this run's winners. Under the Production preset, teardown first waits 65s, which leaves write-quota room for cleanup and lets the Retry-After of an aborting 429 expire. Use an isolated fixture with no other writers for the strict proof.

## Configuration

| Variable | Default / meaning |
| --- | --- |
| BASE_URL | `http://127.0.0.1:5420`, origin only, no `/api/v1` suffix or credentials; `127.0.0.1`, `localhost` and `[::1]` count as local |
| RATE_LIMIT_ENV | `Development` or `Production`; generator presets, not server configuration |
| DEALERSHIP_ID, SERVICE_CODE | Optional API catalogue selection; defaults above |
| DAY_OFFSET, SEARCH_DAYS | 14 and 14; discovery days, bounded inside the booking horizon |
| RATE | Profile iteration rate/minute; Production ceiling 120 for reads/spike, 25 for mixed/soak |
| PREALLOCATED_VUS, MAX_VUS | 10 and 30 for arrival-rate profiles |
| REQUEST_TIMEOUT, RATE_LIMIT_RETRIES | `10s` and 2; retry only 429, preserve the original booking body/key |
| MAX_RATE_LIMIT_RATE | Default 0.01, contention 0, spike 0.5; fraction of raw HTTP attempts throttled |
| MAX_DROPPED_ITERATIONS | Default 0, except the Development spike, which reports dropped iterations without a gate; setting it gates every profile at that count |
| CONTENDERS, ROUNDS | 30 and 5; exact per-round contention expectations, Production max 30 contenders |
| ROUND_INTERVAL_SECONDS | 20 Development, 65 Production; Production minimum 65 |
| GATE_MS, START_TOLERANCE_MS | 1000 and 250; common release offset and maximum dispatch lag |
| DURATION, GRACEFUL_STOP | Mixed/soak duration; arrival-rate drain allowance |
| RAMP_DURATION, HOLD_DURATION | Availability stage durations |
| BASE_RATE, WARM_DURATION, SPIKE_RAMP, SPIKE_HOLD, RECOVERY_DURATION | Spike stage controls; defaults in the table |
| SUMMARY_DIR | Runner defaults to this directory's ignored `results/`; create custom directories when invoking k6 directly |
| K6_BIN | Runner's executable, default `k6` |

Each profile writes `<profile>.json` and a standalone `<profile>.html`. Use separate `SUMMARY_DIR` values to retain successive runs. Reports contain metrics, checks and each threshold's PASS/FAIL verdict, not request bodies or customer records. Always retain the k6 exit code as the authoritative verdict.

The runner uses `--new-machine-readable-summary=false` on k6 2.1.0 because its new format omits endpoint submetrics, p99 and threshold verdicts. `handleSummary` also accepts the new `results.metrics[]` format if explicitly selected, but that format has less evidence and the summary then says it has no threshold verdicts. This flag is separate from the removed `--summary-mode=legacy`. See the official [v2 migration guide](https://grafana.com/docs/k6/latest/get-started/migrating-to-v2/) and [custom summary documentation](https://grafana.com/docs/k6/latest/results-output/end-of-test/custom-summary/).

## Full controller gate

Run these on a dedicated local stack when timing-sensitive work has finished, retaining reports and exit codes for every command. Each should pass on a healthy Development API with the default limits, including the spike, which throttles and drops iterations by design (see above), so any non-zero exit code is a finding:

```bash
tests/load/k6/run.sh availability-read.js
tests/load/k6/run.sh booking-contention.js
tests/load/k6/run.sh mixed-workload.js
tests/load/k6/run.sh soak.js
tests/load/k6/run.sh spike.js
```

For a separate saturation gate, start a fresh isolated Development API with `Security__RateLimiting__GlobalPermitsPerMinute=12000` and `Security__RateLimiting__BookingPermitsPerMinute=1500`, then run:

```bash
tests/load/k6/run.sh availability-read.js -e RATE=3000 -e HOLD_DURATION=5m
tests/load/k6/run.sh mixed-workload.js -e RATE=600 -e DURATION=5m
tests/load/k6/run.sh spike.js -e RATE=6000 -e SPIKE_HOLD=30s -e MAX_DROPPED_ITERATIONS=0
```

Those overrides separate API capacity from admission control and apply only to that disposable local stack. Record them with the results. Do not infer a sustainable production throughput from a throttled Development run or a short validation. The saturation gate has not been run. The full controller gate above was run on 2026-10-13 against a dedicated local stack (the API built in Release at commit c0e2a52, Development with its seeded week and default limits, a throwaway PostgreSQL 17 container, k6 on the same machine); every profile exited 0:

| Profile | Duration | Result |
|---|---|---|
| availability-read | 236 s | 856 requests; availability p95 20.3 ms (p99 46.1), schedule p95 7.2 ms (p99 25.5); no throttling, no dropped iterations, no 5xx |
| booking-contention | 81 s | 5 rounds of 30 contenders: exactly one 201 and 29 `slot-unavailable` conflicts per round, start lag under 250 ms, each winner read back; no 429, no 5xx |
| mixed-workload | 300 s | 374 requests, 30 complete booking lifecycles; booking p95 28.1 ms (p99 71.2), availability p95 19.1 ms, schedule p95 14.1 ms; no 5xx |
| soak | 1800 s | 2,174 requests, 180 complete lifecycles; booking p95 27.0 ms (max 36), availability p95 18.7 ms, schedule p95 14.1 ms; no 5xx, no orphaned bookings |
| spike | 105 s | 611 requests; 19.6% throttled with Retry-After and 127 dropped iterations, by design (see above); admitted availability p95 18.3 ms; no 5xx |

These are local figures on one machine with the default Development limits, not a claim about the deployed demo.

## Remote approval and optional telemetry

Running against `https://keyloop.kylesmile.me` requires the stakeholder's explicit approval for cost, rate limits and Cloudflare abuse protection. A setting is an attestation that approval has already been obtained; the script cannot grant approval. Every non-loopback origin requires `REMOTE_APPROVED=true` and `RATE_LIMIT_ENV=Production`. Use actual Production server limits of 300 global requests/minute and 30 writes/minute per IP, an isolated approved fixture and only one profile at a time. Never raise those server limits or spoof forwarded client IPs. The Production generator ceilings leave quota headroom; `RATE_LIMIT_ENV` does not configure or verify the remote server.

Grafana Cloud k6 and OTLP exports are optional and disabled. Configure an existing authorized destination and credentials outside the repository; do not create resources or commit tokens. After separate authorization to transmit metrics, k6 v2 uses `k6 cloud run --local-execution` with a configured stack, or local `k6 run --out opentelemetry`. OTLP v2 uses `K6_OTEL_EXPORTER_PROTOCOL=http/protobuf`, not the former `K6_OTEL_EXPORTER_TYPE=http`. See [Cloud local execution](https://grafana.com/docs/k6/latest/results-output/real-time/cloud/) and [OpenTelemetry output](https://grafana.com/docs/k6/latest/results-output/real-time/opentelemetry/). The runner accepts an explicit `--out opentelemetry` flag for that opt-in use.

Client summaries cannot measure `scheduler.booking.lock_wait`, deadlocks, constraint backstops or Npgsql pool pressure. When an authorized existing local collector is available, correlate these server metrics with the tagged request latencies and record their distributions separately. No telemetry is sent by the default local setup.
