# Unified Service Scheduler

A dealership appointment needs a compatible service bay and a certified technician for its entire duration. This Keyloop Principal Engineer take-home implements that booking engine with .NET 10, vertical slices and a DDD domain, EF Core and PostgreSQL, plus a React dispatch board for demonstrating bookings, conflicts and cancellations. PostgreSQL owns the overlap invariant; Aspire provides the local application model and correlated telemetry. The backend is the evaluated deliverable, and the board is its demo harness.

**Optional booking intake triage:** the backend can suggest bookable services and a preferred local date using Jev through Cloudflare AI Gateway. Suggestions require human confirmation; manual availability and booking work independently. Triage defaults off. When it is on, the dispatch board's booking dialog offers it in its first step: describe the issue, get suggested services, and use one to fill in the service and day.

**Draft status, `TODO(final-gate)`:** the backend and frontend are integrated, including the Aspire web resource and a local Demo Compose rehearsal. The final clean-clone gate, coverage, screenshots, public deployment and CI run results remain pending.

## Prerequisites

- .NET SDK **10.0.100**, the version in [global.json](global.json), which allows `latestFeature` roll-forward.
- A Docker runtime for PostgreSQL, Testcontainers and Aspire. On macOS the project uses **Colima**: `colima start --cpu 4 --memory 6 --disk 40`, then `docker info`.
- **Node 22 and pnpm 12.9.1**. The web project's `packageManager` pins the version used by Aspire and CI. Check `node --version` and `pnpm --version` before starting.
- No Aspire workload is required. The 13.6.1 AppHost uses the CLI bundle, resolved through an installed Aspire CLI or the SDK's DNX download. `dotnet run` remains supported. For matching publish tooling, use `dotnet dnx --yes aspire.cli@13.6.1 -- publish` with the arguments below; the local 13.6.0 CLI also works with this AppHost.
- `curl`, `jq` and `uuidgen` for the examples below. Trust the development HTTPS certificate with `dotnet dev-certs https --trust` when using the HTTPS profile.

## Run everything

Run from the repository root:

```bash
dotnet tool restore
dotnet run --project src/Keyloop.ServiceScheduler.AppHost
```

The AppHost generates and persists the PostgreSQL password in its user secrets, starts PostgreSQL with a named data volume and pgweb, then starts the API after database readiness. Web is always in the model: `AddViteApp` installs dependencies with `pnpm install --frozen-lockfile`, waits for the API, and uses `API_HTTP` discovery for its Vite proxy. The API migrates and seeds in Development. See [environments and configuration](#environments-and-configuration) for the deployment differences.

Open the dashboard URL printed by the AppHost, including its login token. In **Resources**, use the `web` HTTP link for `/dispatch`, the `api` **Scalar API reference** link for `/scalar/v1`, and `pgweb` to inspect the database. Ports come from the running application model; use those links when setting `API_BASE` in the curl examples. Scalar supplies documented examples and an interactive request client. Avoid sharing dashboard tokens or displaying secrets in recordings.

The reference seed defines two dealerships, Reading (`Europe/London`) and München (`Europe/Berlin`), nine bays, nine technicians and ten services. Reading's EV Battery Health Check has one qualified bay and one high-voltage technician. The demo seeder creates the upcoming workshop week and skips elapsed starts; today's board can therefore be empty outside opening hours. Select Reading and a future open day when demonstrating bookings.

The API resource's **Reseed demo data** command replaces the demo dealerships' appointments and rebuilds the sample week. It is key-protected and excluded from OpenAPI. Its dashboard confirmation describes the data it deletes. Preserve the AppHost's stored database password alongside the persistent volume across restarts.

Open **Mailpit inbox** on the `mailpit` resource for local email capture. Aspire injects its SMTP endpoint into the API; seeded `@example.com` customers are suppressed. The Aspire smoke test books with a non-reserved recipient and verifies the captured message. UAT, Production and Demo leave email dispatch off by default.

For an isolated manual check, supply a temporary PostgreSQL password and `--AppHost:UsePersistentResources=false` after `--`; stop the AppHost afterwards. This avoids the developer's database volume and generated password default.

**`TODO(final-gate)`:** record the integrated startup result and add approved board/dashboard screenshots under `docs/media/`, in both themes and at the mobile and desktop QA viewports. No screenshot is embedded until that evidence exists.

## Optional booking intake triage

The backend exposes `GetBookingTriageStatus` (`GET /api/v1/booking-triage`) and `TriageBookingRequest` (`POST /api/v1/dealerships/{id}/booking-triage`, body `{ "description": "Brakes squeal, it's an EV, need it Thursday." }`). The response includes `suggest`, `confirm` or `no-match`, up to three bookable service candidates with probabilities and an optional local date. Confirm a service before requesting availability; the operation never books or stores the description. Disabled or unavailable suggestions return `503 triage-unavailable` and leave manual selection available. See [SYSTEM_DESIGN §8.10](docs/SYSTEM_DESIGN.md#810-booking-intake-triage).

On the dispatch board, the booking dialog's first step shows the intake only when the status says it is enabled: *Describe the issue*, *Suggest a service*, and the line "Suggestions by Jev (TypeSafe) via Cloudflare AI Gateway. Check before booking." Suggested services appear as cards marked *Likely* or *Possible* with their percentage and the equipment and certifications they need; *Use this* sets the service (and the day asked for, when that day is still to come and the workshop is open then), clears any start time already picked, and moves on to the free start times. Nothing is applied without that click. A failure shows the usual problem alert and leaves the service select as it was. *Copy the description into Notes* is ticked by default and never overwrites notes typed by hand; untick it to keep the description out of the booking. See [SYSTEM_DESIGN §15](docs/SYSTEM_DESIGN.md#15-dispatch-board-ui-harness).

An operator must first load Unified Billing credits, provision an account-scoped **Workers AI Read** token, and configure the `keyloop-scheduler` AI Gateway with log collection off and a rate limit. Only after that approval, the developer can run these two commands themselves (the placeholders are intentionally not credentials):

```bash
dotnet user-secrets set 'Parameters:cloudflare-account-id' '<32-hex-account-id>' --project src/Keyloop.ServiceScheduler.AppHost
dotnet user-secrets set 'Parameters:cloudflare-ai-token' '<workers-ai-read-token>' --project src/Keyloop.ServiceScheduler.AppHost
```

The AppHost passes `Triage__*` only when both optional parameters are present, and starts without them. Never put the token in appsettings. The four-second total timeout, 0.70 suggestion confidence, 0.10 candidate floor, 0.60 date confidence and 500-character limit are configurable in `Triage`; `Security:RateLimiting:TriagePermitsPerMinute` defaults to 10. Cloudflare container deployment uses `KEYLOOP_TRIAGE_ENABLED=false` by default, with optional account/gateway settings and the `keyloop_prod_ai_token` Secrets Store binding when enabled. Public enablement requires stakeholder approval.

All regular tests use a stub HttpMessageHandler. The 25-fixture `LiveAi` category is implemented but has never been run; it requires a separate stakeholder-approved run with `KEYLOOP_LIVE_AI=1` and both Triage environment settings, and writes `docs/media/triage-live-golden-set.md`. Ordinary integration verification excludes it with `--filter 'Category!=LiveAi'`. Vendor latency, accuracy and cost claims remain unverified.

## Run the tests

The .NET tests use xunit.v3 on **Microsoft.Testing.Platform**. Pass project paths with `--project`; use MTP's `--coverage` option when collecting coverage.

```bash
mkdir -p /tmp/kl15c
export TMPDIR=/tmp/kl15c
dotnet restore
dotnet build -c Release -warnaserror --no-restore

# Domain and application unit tests, no Docker dependency.
dotnet test --project tests/Keyloop.ServiceScheduler.UnitTests -c Release --no-build

# Real PostgreSQL integration tests, including contract and concurrency tests.
dotnet test --project tests/Keyloop.ServiceScheduler.IntegrationTests -c Release --no-build --filter "Category!=LiveAi"

# Adversarial concurrency proof only.
dotnet test --project tests/Keyloop.ServiceScheduler.IntegrationTests -c Release --no-build \
  --filter "FullyQualifiedName~Concurrency"

# Runtime/build-time OpenAPI parity and contract assertions only.
dotnet test --project tests/Keyloop.ServiceScheduler.IntegrationTests -c Release --no-build \
  --filter "Category=Contract"

# AppHost smoke tests, with Docker and the frontend prerequisites installed.
dotnet test --project tests/Keyloop.ServiceScheduler.AspireTests -c Release --no-build \
  --filter "Category=Aspire"

# Regenerate the committed contract without starting a database.
bash scripts/export-openapi.sh
git diff --exit-code contracts/

# Example MTP coverage invocation.
dotnet test --project tests/Keyloop.ServiceScheduler.UnitTests -c Release --no-build \
  --coverage --coverage-output-format cobertura --results-directory TestResults/unit
```

On macOS, an MTP named-pipe path can exceed the Unix socket limit when the checkout or temporary path is long. If the runner reports that error, select a shorter writable pipe directory, for example `TESTINGPLATFORM_PIPE_DIRECTORY=/tmp` for the test command. The groundwork's native-runner result did not establish MTP coverage; the integrated coverage run remains a final-gate requirement.

Frontend checks run in the web project:

```bash
cd src/Keyloop.ServiceScheduler.Web
pnpm install --frozen-lockfile
pnpm generate:api
git diff --exit-code -- src/api
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

The concurrency test's acceptance criterion is **five rounds of thirty simultaneous requests** for a dealership with one qualified resource pair: exactly **one 201 and twenty-nine 409**, no 5xx, no Error logs, no deadlock or constraint-backstop events, one active appointment and its history row, and no orphan history or idempotency rows. Further cases check distinct slots, measured queueing and independence between dealerships. These are required assertions, not final observed results. The lock-disabled comparison was performed as a scratch mutation probe; there is no product switch for disabling the lock.

Aspire smoke tests live in a separate project because the Aspire testing host needs reflection-based JSON while the API integration process deliberately disables it. CI runs `AspireTests` after installing the web dependencies. The fixture waits for both API and web health under one five-minute startup deadline, then checks `/api/v1/dealerships` through web for JSON and the exact seeded names. Cleanup stops within 30 seconds and always disposes; tests use a supplied password, session containers and no persistent mounts, with triage disabled.

The [CI workflow](.github/workflows/ci.yml) defines backend build/test/contract checks, NuGet vulnerability auditing, frontend client drift checks and a separate Aspire job. [Dependabot](.github/dependabot.yml) groups weekly dependency updates. **`TODO(final-gate)`:** record final unit, integration, concurrency, contract, Aspire and frontend totals, durations and coverage from the clean integrated checkout, plus the CI run result. Earlier branch totals are not submission totals.

## Try it with curl

Routes and body fields follow the [OpenAPI contract](contracts/openapi/v1.json). The cancellation route is present in Task 11's committed contract (`432ea96`); this tooling branch still contains the earlier contract. **`TODO(final-gate)`:** integrate the newer contract and rehearse this sequence against the running API, preserving its real status codes and problem payloads.

Set `API_BASE` to the API's plain-HTTP endpoint from the dashboard, without a trailing slash. Set `DATE` to a future open local date in Reading, in `yyyy-MM-dd` form and within the booking horizon. Using discovered ids and an offered UTC start avoids stale, hard-coded appointment dates.

```bash
export API_BASE='http://localhost:<api-http-port>'
export DATE='<future-open-local-date>'

DEALERSHIP_ID=$(curl -fsS "$API_BASE/api/v1/dealerships" |
  jq -er '.[] | select(.name == "Keyloop Motors Reading") | .id')
SERVICE_ID=$(curl -fsS "$API_BASE/api/v1/dealerships/$DEALERSHIP_ID/service-types" |
  jq -er '.[] | select(.code == "EV-BATTERY-CHECK" and .bookable) | .id')

# Availability uses a dealership-local date; booking uses the returned UTC instant.
AVAILABILITY=$(curl -fsS --get \
  "$API_BASE/api/v1/dealerships/$DEALERSHIP_ID/availability" \
  --data-urlencode "serviceTypeId=$SERVICE_ID" --data-urlencode "date=$DATE")
printf '%s\n' "$AVAILABILITY" | jq .
START_UTC=$(printf '%s\n' "$AVAILABILITY" | jq -er '.slots[0].startUtc')

BODY=$(jq -n --arg service "$SERVICE_ID" --arg start "$START_UTC" '{
  serviceTypeId: $service, startUtc: $start,
  customer: {name: "Alex Morgan", email: "alex.morgan@example.com", phone: "+44 7700 900123"},
  vehicle: {vin: "WVWZZZ1KZAW123456", registration: "AB12 CDE", make: "Volkswagen", model: "Golf"}
}')
BOOKING_KEY=$(uuidgen)

# Book: 201, an AppointmentResponse and Location: /api/v1/appointments/{id}.
BOOKING=$(curl -fsS -X POST \
  "$API_BASE/api/v1/dealerships/$DEALERSHIP_ID/appointments" \
  -H 'Content-Type: application/json' -H "Idempotency-Key: $BOOKING_KEY" --data "$BODY")
printf '%s\n' "$BOOKING" | jq .
APPOINTMENT_ID=$(printf '%s\n' "$BOOKING" | jq -er '.id')

# A different booking intention for the same capacity-one slot: 409 with suggestions.
curl -sS -i -X POST "$API_BASE/api/v1/dealerships/$DEALERSHIP_ID/appointments" \
  -H 'Content-Type: application/json' -H "Idempotency-Key: $(uuidgen)" --data "$BODY"

# The original key and body replay the stored 201, with Idempotent-Replayed: true.
curl -sS -i -X POST "$API_BASE/api/v1/dealerships/$DEALERSHIP_ID/appointments" \
  -H 'Content-Type: application/json' -H "Idempotency-Key: $BOOKING_KEY" --data "$BODY"

# Cancel: 200 with status Cancelled, releasing both resources.
curl -fsS -X POST "$API_BASE/api/v1/appointments/$APPOINTMENT_ID/cancel" \
  -H 'Content-Type: application/json' \
  --data '{"reason":"Customer called to reschedule."}' | jq .

# Read availability again: the released slot is available unless another caller took it.
curl -fsS --get "$API_BASE/api/v1/dealerships/$DEALERSHIP_ID/availability" \
  --data-urlencode "serviceTypeId=$SERVICE_ID" --data-urlencode "date=$DATE" | jq .
```

If `.slots[0]` is absent, inspect `unavailableReason` and choose another open date. On a day with later free capacity, the conflict carries `suggestedSlots`; a completely full day can have no suggestions. Normal contention is `https://api.keyloop.example/problems/slot-unavailable`; the database backstop is `https://api.keyloop.example/problems/slot-conflict`. Both use `application/problem+json` and carry `traceId`. These URIs are contract identifiers.

A second cancel returns `409 invalid-state-transition` with `currentStatus` and `attempted: "cancel"`; a stale concurrent update returns `409 concurrency-conflict`. Reusing a live key with a different body returns `422 idempotency-key-reuse`. Keep the same key across transport retries of one booking intention. A new unkeyed client request can allocate a second appointment when spare resources exist; the server's recovery id only protects retries inside the same request. To create a new booking after cancellation, use a new key rather than replaying the original success.

## Project layout

The integrated layout follows ADR-025:

```text
src/
  Keyloop.ServiceScheduler.Domain/          Pure aggregates, values and scheduling rules
    Common/, Catalog/, Dealerships/, Resources/, Scheduling/
  Keyloop.ServiceScheduler.Infrastructure/  Persistence and outbound adapters
    Persistence/             DbContext, migrations, configurations, queries, seeding and audit
    Notifications/           Outbox, dispatcher, email senders and validated options
    Serialization/           PersistenceJsonContext for audit/outbox JSON
    Telemetry/               Adapter logs and shared service meter
  Keyloop.ServiceScheduler.Api/
    Program.cs               Composition root and explicit registration
    Features/                Complete vertical slices: endpoint, validation, handler and mapping
    Common/                  HTTP contracts, problems, validation, options, JSON and request telemetry
  Keyloop.ServiceScheduler.AppHost/          Aspire application model
  Keyloop.ServiceScheduler.ServiceDefaults/  Health and OpenTelemetry defaults
  Keyloop.ServiceScheduler.Web/              React, generated HeyAPI client and board
tests/
  Keyloop.ServiceScheduler.UnitTests/
  Keyloop.ServiceScheduler.IntegrationTests/
  Keyloop.ServiceScheduler.AspireTests/
contracts/openapi/v1.json     Committed build-time API contract
docs/                        System design, plans and walkthrough
scripts/                     Contract export and AOT measurement
.github/                     CI and dependency updates
```

Api references Infrastructure and Domain; Infrastructure references Domain only; Domain has no project or package references. Handlers remain beside their endpoints and query `SchedulerDbContext` directly. There is no Service/Application project or repository layer. Unit architecture tests guard both the project files and the compiled assembly references.

AppHost, Web and AspireTests are integration targets for this draft, as described above. Generated client files are regenerated from OpenAPI; hand-written runtime configuration stays separate from them.

## Design summary

[SYSTEM_DESIGN.md](docs/SYSTEM_DESIGN.md) contains the domain, availability algorithm, C4 diagrams, trade-offs and ADRs. Availability shrinks each individual resource's free gaps by the full service duration before combining feasible starts; it does not pool short gaps across different technicians or bays. Allocation honours qualified free preferences, then chooses by surplus qualifications, daily load, ordinal name and id.

The concurrency model in [§7](docs/SYSTEM_DESIGN.md#7-concurrency-and-data-integrity), ADR-003 and ADR-004 is:

1. PostgreSQL stores a generated `tstzrange(start_utc, end_utc, '[)')`; adjacent appointments do not overlap.
2. Partial GiST exclusion constraints independently forbid overlapping bays and technicians in `Confirmed`, `CheckedIn` and `InProgress`.
3. A live matching idempotency key replays before rule or availability checks; mismatched fingerprints are refused.
4. Booking opens an explicit `READ COMMITTED` transaction and takes its dealership's transaction-scoped advisory lock before any write.
5. After the lock, it checks the request's minted id, rechecks the key, deletes an expired key row if needed, and reads the schedule using fresh statement snapshots.
6. It revalidates whole-duration resource availability and allocates a qualified bay and technician while holding that lock.
7. Appointment, history and any successful-response key are committed atomically; refusal paths roll back, and the lock ends with the transaction.
8. ADR-003 forbids a second lock or contended insert except the request's own key row; cross-dealership same-key waits cannot close a lock cycle.
9. Transient retries rerun the whole transaction using one request id; `verifySucceeded` and the in-lock id check recognise a lost commit acknowledgement.
10. State changes use `xmin` for first-writer-wins and `409 concurrency-conflict`; cancellation recovery takes a first-and-only row lock when settling an in-doubt commit.

`23P01` maps to `409 slot-conflict` and increments `scheduler.booking.constraint_backstop`. A `40P01` from booking `SaveChanges` is answered without retry and records warning event `1004` plus `scheduler.booking.deadlocks`; other transient strategy failures have the scope described in §7.4. The constraints remain the backstop for out-of-band writers. Per-dealership serialization trades maximum site throughput for a small, reviewable protocol; this README makes no measured throughput claim.

Post-commit audit notifications stay in doubt until a read settles the result. If retries are exhausted before that happens, the request can return `500 internal-error` even though a transaction committed, and its telemetry notification can be missing. The history row remains atomic with the appointment. Task 11 documents and tests this limit; the draft's final integration must retain those fixes.

## Environments and configuration

The environment model comes from [SYSTEM_DESIGN §10](docs/SYSTEM_DESIGN.md#10-environments-and-configuration). Deployment rows describe the specified target posture, not a completed deployment.

| Concern | Development | SystemTest | UAT | Production | Demo, local Compose only |
|---|---|---|---|---|---|
| PostgreSQL | Aspire, persistent volume | Testcontainers per session | Managed | Managed, HA | Compose |
| Migrations | API startup | Test fixture | Pipeline migration bundle | Pipeline migration bundle | API startup |
| Seed | Reference catalogue and demo week | Test-owned fixtures | Reference data through future DMS sync | None | Reference catalogue and demo week |
| Scalar/live OpenAPI | On | On | On behind network policy | Runtime mapping off | On |
| Lead time / horizon | 0 min / 90 days | 0 min / 90 days | 60 min / 90 days | 60 min / 90 days | 60 min / 90 days |
| Booking limit | 120/min/IP | Disabled | 30/min/IP | 30/min/IP | 30/min/IP |
| HTTPS / HSTS | Development certificate / off | Off | Ingress TLS / on | Ingress TLS / on | Plain HTTP / off |
| Telemetry | Aspire OTLP | In-memory test collectors | Platform collector | Platform collector | Compose dashboard for API; browser export off |
| Secrets | Aspire parameters and user secrets | Testcontainers credentials | Platform secret store | Platform secret store | Deployment inputs |

The shared production/UAT global rate limit is 300/min/IP. Every environment uses problems with `traceId`, without a developer exception page or exposed exception details. Production's runtime OpenAPI/Scalar mapping is disabled by `Program.cs`; the committed contract is the build artifact, and any internal ingress publication is deployment work.

Options come from `appsettings.json`, environment-specific files, Development user secrets and environment variables. Aspire injects `ConnectionStrings__schedulerdb` and telemetry settings. `[OptionsValidator]` and generated binding validate at startup before database work. Key settings are `Scheduling`, `Database:MigrateOnStartup`, `Database:SeedDemoData`, `Security:AllowedOrigins` and `Security:ForwardedHeaders`. UAT/Production deliberately enable forwarded headers with empty trusted-peer lists and refuse startup until the platform supplies `KnownProxies` or `KnownNetworks`; do not inherit broad private-network trust by accident.

The specified UAT/Production role is `scheduler_app`, with migrations performed as owner. Enforce audit-table and appointment-delete restrictions in the actual role grants. Authentication/authorization is deferred behind an explicit seam (ADR-010); the current harness is anonymous. Startup diagnostics were hardened by Task 18a to report members/indexes and safe path/type descriptions, with no raw configuration values.

### Publish a local Demo bundle

`aspire publish` generates Compose YAML and `.env`; it does not build images, populate secrets or create EF migration bundles. `aspire deploy --apphost src/Keyloop.ServiceScheduler.AppHost -o artifacts/compose` provides the managed build/deploy pipeline. The manual sequence below uses the committed Dockerfiles and an isolated project. Run it from the repository root with a fresh `keyloop-demo` project name:

```bash
# Disable persistent mounts for this disposable rehearsal; artifacts/ is git-ignored.
aspire publish --apphost src/Keyloop.ServiceScheduler.AppHost -o artifacts/compose \
  -- --AppHost:UsePersistentResources=false
docker build -f src/Keyloop.ServiceScheduler.Api/Dockerfile -t keyloop-scheduler-api:demo .
docker build -f src/Keyloop.ServiceScheduler.Web/Dockerfile -t keyloop-scheduler-web:demo src/Keyloop.ServiceScheduler.Web
export API_IMAGE=keyloop-scheduler-api:demo WEB_IMAGE=keyloop-scheduler-web:demo
export POSTGRES_PASSWORD="$(openssl rand -hex 24)"
# POSTGRES_USER can stay empty: Compose defaults it to scheduler.
docker compose --env-file artifacts/compose/.env -f artifacts/compose/docker-compose.yaml \
  -p keyloop-demo up -d
docker compose --env-file artifacts/compose/.env -f artifacts/compose/docker-compose.yaml \
  -p keyloop-demo port web 8080

# Set WEB_BASE to http://localhost:<reported-port>, then wait for the API's migration and seeding.
export WEB_BASE='http://localhost:<reported-port>'
curl --retry 30 --retry-delay 2 --retry-all-errors --max-time 5 -fsS \
  "$WEB_BASE/api/v1/dealerships" | jq .
curl -fsS -D - "$WEB_BASE/index.html" -o /dev/null
curl -fsS "$WEB_BASE/scalar/v1" -o /dev/null

# Stop this project, remove its anonymous volumes, and remove only these rehearsal images.
docker compose --env-file artifacts/compose/.env -f artifacts/compose/docker-compose.yaml \
  -p keyloop-demo down --volumes --remove-orphans
docker image rm keyloop-scheduler-api:demo keyloop-scheduler-web:demo
unset API_IMAGE WEB_IMAGE POSTGRES_PASSWORD WEB_BASE
```

The required manual inputs are `API_IMAGE`, `WEB_IMAGE` and `POSTGRES_PASSWORD`. Aspire emits `WEB_IMAGE` from the web Dockerfile and injects nginx's `API_UPSTREAM` from the API HTTP endpoint, rendered as `http://api:8080`. Web publishes a dynamic host port targeting 8080 and proxies `/api`, `/openapi` and `/scalar` with their URI unchanged. It serves the static app with CSP, frame protection, `nosniff`, referrer and permissions policies, and COOP. Browser dashboard credentials are excluded from production builds.

Demo creates `schedulerdb` on an empty data directory, migrates and seeds, and serves Scalar over plain HTTP. Its API trusts only `172.30.14.0/24`, matching the generated Compose network. The API stays unpublished because that trusted subnet includes the host-port bridge gateway; nginx supplies the trusted last forwarding hop. Never use or remove `keyloop-scheduler-pgdata` for verification. UAT/Production still require configured ingress trust and a separately generated EF migration bundle. Public deployment remains `TODO(deployment)`.

## Observability

Use the Aspire dashboard to follow an action from browser to SQL:

1. **Resources:** check PostgreSQL, API and web readiness; open pgweb and Scalar, inspect masked parameters, and use the demo reseed command.
2. **Traces:** book once, then inspect `scheduler.book_appointment`, `scheduler.acquire_dealership_lock`, `scheduler.compute_availability`, `scheduler.persist_appointment` and Npgsql spans. Look at `booking.outcome` and `lock.wait_ms`.
3. **Metrics:** compare `scheduler.booking.requests` by outcome, `scheduler.booking.duration` and `scheduler.booking.lock_wait`. The concurrency proof requires `scheduler.booking.deadlocks` and `scheduler.booking.constraint_backstop` to stay zero on its normal path.
4. **Structured logs:** filter by `AppointmentId`, `DealershipId` or request correlation. Expected conflicts have explicit events; unexpected API failures remain Error. EF's failed-commit `TransactionError` also stays Error.
5. **Browser correlation:** inspect `ui.book_appointment` and `ui.stress_test`, then follow same-origin `/api` propagation into backend spans. Browser OTLP credentials are exposed only by the Development dev server, never baked into a production build.

`/alive` is the process probe. Task 18a makes `/health` require connectivity and applied migrations in an isolated scope; deployment must retain that readiness check. Business time uses `TimeProvider`, while durations and queue waits use `Stopwatch`. See [§12](docs/SYSTEM_DESIGN.md#12-observability) for instrument names, correlation and proposed alert thresholds. **`TODO(final-gate)`:** attach the integrated trace/metric screenshots and real stress-run evidence; SLO targets in the design are not measured performance results.

### Grafana Cloud

**`TODO(grafana-cloud)`:** the post-deployment observability task plans Grafana Cloud OTLP export from the .NET container, credentials supplied through the platform secret store, dashboards as code managed with `gcx`, and alerts for booking faults and notification-outbox age. Browser telemetry needs a secret-free path, with Faro or a Worker relay to be decided. No dashboard URL, exporter configuration or alert deployment is claimed yet.

## Runtime reflection budget

The source-generation policy is [ADR-016 / §9.1](docs/SYSTEM_DESIGN.md#91-runtime-reflection-budget-and-nativeaot-readiness). Run:

```bash
scripts/aot-readiness.sh
```

The script forces a Release analyzer rebuild, preserves its build exit status and logs under `artifacts/aot-readiness/`, and deduplicates repeated diagnostics. CI uploads the informational **AOT readiness** artifact. This is analyzer evidence; `PublishAot` is not enabled.

| Concern | Implementation | Residual work |
|---|---|---|
| Request dispatch, JSON | Request Delegate Generator and Api `SchedulerJsonContext`; Infrastructure `PersistenceJsonContext` for audit/outbox JSON; reflection-based JSON disabled | Register every new wire/extension type; a missing registration fails instead of falling back |
| Mapping, binding, validation, logging, regex | Mapperly, configuration binder generator, `[OptionsValidator]`, `[LoggerMessage]`, `[GeneratedRegex]` | Maintain generated paths; typed TimeSpan checks replace converter-based annotation in Task 18a |
| Endpoint/handler/validator discovery | Explicit registry and DI registrations | No assembly scanning |
| Microsoft DI | Explicit registrations, framework container | Constructor discovery at startup, accepted in the budget |
| FluentValidation | Explicit validators | Expression compilation remains; reconsider only if the brief's requirement is lifted |
| EF Core | Runtime model and query translation, migrations in local/test environments | Evaluate compiled models and supported precompiled-query tooling; externalize migrations for an eventual AOT runtime |
| OpenAPI | Build-time document and XML-comment generation | Attribute reflection while generating a document outside Production; no production runtime document mapping |

The groundwork report at base `9f5a168` measured the following **historical baseline, `TODO(final-gate)`**:

| Origin | Historical diagnostic count, TODO(final-gate) | Call sites and removal path |
|---|---|---|
| Application-owned | 1 IL2026 | `SchedulingOptions`: `RangeAttribute(Type, string, string)` on TimeSpan. Task 18a commit `33b3c65` replaces it with typed inclusive-bound checks through the generated validator; integrate and remeasure |
| EF Core | 5: 1 IL2026 and 4 IL3050 | `SchedulerDbContext` constructor plus `DatabaseInitializer.GetPendingMigrationsAsync`, `GetMigrations`, `MigrateAsync`. Compiled-model/query evaluation and deployment-time migrations are the removal path, without a promise that compiled models alone remove the warnings |
| FluentValidation / other | 0 emitted | Absence from this analyzer output does not establish reflection-free dependencies or whole-program trim safety |

Task 18a's separate report records removal of the owned TimeSpan warning and an additional EF migration-readiness call site. **`TODO(final-gate)`:** rerun this script after all branches integrate and replace the baseline with the final warning catalogue, counts and artifact reference.

The DbContext, design-time factory and all existing migrations live in Infrastructure. Migration commands use Api as the startup project:

```bash
dotnet tool restore
dotnet ef migrations add <Name> --project src/Keyloop.ServiceScheduler.Infrastructure \
  --startup-project src/Keyloop.ServiceScheduler.Api --output-dir Persistence/Migrations
dotnet ef migrations has-pending-model-changes --project src/Keyloop.ServiceScheduler.Infrastructure \
  --startup-project src/Keyloop.ServiceScheduler.Api
dotnet ef migrations bundle --project src/Keyloop.ServiceScheduler.Infrastructure \
  --startup-project src/Keyloop.ServiceScheduler.Api
```

The documented compiled-model experiment is:

```bash
dotnet tool restore
dotnet ef dbcontext optimize --project src/Keyloop.ServiceScheduler.Infrastructure \
  --startup-project src/Keyloop.ServiceScheduler.Api \
  --output-dir Persistence/CompiledModels
```

It is intentionally deferred. A compiled model must be regenerated whenever the EF model changes; silently stale generated metadata is a correctness risk. Compiled models alone do not establish NativeAOT support, and query-generation tooling needs its own compatibility evaluation.

## Deployment

**`TODO(deployment)`:** the stakeholder intends to host the application at `keyloop.kylesmile.me` on Cloudflare after local completion, with static frontend hosting, Worker routing, a .NET container and PostgreSQL preserving the scheduling constraints and advisory locks. The recorded research ruling retains PostgreSQL rather than substituting D1, and uses Containers for the .NET API rather than assuming it executes directly in a Worker. Email delivery and Secrets Store integration precede rollout; the exact hosting, DNS and release configuration awaits the deployment tasks. No live URL or deployment command is asserted here.

## AI Collaboration Narrative

### Strategy and evidence

Claude **Fable 5.1** designed the architecture and written plan, following the stakeholder's design-first instruction. Claude **Opus 5.5** implemented and reviewed through subagent-driven development: task briefs, implementer reports, independent reviews, fix rounds and scoped re-reviews. The early runner/primitive work also used Sonnet-labelled agents in the ledger; git trailers attribute those earlier commits to Fable, so a trailer is not proof of the precise model behind every subagent. When the stakeholder requested parallel work, the controller created separate backend, concurrency and frontend lanes, with one implementer per worktree.

The prompts' durable specification was a task plan with reflection/AOT, OpenAPI/UI and Aspire addenda, plus a hand-off document carrying stakeholder intent and the raw narrative material; these are the author's local working notes and are not part of the repository, so the committed record of their decisions is the ADR table in [SYSTEM_DESIGN.md §18](docs/SYSTEM_DESIGN.md#18-architecture-decision-records). The private SDD ledger records dispatches, rulings, incidents and review outcomes. Git commit bodies and `Co-Authored-By` trailers provide a second record; branch-local implementation and final submission evidence are kept distinct.

At the stakeholder's request, **OpenAI Codex (gpt-6.1-sol)** took isolated delegations for CI/Dependabot, AOT measurement and the walkthrough (`37e31c0`, `e7e7b69`, `eb0d46f`), an adversarial review of the backend at `0ca96b1`, and the resulting Task 18a fixes (`0ce37bf` through `33b3c65`). Claude Opus then independently reviewed Codex's implementation, reversing the review direction. That review approved the fixes, with a minor observation about a scope-disposal test's claim still routed to integration. The fixes await integration in the ledger snapshot used for this draft.

Codex also produced original UI illustrations with OpenAI's image-generation tool and was delegated an Aspire audit against `dotnet/aspire-samples`, with recommendations assigned to Tasks 14c and 15c. **`TODO(aspire-audit)`:** record the completed audit, implemented recommendations and review outcome; the available ledger establishes its dispatch, not completion. The image tool did not expose its model identifier, so the coding model's name is not an image-model attribution.

Claude in Chrome researched Keyloop's public design language and product UI, including the Ownership/aftersales palette. A separate design workflow authored theme tokens and component recipes, then used contrast, build/render and brand/completeness checks to revise them. The approved theme selects Plus Jakarta Sans, IBM Plex Sans and IBM Plex Mono, changes inaccessible colour combinations, and uses a plain-text brand reference. Task 16 started before design sign-off, so Task 17 owns the adoption pass. This is a take-home demo inspired by Keyloop, with no claim of being an official product.

### Verification practices

Task reports record **RED before GREEN**, including behavioural failures for existing defects. Mutation probes remove guards, registrations, constraints or middleware to ask whether a test can actually fail. Characterization tests that were already green are identified as such rather than given an invented RED phase. Examples include exclusion-constraint removal, idempotency-order mutations, a lost-commit fault injector, independent availability-oracle checks and the HSTS removal probe.

Builds use warnings as errors; reflection-based JSON is disabled in both API and integration tests; mapping and contract drift checks catch generated-code omissions. Reviewers independently retraced the availability example and DST values, used scratch probes for faults, and requested fixes instead of weakening assertions. Mermaid diagrams were validated as part of the architecture work. Chrome checks exercised the real AppHost/dashboard, reseeding, cancellation, responsive layouts, themes and focus behavior. Task 17b's final visual QA and the clean-clone final gate remain **`TODO(final-gate)`**, as does the planned Fable whole-branch review. These practices provide evidence without claiming every planned gate has already run.

### Defects the process found

The first rows reproduce the substance of the hand-off notes' defect log; later rows extend it with the task reports, ledger and commit history. Outcomes describe recorded branch work, not a claim that every fix is already integrated.

| Where | Defect and discovery | Recorded outcome |
|---|---|---|
| Task 1 | Implementer/reviewer found VSTest incompatible with the selected xunit.v3 setup and obsolete coverage packages | Microsoft.Testing.Platform and native coverage flags; docs corrected (`c76fe9b`) |
| Task 2 | Reviewer found record `ToString` leaking the full VIN | Masked output and regression test (`e308e54`) |
| Task 3 | Implementer found contradictory DST ambiguity rules in the design | Earlier-instant rule documented; values independently checked (`3d000bd`) |
| Task 6 | Reviewer found observer failures could turn committed bookings into errors and trigger retries | Isolate and log post-commit observer failures (`73e62d9`) |
| Task 7 | Reviewer reproduced 429 becoming 500 when `Accept` excluded JSON | `TryWriteAsync` plus tests (`227f7a6`) |
| Task 7/8 | Reviewer found missing forwarded-header handling; re-review found partial array overrides could retain broad trust | Explicit trusted peers and fail-closed deployment defaults (`227f7a6`, `72d57ce`) |
| Task 8 | Reviewer found the active-technician filter had no effective regression test | Test fails when the filter is removed (`86e5d24`) |
| Task 9/10 | Local times lacked offsets; `zzz` on `DateTime` used the machine offset | Offset-bearing local strings through `DateTimeOffset` (`3c4b876`) |
| Task 10 plan | Controller found replay checked after availability, rejecting a client's own success | Key lookup before availability and again under the lock (`2a25835`) |
| Task 10 | Reviewer reproduced a second unkeyed appointment after a lost COMMIT acknowledgement | Stable request id, commit verification and in-lock guard (`c51ba9e`) |
| Task 10 | Implementer demonstrated REPEATABLE READ retaining the snapshot taken before waiting | Explicit READ COMMITTED retained and tested (`2a25835`, ADR-004) |
| Task 14a | Contract inspection found overwritten body descriptions, untyped string enums, missing traceId schema and incomplete 429/Retry-After documentation | Transformers, response metadata and parity tests (`da69f02`, `9f5a168`) |
| Task 11 / Codex M1 | Inconclusive booking-commit verification dropped events before the lock could settle them | Preserve the doubt until a conclusive read (`55ca317`) |
| Task 11 | Independent review found cancellation forgot an in-doubt commit after another transient fault | Request-lifetime written-version marker and fault-injection regression (`2c055e1`) |
| Codex I1 | Real validators and fallback startup logs leaked raw configuration values | Safe member/index and path/type diagnostics (`0ce37bf`) |
| Codex I2 | Accepted sub-minute hours produced availability starts rejected by booking | Whole-minute domain guards and additive database CHECK (`425a738`) |
| Codex I3 | Readiness reported healthy with an unmigrated database | Connectivity plus pending-migration check, with independent liveness (`acd2c01`, `5a3d23f`) |
| Codex I4 | Extreme UTC start overflowed to 500 before horizon validation | Bound the start before slot arithmetic, preserving replay order (`b987141`) |
| Codex I5 | Design falsely promised unkeyed client retries could never create another appointment | Corrected optional-key semantics and spare-capacity tests; stable UI key required (`2a50a8f`) |
| Codex I6 | Promised X-Request-Id echo and business log scopes were absent | Bounded UUID echo, CORS exposure, Activity tags and scopes (`85067a5`) |
| Codex I7 | Existing tests stayed green with HSTS removed | Non-loopback HTTPS deployment cases proven RED by middleware removal (`4641a08`) |
| Task 18 AOT | Analyzer found application-owned trim-sensitive TimeSpan validation | Typed inclusive bounds through the generated validator (`33b3c65`) |
| Frontend 15a/15b | Theme did not follow system changes, a lazy-import test was vacuous, and client generation could delete hand-written runtime config | Theme behavior tests, import-side-effect probe and `output.clean=false` (`19fdf75`, `773103a`) |
| Frontend 15b | A shared request-id setting reused one UUID for the session, and automatic dealership selection could cancel a pending sidebar navigation | Per-request interceptor and navigation-aware selection, with behavioural regressions (`773103a`) |

Task 18a was approved by Claude with the Important findings addressed. **`TODO(final-gate)`:** integrate its commits, resolve its minor scope-test claim, verify the UI's stable booking key, and reconcile any later review findings before finalizing this table.

### Rejections and trade-offs

- A mediator and assembly scanning were rejected in favor of direct handlers and explicit registration (ADR-001/016).
- Row locks as the primary booking guarantee, SERIALIZABLE retry storms and a single-writer application queue were rejected after comparing correctness, contention and operational cost. Exclusion constraints alone remain correct but can cause mutual waits; the advisory lock supplies the normal serialization path (§7.2/7.3).
- Replacing Microsoft's DI container with Jab/Pure.DI was rejected because swapping the hosting container added risk for limited gain. EF compiled models and `PublishAot` were deferred; they require more than suppressing warnings.
- Same-VIN or body-based deduplication was not added to disguise the unkeyed retry defect. Independent same-vehicle bookings remain valid; the optional-key contract stays explicit.
- MiroTalk's AGPL code was not copied. The MIT Vite template supplied reusable UI patterns; unrelated auth, chat, mail, landing, pricing and billing apps were excluded. Keyloop logos and proprietary images were excluded from the inspired theme.
- The product lock-disable switch was not added merely for a test. Scratch mutation evidence demonstrates the trade-off without introducing a production escape hatch.

### Process incidents and lessons

The ledger records a controller error: `SendMessage` to workflow implementers resumed duplicate agents in the same worktrees instead of reaching the intended running instances. Both backend twins ran AppHost work, and one cleared the persisted database password. It was restored from the running container and checked without displaying it. In the frontend lane, a stop message reached the original instance and blocked its workflow while the resumed twin later completed the board. A checkout-style sweep instruction could have discarded the original's uncommitted work; the ledger explicitly records that no checkout occurred and the files remained intact. The adopted rule is to communicate mid-run changes through briefs/global constraints and workflow results rather than that messaging path, and verify exclusive worktree ownership before destructive maintenance.

Separately, a hand-applied punctuation sweep collided with concurrent edits and corrupted ordinary text in `CLAUDE.md`. The repair waited for implementation commits, reapplied the exact character replacement deterministically to committed text, then rebuilt, regenerated contracts and tested before a separate style commit (`47fcb51`, `c156b83`, `a38342e`). The lesson is to avoid broad edits over an active implementer's files and validate the complete diff, not just the intended replacement. A killed frontend mutation run also left temporary mutants; the implementer restored and checked them before committing.

An earlier controller documentation commit polluted a task review range; the package was rebuilt to exclude it and later controller commits waited for implementation boundaries. These are process failures with recorded recovery, not examples of a flawless automated workflow. The final gate must still establish the integrated result.

## Video

The [video walkthrough guide](docs/VIDEO_WALKTHROUGH.md) gives the planned architecture, booking/conflict/cancel demo, concurrency proof, Aspire tour and AI collaboration segments. **`TODO(video)`:** rehearse against the final UI labels and resources, attach the recording link and actual duration, and include email/observability additions only when they have been verified.

## Licence and attribution

The dispatch board adapts the **MIT-licensed shadcn-dashboard-landing-template, Vite variant**, and MIT shadcn/ui primitives. Keep their copyright and permission notices; the upstreams are listed below. The frontend branch contains `src/Keyloop.ServiceScheduler.Web/THIRD-PARTY-NOTICES.md`, which lists copied source and its modifications. No repository-wide application licence is inferred from the template's licence.

Reference material, kept outside this repository (one level up, never committed):

| Reference | Upstream | Licence | Used for |
|-----------|----------|---------|----------|
| shadcn-dashboard-landing-template (vite-version) | https://github.com/shadcnstore/shadcn-dashboard-landing-template | MIT | App shell, `components/ui/*`, Tailwind v4 tokens, ESLint/TS config (vendored, "own your components") |
| carcareco | https://github.com/rene98c/carcareco | see upstream | Domain inspiration only (vehicle/work-order shape); no code copied |
| MiroTalk WEB (booking module) | https://github.com/miroslavpejic85/mirotalkwebrtc | AGPL-3.0 | Design inspiration only (availability model, DST handling, re-check-then-insert); **no code copied** |

The initial frontend uses Inter under **SIL Open Font License 1.1**. The approved design-system adoption selects **Plus Jakarta Sans, IBM Plex Sans and IBM Plex Mono**, also OFL fonts, with package-provided licence notices. Original illustrations and backdrops were generated for this project using OpenAI `image_gen.imagegen` via Codex, without third-party source images, logos or real people. The private `design/images/README.md` records prompts, refinements, alt text and provenance; no image-model version is asserted.

**`TODO(attribution)`:** after theme/assets integration, commit the shipped illustration provenance and OFL notices, reconcile `THIRD-PARTY-NOTICES.md` with the actual font packages and copied components, and add working links here. Record the author's application licence decision separately; do not label the entire repository MIT without an application licence file.
