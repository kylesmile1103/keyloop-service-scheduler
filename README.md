# Unified Service Scheduler

A dealership appointment needs a compatible service bay and a certified technician for its entire duration. This Keyloop Principal Engineer take-home implements that booking engine with .NET 10, vertical slices and a DDD domain, EF Core and PostgreSQL, plus a React dispatch board for demonstrating bookings, conflicts and cancellations. PostgreSQL owns the overlap invariant; Aspire provides the local application model and correlated telemetry. The backend is the evaluated deliverable, and the board is its demo harness.

**Optional booking intake triage:** the backend can suggest bookable services and a preferred local date using Clef-flash through Cloudflare AI Gateway. Suggestions require human confirmation; manual availability and booking work independently. Triage defaults off. When it is on, the dispatch board's booking dialog offers it in its first step: describe the issue, get suggested services, and use one to fill in the service and day.

**Implementation status:** the backend, dispatch board, notifications, optional triage, Aspire web resource and offline edge/observability/load tooling are integrated. **`TODO(final-gate)`:** complete Task 17b Chrome QA, the final whole-branch review, the clean-clone verification with coverage and screenshots, and record a hosted CI run. Public deployment is a separate stakeholder gate.

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

Open the dashboard URL printed by the AppHost, including its login token: it runs on `https://scheduler.dev.localhost:17180`, and the browser-facing resources link as `<resource>-scheduler.dev.localhost:<port>` (for example `https://api-scheduler.dev.localhost:7180`). Browsers resolve every `*.localhost` name to loopback and the .NET 10 developer certificate covers `*.dev.localhost`; the same ports answer on plain `localhost`, which is the form to use from curl or other tools that do not resolve `*.localhost` names, and PostgreSQL's `tcp` and Mailpit's `smtp` links stay on `localhost`. Safari has been reported not to open `*.dev.localhost` addresses ([aspire#20228](https://github.com/microsoft/aspire/issues/20228)); use another browser or the `localhost` form there. In **Resources**, use the `web` HTTP link for `/dispatch`, the `api` **Scalar API reference** link for `/scalar/v1`, and `pgweb` to inspect the database. Ports come from the running application model; use those links when setting `API_BASE` in the curl examples. Scalar supplies documented examples and an interactive request client. Avoid sharing dashboard tokens or displaying secrets in recordings.

The reference seed defines two dealerships, Reading (`Europe/London`) and München (`Europe/Berlin`), nine bays, nine technicians and ten services. Reading's EV Battery Health Check has one qualified bay and one high-voltage technician. The demo seeder creates the upcoming workshop week and skips elapsed starts; today's board can therefore be empty outside opening hours. Select Reading and a future open day when demonstrating bookings.

The API resource's **Reseed demo data** command replaces the demo dealerships' appointments and rebuilds the sample week. It is key-protected and excluded from OpenAPI. Its dashboard confirmation describes the data it deletes. Preserve the AppHost's stored database password alongside the persistent volume across restarts.

Open **Mailpit inbox** on the `mailpit` resource for local email capture. Aspire injects its SMTP endpoint into the API; seeded `@example.com` customers are suppressed. The Aspire smoke test books with a non-reserved recipient and verifies the captured message. UAT, Production and Demo leave email dispatch off by default.

For an isolated manual check, supply a temporary PostgreSQL password and `--AppHost:UsePersistentResources=false` after `--`; stop the AppHost afterwards. This avoids the developer's database volume and generated password default.

### Try each role locally

Locally, who you are is configuration, not a sign-in: the AppHost runs the API with the Development identity `admin@keyloop.test` / Admin unless told otherwise, so there is no login page and nothing to sign out of. To see the board as another role, stop the AppHost and start it again with the role (the app's Settings > Account lists the same settings):

```bash
dotnet run --project src/Keyloop.ServiceScheduler.AppHost -- --Parameters:auth-development-roles=ServiceAdvisor --Parameters:auth-development-email=advisor@keyloop.test
dotnet run --project src/Keyloop.ServiceScheduler.AppHost -- --Parameters:auth-development-roles=Viewer
dotnet run --project src/Keyloop.ServiceScheduler.AppHost -- --Parameters:auth-development-roles=""   # signed out
```

Running the API on its own in Development, set `Auth__Development__Roles__0` to `Admin`, `ServiceAdvisor`, `Viewer` or an empty value (signed out), and optionally `Auth__Development__Email`; the Vite dev server (`pnpm dev`, with `API_HTTP` naming the API) needs nothing else.

| Role | Board and appointments list | Details sheet | Book, cancel, service suggestions | Resources |
|---|---|---|---|---|
| Signed out | names as initials, VINs as their last six characters, plates as `*******` | the masked card and a sign-in panel; the record is not requested | a "Sign in to book" prompt instead of the booking dialog | the 401 page |
| No role (signed in) | masked, as signed out | masked, with the reason | unavailable, with the reason on screen | the 403 page |
| Viewer | full | full record | unavailable: "Your role can view bookings but not change them." | read-only lists |
| Service advisor, Admin | full | full record | available | read-only lists (Admin-only editing is Task 30) |

Where a deployed build offers **Sign in** (the Access login, coming back to the same page, dealership and day) and **Sign out** (the hostname's Access logout), the development server shows **How to sign in**, which leads to those settings, and no Sign out. A refusal the UI did not foresee (a session that ended, a role removed) is answered once, with "Your session has ended" and Sign in for a `401` or "Your role doesn't allow that" for a `403`, and the app reads `/me` again; when the identity changes (or `/me` cannot be read, which counts as signed out at once), whatever the previous caller read is cleared and read again, an open details sheet closes, a booking being entered is discarded with a note saying so (unless the same email keeps a role that may book), and a write's answer that arrives afterwards is thrown away.

**`TODO(final-gate)`:** add Task 17b's approved board/dashboard screenshots under `docs/media/`, in both themes and at the mobile and desktop QA viewports, and record the final clean-clone startup. No screenshot is embedded until that evidence exists.

## Vehicle-aware allocation (Task 31a)

ADR-029 Phases 0 and 1 are implemented behind `Scheduling:VehicleAwareRequirements`, default **false in every environment**. The React booking UI remains the existing flow until Task 31b; use Scalar or API requests to try the new contract. In a disposable Development database, enable it with `Scheduling__VehicleAwareRequirements=true` on the API process. For an isolated whole-stack trial, temporarily set `Scheduling:VehicleAwareRequirements` to true in `appsettings.Development.json` in your own working tree and run:

```bash
dotnet run --project src/Keyloop.ServiceScheduler.AppHost -- --AppHost:UsePersistentResources=false --Parameters:postgres-password=local-vehicle-trial-password
```

Stop that AppHost afterwards and restore the false setting. The explicit temporary password and nonpersistent resources keep this trial separate from the developer volume and persisted secret. Run only one AppHost on the machine at a time.

Fresh Reading technicians have confirmed levels 1..3 through 2028-12-31. Every seeded service is bookable for an ICE declaration and for Unknown. `needsLiveDiagnosis: true` on an HV job returns `422 no-qualified-resources` with `minimumHvLevel: 4` and `firedRules`, because no seed technician has level 4. Existing databases are different: migration maps the old HV certification to level 3 **unconfirmed** and every other technician to level 0, and startup seeding preserves every existing technician, so with the flag on Unknown brake (level 2) and MOT (level 1) work at Reading would have no qualified technician. The *Reseed demo data* command (Admin and key protected) restores the seeded, confirmed levels of the seeded technicians whose level was never confirmed; a confirmed level and any technician outside the seed are left alone. The dated amendment in [ADR-029](docs/design/ADR-029-vehicle-aware-allocation.md) records the revised Reading story.

Resolve a VIN through protected `POST /api/v1/vehicle-profiles/resolve` with `{ "vin": "WVWZZZ1KZAW123456" }` in the **body**. It returns manufacturer `VOLKSWAGEN` with `VinDecoded` provenance; powertrain/class remain Unknown. No registry is called or identifier stored. Availability accepts `powertrain=BatteryElectric`, `manufacturer=VOLKSWAGEN`, `vehicleClass=Heavy` and optional `needsLiveDiagnosis=true`, never a VIN.

Booking keeps its existing vehicle fields and accepts `vehicle.profile: { "powertrain": "Ice", "declarationReason": "Engine checked at intake" }`. The server records Declared provenance, the authenticated actor and reason in private history. For a WMI/manufacturer discrepancy, for example declaring `BMW` against WVW, acknowledge with `conflictChoice: "UseDecoded"`; otherwise booking returns `422 vehicle-profile-conflict`. Decoded facts are retained. Booking/details return `allocation` with criterion, policy version, resolved HV minimum, fired rules, preferred hints and exclusion reason codes. Schedule technicians expose level, validity, confirmation and brand data when enabled, to callers with an API role only. Declaration text never goes to email or telemetry; public reads keep ADR-027 masking.

The flag-off response and canonical request JSON stay compatible, including existing idempotency keys. With the flag off, a booking with `needsLiveDiagnosis: true` or a `vehicle.profile`, and availability with any vehicle parameter, is refused with `422 vehicle-aware-requirements-disabled` (naming `rejectedFields`) rather than answered with the standard qualification. Brand specialist preference, continuity, warranty/OEM rules, Clef questions, registries, multi-technician booking and new UI are later tasks.

Read public `GET /api/v1/features` (`GetFeatures`) before showing vehicle-aware controls or sending their inputs. It returns exactly `{ "vehicleAwareRequirements": false }` or `{ "vehicleAwareRequirements": true }`, identical for every caller, with `Cache-Control: public, max-age=60, must-revalidate`. It follows the effective startup scheduling options: configuration changes need an API restart. Refresh discovery after `422 vehicle-aware-requirements-disabled`, which can follow a deployment while a read is still cached. The switch does not grant write or private-detail access.

## Optional booking intake triage

Clef-flash also evaluates optional photos of vehicles, warning lights or paperwork. Upload up to four PNG/JPEG/WebP photos (4 MiB each, 8 MiB total, 16 megapixels each) through `POST /api/v1/dealerships/{id}/booking-triage/images`, body `{ "contentType": "image/png", "base64": "..." }`, then include the returned `imageIds` with the description. Upload IDs are private, dealership-scoped and expire after one hour; storage deletes the photo within about another hour. Photos are stored and sent to Clef as uploaded, including embedded metadata such as GPS location. Uploads share the triage rate limit with evaluations (four new photos and one suggestion use five of the ten permits a minute) and, like evaluations, require Admin or ServiceAdvisor (ADR-027); the triage status read stays public. Production uses private R2 through the Container relay; local runs use a bounded transient store. PDF conversion is not included. The design is ADR-028, which supersedes the Jev decision (ADR-026).

The backend exposes `GetBookingTriageStatus` (`GET /api/v1/booking-triage`) and `TriageBookingRequest` (`POST /api/v1/dealerships/{id}/booking-triage`, body `{ "description": "Brakes squeal, it's an EV, need it Thursday." }`). The response includes `suggest`, `confirm` or `no-match`, up to three bookable service candidates with probabilities and an optional local date. Confirm a service before requesting availability; the operation never books or stores the description. Disabled or unavailable suggestions return `503 triage-unavailable` and leave manual selection available. See [ARCHITECTURE §8.10](docs/ARCHITECTURE.md#810-booking-intake-triage).

On the dispatch board, the booking dialog's first step shows the intake only when the status says it is enabled: *Describe the issue*, *Suggest a service*, and the line "Suggestions by Clef-flash via Cloudflare AI Gateway. Check before booking." Suggested services appear as cards marked *Likely* or *Possible* with their percentage and the equipment and certifications they need; *Use this* sets the service (and the day asked for, when that day is still to come and the workshop is open then), clears any start time already picked, and moves on to the free start times. Nothing is applied without that click. A failure shows the usual problem alert and leaves the service select as it was. *Copy the description into Notes* is ticked by default and never overwrites notes typed by hand; untick it to keep the description out of the booking. See [ARCHITECTURE §15](docs/ARCHITECTURE.md#15-dispatch-board-ui-harness).

An operator must first load Unified Billing credits, provision an account-scoped **Workers AI Read** token, and configure the `keyloop-scheduler` AI Gateway with authentication on (required for Unified Billing), log collection off, zero data retention on and a rate limit. Only after that approval, the developer can run these two commands themselves (the placeholders are intentionally not credentials):

```bash
dotnet user-secrets set 'Parameters:cloudflare-account-id' '<32-hex-account-id>' --project src/Keyloop.ServiceScheduler.AppHost
dotnet user-secrets set 'Parameters:cloudflare-ai-token' '<workers-ai-read-token>' --project src/Keyloop.ServiceScheduler.AppHost
```

The AppHost passes `Triage__*` only when both optional parameters are present, and starts without them. Never put the token in appsettings. The eight-second total timeout (raised from Jev's four seconds for Clef; latency with photos is still unmeasured), 0.5 suggestion confidence (calibrated on Clef-flash's live golden set; Jev used 0.95), 0.10 candidate floor, 0.60 date confidence and 500-character limit are configurable in `Triage`; `Security:RateLimiting:TriagePermitsPerMinute` defaults to 10. Cloudflare container deployment uses `KEYLOOP_TRIAGE_ENABLED=false` by default, with optional account/gateway settings and the `keyloop_prod_ai_token` Secrets Store binding when enabled. Public enablement requires stakeholder approval.

All regular tests use a stub HttpMessageHandler. The 25-fixture `LiveAi` category runs only with the stakeholder's approval, `KEYLOOP_LIVE_AI=1` and both Triage environment settings, and writes `docs/media/triage-clef-flash-golden-set.md`; ordinary integration verification excludes it with `--filter 'Category!=LiveAi'`. The previous Jev report, [`docs/media/triage-live-golden-set.md`](docs/media/triage-live-golden-set.md), is historical; The Clef-flash run (2026-10-12, text cases, no photos) chose the right service in 25/25, both relative dates, the German and injection cases and both out-of-scope `no-match`es; at the calibrated 0.5 threshold 21 clear requests come back as `suggest` and the vague one (confidence 0.19) as `confirm`; p50 736 ms, p95 1,787 ms, about 1,590 input tokens per triage. Photo cases are not yet measured. The first Jev run (2026-10-12) scored 24/25 at the original 0.70 threshold, with p50 430 ms, p95 860 ms and about 1,940 input tokens per triage; its one miss, a vague description, led to the 0.95 threshold, and the rerun at 0.95 scores 25/25 (ARCHITECTURE §14).

## Run the tests

The .NET tests use xunit.v3 on **Microsoft.Testing.Platform**. Pass project paths with `--project`; use MTP's `--coverage` option when collecting coverage.

```bash
mkdir -p /tmp/keyloop-tests
export TMPDIR=/tmp/keyloop-tests
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

Use a short `TMPDIR` because Microsoft.Testing.Platform's pipe path must stay under 104 bytes on macOS. The clean-clone coverage run remains a final-gate requirement.

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

The [CI workflow](.github/workflows/ci.yml) defines backend build/test/contract checks, NuGet vulnerability auditing, frontend client drift checks, Aspire smoke tests, API/web image builds, edge typechecks/tests/local builds, Grafana validator checks and offline k6 inspections/self-tests. [Dependabot](.github/dependabot.yml) groups weekly dependency updates. **`TODO(final-gate)`:** record final unit, integration, concurrency, contract, Aspire and frontend totals, durations and coverage from the clean integrated checkout, plus the CI run result. Earlier branch totals are not submission totals.

## Try it with curl

Routes and body fields follow the integrated [OpenAPI contract](contracts/openapi/v1.json), including cancellation and triage. **`TODO(final-gate)`:** rehearse this sequence against an isolated stack, preserving its real status codes and problem payloads.

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

AppHost, Web and AspireTests are integrated, as described above. Generated client files are regenerated from OpenAPI; hand-written runtime configuration stays separate from them.

## Design summary

[ARCHITECTURE.md](docs/ARCHITECTURE.md) contains the domain, availability algorithm, C4 diagrams, trade-offs and ADRs. Availability shrinks each individual resource's free gaps by the full service duration before combining feasible starts; it does not pool short gaps across different technicians or bays. Allocation honours qualified free preferences, then chooses by surplus qualifications, daily load, ordinal name and id.

The concurrency model in [§7](docs/ARCHITECTURE.md#7-concurrency-and-data-integrity), ADR-003 and ADR-004 is:

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

The environment model comes from [ARCHITECTURE §10](docs/ARCHITECTURE.md#10-environments-and-configuration). Deployment rows describe the specified target posture, not a completed deployment.

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

Options come from `appsettings.json`, environment-specific files, Development user secrets and environment variables. Aspire injects `ConnectionStrings__schedulerdb` and telemetry settings. `[OptionsValidator]` and generated binding validate at startup before database work. Key settings include `Auth:Mode`, `Auth:TeamDomain`, indexed `Auth:Audience`, external `Auth:Roles:{Admin,ServiceAdvisor,Viewer}`, and `Scheduling`, `Database:MigrateOnStartup`, `Database:SeedDemoData`, `Security:AllowedOrigins` and `Security:ForwardedHeaders`. UAT/Production deliberately enable forwarded headers with empty trusted-peer lists and refuse startup until the platform supplies `KnownProxies` or `KnownNetworks`; do not inherit broad private-network trust by accident.

The specified UAT/Production role is `scheduler_app`, with migrations performed as owner. Enforce audit-table and appointment-delete restrictions in the actual role grants. Authentication/authorization now uses Cloudflare Access and API roles ([ADR-027](docs/ADR-027.md)). Public reads mask customer names, VINs and registrations; booking, cancellation, triage evaluation and triage photo upload require Admin or ServiceAdvisor, appointment details require any API role, and reseed requires Admin plus its key. Development defaults to `admin@keyloop.test` / Admin; the app's sign-in controls follow `GET /me` (see [Try each role locally](#try-each-role-locally)). Startup diagnostics were hardened by Task 18a to report members/indexes and safe path/type descriptions, with no raw configuration values.

Development identity is switchable through optional AppHost arguments `--Parameters:auth-development-email=advisor@keyloop.test` and `--Parameters:auth-development-roles=ServiceAdvisor` (comma-separated for multiple roles; an empty string selects anonymous). No auth parameters or Access account are needed for the default run. `Auth:Mode=Development` fails outside Development; `None` is SystemTest-only and grants no write access. `GET /api/v1/me` discovers the current identity, roles and `/auth/login?returnTo=%2F` / `/cdn-cgi/access/logout` URLs. Navigate to the hosted Access flow; do not build a password form or store JWTs in browser storage. See the [operator checklist](deploy/cloudflare/README.md#access-login-and-api-roles-task-27) before deployment.

### Publish a local Demo bundle

`aspire publish` generates Compose YAML and `.env`; it does not build images, populate secrets or create EF migration bundles. `aspire deploy --apphost src/Keyloop.ServiceScheduler.AppHost -o artifacts/compose` provides the managed build/deploy pipeline. The manual sequence below uses the committed Dockerfiles and an isolated project. Run it from the repository root with a fresh `keyloop-demo` project name:

```bash
# Disable persistent mounts for this disposable rehearsal; artifacts/ is git-ignored.
aspire publish --apphost src/Keyloop.ServiceScheduler.AppHost -o artifacts/compose \
  -- --AppHost:UsePersistentResources=false
docker build -f src/Keyloop.ServiceScheduler.Api/Dockerfile -t keyloop-scheduler-api:demo .
docker build -f src/Keyloop.ServiceScheduler.Web/Dockerfile -t keyloop-scheduler-web:demo src/Keyloop.ServiceScheduler.Web
export API_IMAGE=keyloop-scheduler-api:demo WEB_IMAGE=keyloop-scheduler-web:demo
# Supply the approved Access issuer and application AUD outside this repository.
export ACCESS_TEAM_DOMAIN=https://YOUR-TEAM.cloudflareaccess.com ACCESS_AUDIENCE=YOUR-APPLICATION-AUD
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
unset API_IMAGE WEB_IMAGE POSTGRES_PASSWORD WEB_BASE ACCESS_TEAM_DOMAIN ACCESS_AUDIENCE
```

The required manual inputs are `API_IMAGE`, `WEB_IMAGE`, `POSTGRES_PASSWORD`, `ACCESS_TEAM_DOMAIN` and `ACCESS_AUDIENCE`. Demo validates Access configuration and has no Development bypass. Anonymous local Compose viewing works; authenticated use additionally needs an Access-compatible ingress and externally supplied role membership. Aspire emits `WEB_IMAGE` from the web Dockerfile and injects nginx's `API_UPSTREAM` from the API HTTP endpoint, rendered as `http://api:8080`. Web publishes a dynamic host port targeting 8080 and proxies `/api`, `/auth`, `/openapi` and `/scalar` with their URI unchanged. It serves the static app with CSP, frame protection, `nosniff`, referrer and permissions policies, and COOP. Browser dashboard credentials are excluded from production builds.

Demo creates `schedulerdb` on an empty data directory, migrates and seeds, and serves Scalar over plain HTTP. Its API trusts only `172.30.14.0/24`, matching the generated Compose network. The API stays unpublished because that trusted subnet includes the host-port bridge gateway; nginx supplies the trusted last forwarding hop. Never use or remove `keyloop-scheduler-pgdata` for verification. UAT/Production still require configured ingress trust and a separately generated EF migration bundle. Public deployment remains `TODO(deployment)`.

## Observability

Use the Aspire dashboard to follow an action from browser to SQL:

1. **Resources:** check PostgreSQL, API and web readiness; open pgweb and Scalar, inspect masked parameters, and use the demo reseed command.
2. **Traces:** book once, then inspect `scheduler.book_appointment`, `scheduler.acquire_dealership_lock`, `scheduler.compute_availability`, `scheduler.persist_appointment` and Npgsql spans. Look at `booking.outcome` and `lock.wait_ms`.
3. **Metrics:** compare `scheduler.booking.requests` by outcome, `scheduler.booking.duration` and `scheduler.booking.lock_wait`. The concurrency proof requires `scheduler.booking.deadlocks` and `scheduler.booking.constraint_backstop` to stay zero on its normal path.
4. **Structured logs:** filter by `AppointmentId`, `DealershipId` or request correlation. Expected conflicts have explicit events; unexpected API failures remain Error. EF's failed-commit `TransactionError` also stays Error.
5. **Browser correlation:** inspect `ui.book_appointment` and `ui.booking_triage`, then follow same-origin `/api` propagation into backend spans. Browser OTLP credentials are exposed only by the Development dev server, never baked into a production build.

`/alive` is the process probe. `/health` requires connectivity and applied migrations in an isolated scope; deployment must retain that readiness check. Business time uses `TimeProvider`, while durations and queue waits use `Stopwatch`. See [§12](docs/ARCHITECTURE.md#12-observability) for instrument names, correlation and proposed alert thresholds. **`TODO(final-gate)`:** attach the integrated trace/metric screenshots and real stress-run evidence; SLO targets in the design are not measured performance results.

### Grafana Cloud

**`TODO(grafana-cloud)`:** configure the .NET container's OTLP export with platform-managed credentials, verify metric translation against deployed data, publish the committed dashboards and runbooks, and prepare alerts for an approved contact point. The optional secret-free browser Worker relay and [dashboards as code](observability/grafana/README.md) are implemented and validated locally; enabling export and publishing Grafana resources remain pending.

## Runtime reflection budget

The source-generation policy is [ADR-016 / §9.1](docs/ARCHITECTURE.md#91-runtime-reflection-budget-and-nativeaot-readiness). Run:

```bash
scripts/aot-readiness.sh
```

The script forces a Release analyzer rebuild, preserves its build exit status and logs under `artifacts/aot-readiness/`, and deduplicates repeated diagnostics. CI uploads the informational **AOT readiness** artifact. This is analyzer evidence; `PublishAot` is not enabled.

| Concern | Implementation | Residual work |
|---|---|---|
| Request dispatch, JSON | Request Delegate Generator and Api `SchedulerJsonContext`; Infrastructure `PersistenceJsonContext` for audit/outbox JSON; reflection-based JSON disabled | Register every new wire/extension type; a missing registration fails instead of falling back |
| Mapping, binding, validation, logging, regex | Mapperly, configuration binder generator, `[OptionsValidator]`, `[LoggerMessage]`, `[GeneratedRegex]` | Maintain generated paths; typed TimeSpan checks have replaced converter-based annotation (`533b1e0`) |
| Endpoint/handler/validator discovery | Explicit registry and DI registrations | No assembly scanning |
| Microsoft DI | Explicit registrations, framework container | Constructor discovery at startup, accepted in the budget |
| FluentValidation | Explicit validators | Expression compilation remains; reconsider only if the brief's requirement is lifted |
| EF Core | Runtime model and query translation, migrations in local/test environments | Evaluate compiled models and supported precompiled-query tooling; externalize migrations for an eventual AOT runtime |
| OpenAPI | Build-time document and XML-comment generation | Attribute reflection while generating a document outside Production; no production runtime document mapping |

The groundwork report at base `9f5a168` measured the following **historical baseline, `TODO(final-gate)`**:

| Origin | Historical diagnostic count, TODO(final-gate) | Call sites and removal path |
|---|---|---|
| Application-owned | 1 IL2026 | `SchedulingOptions`: `RangeAttribute(Type, string, string)` on TimeSpan. Task 18a commit `533b1e0` replaces it with typed inclusive-bound checks through the generated validator; remeasure the integrated build |
| EF Core | 5: 1 IL2026 and 4 IL3050 | `SchedulerDbContext` constructor plus `DatabaseInitializer.GetPendingMigrationsAsync`, `GetMigrations`, `MigrateAsync`. Compiled-model/query evaluation and deployment-time migrations are the removal path, without a promise that compiled models alone remove the warnings |
| FluentValidation / other | 0 emitted | Absence from this analyzer output does not establish reflection-free dependencies or whole-program trim safety |

The owned TimeSpan warning is removed; the integrated readiness check adds an EF migration-readiness call site. **`TODO(final-gate)`:** rerun this script on the final clean clone and replace the historical baseline with its warning catalogue, counts and artifact reference.

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

**`TODO(deployment)`:** provision the approved Neon PostgreSQL, Secrets Store inputs, DNS and Cloudflare resources, publish an API image, and rehearse sleep/wake, forwarding trust and controlled email delivery with the stakeholder. The [edge implementation and deployment runbook](deploy/cloudflare/README.md) are committed; [ADR-022..024](docs/ARCHITECTURE.md#18-architecture-decision-records) define Worker/static assets, the .NET Container, PostgreSQL and the credential boundary. The hostname `keyloop.kylesmile.me` is the intended target, with rollout still pending.

## AI Collaboration Narrative

### Strategy and evidence

Claude **Fable 5.1** designed the architecture and written plan, following the stakeholder's design-first instruction. Claude **Opus 5.5** implemented and reviewed through subagent-driven development: task briefs, implementer reports, independent reviews, fix rounds and scoped re-reviews. The early runner/primitive work also used Sonnet-labelled agents in the ledger; git trailers attribute those earlier commits to Fable, so a trailer is not proof of the precise model behind every subagent. When the stakeholder requested parallel work, the controller created separate backend, concurrency and frontend lanes, with one implementer per worktree.

The prompts' durable specification was a task plan with reflection/AOT, OpenAPI/UI and Aspire addenda, plus a hand-off document carrying stakeholder intent and the raw narrative material; these are the author's local working notes and are not part of the repository, so the committed record of their decisions is the ADR table in [ARCHITECTURE.md §18](docs/ARCHITECTURE.md#18-architecture-decision-records). The private SDD ledger records dispatches, rulings, incidents and review outcomes. Git commit bodies and `Co-Authored-By` trailers provide a second record; branch-local implementation and final submission evidence are kept distinct.

At the stakeholder's request, **OpenAI Codex (gpt-6.1-sol)** took isolated delegations for CI/Dependabot, AOT measurement and the walkthrough (`5cdebea`, `dfc9493`, `a098a67`), an adversarial review of the backend at `0ca96b1`, and the resulting Task 18a fixes (`cdc2e96` through `533b1e0`). Claude Opus then independently reviewed Codex's implementation, reversing the review direction. That review approved the fixes, with a minor observation about a scope-disposal test's claim still routed to integration. The fixes are integrated; the scope-disposal assertion is now covered in `RequestCorrelationTests`.

Codex also produced original UI illustrations with OpenAI's image-generation tool and audited Aspire against `dotnet/aspire-samples`. The audit recommendations assigned to Task 14c are integrated in `a85d501` and `bc462ec` (Demo initialization, CLI bundle and validated proxy/network trust). Task 15c is integrated in `a574af9` and `ec455c3` (web publication with discovered upstream and port 8080, exact seeded JSON through Vite and CI web installation). The image tool did not expose its model identifier, so the coding model's name is not an image-model attribution.

Claude in Chrome researched Keyloop's public design language and product UI, including the Ownership/aftersales palette. A separate design workflow authored theme tokens and component recipes, then used contrast, build/render and brand/completeness checks to revise them. The approved theme selects Plus Jakarta Sans, IBM Plex Sans and IBM Plex Mono, changes inaccessible colour combinations, and uses a plain-text brand reference. The design adoption is integrated into the board and appointments list. This is a take-home demo inspired by Keyloop, with no claim of being an official product.

### Verification practices

Task reports record **RED before GREEN**, including behavioural failures for existing defects. Mutation probes remove guards, registrations, constraints or middleware to ask whether a test can actually fail. Characterization tests that were already green are identified as such rather than given an invented RED phase. Examples include exclusion-constraint removal, idempotency-order mutations, a lost-commit fault injector, independent availability-oracle checks and the HSTS removal probe.

Builds use warnings as errors; reflection-based JSON is disabled in both API and integration tests; mapping and contract drift checks catch generated-code omissions. Reviewers independently retraced the availability example and DST values, used scratch probes for faults, and requested fixes instead of weakening assertions. Mermaid diagrams were validated as part of the architecture work. The automated suites exercise booking, reseeding, cancellation, themes, focus and responsive component states; Aspire smoke checks the API and Vite proxy. They do not establish Chrome layout, console or network cleanliness. Task 17b's Chrome visual QA and the clean-clone final gate remain **`TODO(final-gate)`**, as does the planned Fable whole-branch review. These practices provide evidence without claiming every planned gate has already run.

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
| Codex I1 | Real validators and fallback startup logs leaked raw configuration values | Safe member/index and path/type diagnostics (`cdc2e96`) |
| Codex I2 | Accepted sub-minute hours produced availability starts rejected by booking | Whole-minute domain guards and additive database CHECK (`d8b0417`) |
| Codex I3 | Readiness reported healthy with an unmigrated database | Connectivity plus pending-migration check, with independent liveness (`bff9fc4`, `64f159f`) |
| Codex I4 | Extreme UTC start overflowed to 500 before horizon validation | Bound the start before slot arithmetic, preserving replay order (`f34f5c8`) |
| Codex I5 | Design falsely promised unkeyed client retries could never create another appointment | Corrected optional-key semantics and spare-capacity tests; stable UI key required (`8dac682`) |
| Codex I6 | Promised X-Request-Id echo and business log scopes were absent | Bounded UUID echo, CORS exposure, Activity tags and scopes (`beb971c`) |
| Codex I7 | Existing tests stayed green with HSTS removed | Non-loopback HTTPS deployment cases proven RED by middleware removal (`2622631`) |
| Task 18 AOT | Analyzer found application-owned trim-sensitive TimeSpan validation | Typed inclusive bounds through the generated validator (`533b1e0`) |
| Frontend 15a/15b | Theme did not follow system changes, a lazy-import test was vacuous, and client generation could delete hand-written runtime config | Theme behavior tests, import-side-effect probe and `output.clean=false` (`19fdf75`, `773103a`) |
| Frontend 15b | A shared request-id setting reused one UUID for the session, and automatic dealership selection could cancel a pending sidebar navigation | Per-request interceptor and navigation-aware selection, with behavioural regressions (`773103a`) |

Task 18a's fixes are integrated, the scope-disposal assertion now observes one request flow, and the booking UI's stable idempotency key is covered by its tests. **`TODO(final-gate)`:** reconcile the final whole-branch review findings before finalizing this table.

### Rejections and trade-offs

- A mediator and assembly scanning were rejected in favor of direct handlers and explicit registration (ADR-001/016).
- Row locks as the primary booking guarantee, SERIALIZABLE retry storms and a single-writer application queue were rejected after comparing correctness, contention and operational cost. Exclusion constraints alone remain correct but can cause mutual waits; the advisory lock supplies the normal serialization path (§7.2/7.3).
- Replacing Microsoft's DI container with Jab/Pure.DI was rejected because swapping the hosting container added risk for limited gain. EF compiled models and `PublishAot` were deferred; they require more than suppressing warnings.
- Same-VIN or body-based deduplication was not added to disguise the unkeyed retry defect. Independent same-vehicle bookings remain valid; the optional-key contract stays explicit.
- MiroTalk's AGPL code was not copied. The MIT Vite template supplied reusable UI patterns; unrelated auth, chat, mail, landing, pricing and billing apps were excluded. Keyloop logos and proprietary images were excluded from the inspired theme.
- The product lock-disable switch was not added merely for a test. Scratch mutation evidence demonstrates the trade-off without introducing a production escape hatch.

### Process incidents and lessons

The ledger records a controller error: `SendMessage` to workflow implementers resumed duplicate agents in the same worktrees instead of reaching the intended running instances. Both backend twins ran AppHost work, and one cleared the persisted database password. It was restored from the running container and checked without displaying it. In the frontend lane, a stop message reached the original instance and blocked its workflow while the resumed twin later completed the board. A checkout-style sweep instruction could have discarded the original's uncommitted work; the ledger explicitly records that no checkout occurred and the files remained intact. The adopted rule is to communicate mid-run changes through briefs/global constraints and workflow results rather than that messaging path, and verify exclusive worktree ownership before destructive maintenance.

Separately, a hand-applied punctuation sweep collided with concurrent edits and corrupted ordinary text in `CLAUDE.md`. The repair waited for implementation commits, reapplied the exact character replacement deterministically to committed text, then rebuilt, regenerated contracts and tested before a separate style commit in each lane (`c156b83`, `a38342e`). The lesson is to avoid broad edits over an active implementer's files and validate the complete diff, not just the intended replacement. A killed frontend mutation run also left temporary mutants; the implementer restored and checked them before committing.

An earlier controller documentation commit polluted a task review range; the package was rebuilt to exclude it and later controller commits waited for implementation boundaries. These are process failures with recorded recovery, not examples of a flawless automated workflow. The final gate must still establish the integrated result.

## Video

The [video walkthrough guide](docs/VIDEO_WALKTHROUGH.md) gives the planned architecture, booking/conflict/cancel demo, concurrency proof, Aspire tour and AI collaboration segments. **`TODO(video)`:** rehearse against the final UI labels and resources, attach the recording link and actual duration, and include email/observability additions only when they have been verified.

## Licence and attribution

The dispatch board adapts the **MIT-licensed shadcn-dashboard-landing-template (Vite variant)** by ShadcnStore and the MIT **shadcn/ui** primitives it vendors: the project layout and configuration, the application shell, `components/ui/*`, the Tailwind v4 theme tokens, and several template apps adapted to the generated API client with their sample data removed (dashboard cards for the KPI strip; the calendar's date picker, calendars list, list view, mobile sheet and event form for the board's date control, lane filter, phone agenda, Filters sheet and booking dialog, with the users app's form dialog; the tasks app's data table for the Appointments list; the users app's page, data table and stat cards for the Appointments figures and the Technicians, Bays and Services pages; the settings app's appearance and account pages; and the errors app's pages). Every file adopted from the template, the configuration, application shell, `components/ui/*` primitives and theme tokens included, opens with a header comment that names its template source and carries the template's copyright line; the primitives' headers also carry shadcn/ui's. `src/Keyloop.ServiceScheduler.Web/src/attribution.test.ts` keeps the list of those files, checks every header on it, and fails when a primitive or a file that refers to the template is missing from the list. `package.json` and `components.json`, started from the template's, are JSON without comment syntax; the notice below covers them. The copyright and permission notice, which must accompany copies of that code, is reproduced at the end of this section. No repository-wide application licence is inferred from the template's licence.

Reference material, kept outside this repository (one level up, never committed):

| Reference | Upstream | Licence | Used for |
|-----------|----------|---------|----------|
| shadcn-dashboard-landing-template (vite-version) | https://github.com/shadcnstore/shadcn-dashboard-landing-template | MIT | App shell, `components/ui/*`, Tailwind v4 tokens, ESLint/TS config (vendored, "own your components") |
| carcareco | https://github.com/rene98c/carcareco | see upstream | Domain inspiration only (vehicle/work-order shape); no code copied |
| MiroTalk WEB (booking module) | https://github.com/miroslavpejic85/mirotalkwebrtc | AGPL-3.0 | Design inspiration only (availability model, DST handling, re-check-then-insert); **no code copied** |

The typefaces are **Plus Jakarta Sans** (Copyright 2020 The Plus Jakarta Sans Project Authors), **IBM Plex Sans** (Copyright 2019 IBM Corp.) and **IBM Plex Mono** (Copyright 2017 IBM Corp.), all under the **SIL Open Font License 1.1**, served from the `@fontsource` packages whose `LICENSE` files carry the full licence text. Original illustrations and backdrops were generated for this project using OpenAI `image_gen.imagegen` via Codex, without third-party source images, logos or real people. The first set is eight WebP files; a second set of ten (wave 2, 2026-10-12) was generated with the same tool, using the first set only as style references, and exported through the same pipeline (1200 × 900 RGBA WebP with a transparent margin of at least 24 px, each under 160,000 bytes, alpha checked pixel for pixel); it contains no written text, logos, trademarks, real people or faces, and its cars are generic and unbranded. Eight of the wave-2 files ship now: `unauthorized`, `forbidden`, `server-error`, `maintenance` and `not-found` on the error pages, `empty-technicians` on the empty Technicians and Bays lists, `photo-evidence` in the triage photo field and `sign-in-to-book` (alt text "Calendar booking card beside a car key.", 122,858 bytes, copied unchanged from the wave-2 set, prompt P9 in its README) in the sign-in prompt before booking and the details sheet's sign-in panel; `dashboard-insights` and `empty-calendar` wait for Task 28b. All shipped files are in [the illustration assets](src/Keyloop.ServiceScheduler.Web/src/assets/illustrations); [UI_DESIGN §12](docs/UI_DESIGN.md#12-illustrations-empty-and-error-states) documents their use and alt text, and both images READMEs (prompts, alt text and verification) are kept with the design working files. No image-model version is asserted: the tool did not expose one.

The author's application licence decision remains separate; there is no repository-wide MIT application licence file.

<details>
<summary>MIT licence of the shadcn dashboard template and shadcn/ui</summary>

```
MIT License

Copyright (c) 2025 ShadcnStore
Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

</details>
