# Unified Service Scheduler

A dealership appointment needs a compatible service bay and a certified technician for its entire duration. This Keyloop Principal Engineer take-home implements that booking engine with .NET 10, vertical slices and a DDD domain, EF Core and PostgreSQL, plus a React dispatch board for demonstrating bookings, conflicts and cancellations. PostgreSQL owns the overlap invariant; Aspire provides the local application model and correlated telemetry. The backend is the evaluated deliverable, and the board is its demo harness.

**Optional booking intake triage:** the backend can suggest bookable services and a preferred local date using Clef-flash through Cloudflare AI Gateway. Suggestions require human confirmation; manual availability and booking work independently. Triage defaults off. When it is on, the dispatch board's booking dialog offers it in its first step: describe the issue, get suggested services, and use one to fill in the service and day.

**Implementation status:** the backend, dispatch board, notifications, optional triage, Aspire web resource and offline edge/observability/load tooling are integrated. **`TODO(final-gate)`:** complete Task 17b Chrome QA, the final whole-branch review, the clean-clone verification with coverage and screenshots, and record a hosted CI run. Public deployment is a separate stakeholder gate.

## Submission deliverables

| Deliverable | Where |
|---|---|
| System Design Document (Part 1) | [docs/SYSTEM_DESIGN.md](docs/SYSTEM_DESIGN.md), the entry point that maps each required item to [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Working code (Part 2, backend) | This repository: build, run and test instructions below |
| AI Collaboration Narrative | [AI Collaboration Narrative](#ai-collaboration-narrative) in this README |
| Tests that validate the core business logic | [Run the tests](#run-the-tests), including the adversarial concurrency proof |
| Video (5 to 10 minutes) | [Video](#video) and the [walkthrough guide](docs/VIDEO_WALKTHROUGH.md) |

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

Open the dashboard URL printed by the AppHost, including its login token: it runs on `https://scheduler.dev.localhost:17180`, and the browser-facing resources link as `<resource>-scheduler.dev.localhost:<port>` (for example `https://api-scheduler.dev.localhost:7180`). Browsers resolve every `*.localhost` name to loopback and the .NET 10 developer certificate covers `*.dev.localhost`; the same ports answer on plain `localhost`, which is the form to use from curl or other tools that do not resolve `*.localhost` names, and PostgreSQL's `tcp` and Mailpit's `smtp` links stay on `localhost`. Safari has been reported not to open `*.dev.localhost` addresses ([aspire#20228](https://github.com/microsoft/aspire/issues/20228)); use another browser or the `localhost` form there. In **Resources**, use the `web` HTTP link for the app (it opens on the Overview), the `api` **Scalar API reference** link for `/scalar/v1`, and `pgweb` to inspect the database. Ports come from the running application model; use those links when setting `API_BASE` in the curl examples. Scalar supplies documented examples and an interactive request client. Avoid sharing dashboard tokens or displaying secrets in recordings.

The reference seed defines two dealerships, Reading (`Europe/London`) and München (`Europe/Berlin`), nine bays, nine technicians and eleven services. Accident Damage Assessment takes 60 minutes on a standard lift with a DamageAssessment-certified technician (fresh seeds: Eva at Reading, Hans at Munich); vehicle-aware HV/Unknown work requires level 3 under default policy v2. Existing databases receive the service and, once per dealership, a versioned policy upgrade at startup (a later version without the rule is kept), while resources remain unchanged until editing or the Admin demo reseed grants that seeded qualification. Reading's EV Battery Health Check has one qualified bay; with vehicle-aware requirements on (the Development default) any technician at HV level 3 can take it, Ben Okafor or Eva Lindqvist, and with them off only Ben, who holds the old high-voltage certificate. The demo seeder creates the upcoming workshop week and skips elapsed starts; today's board can therefore be empty outside opening hours. Select Reading and a future open day when demonstrating bookings.

The web app's pages, each keeping the dealership in the address (`?dealership=`):

- **Overview** (`/overview`, where `/` lands): today's bookings by status, bay utilisation, cancellations in the last seven days and the next free start; bookings per day for the 14 days either side of today (with a table view), the service mix and the next appointments, each opening its details; *Book appointment* and *Open dispatch board*.
- **Dispatch board** (`/dispatch`): one day's bays or technicians on a timeline (an agenda on phones), with booking, details and cancellation.
- **Calendar** (`/calendar`): a week (from Monday) or a month of appointments with closed days hatched, each opening its details, and *New appointment* on a chosen day; an agenda by day on phones.
- **Appointments** (`/appointments`): the same day as a searchable, filterable list.
- **Resources** (`/resources/...`, any role) and **Settings** (`/settings/...`).

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
| Viewer | full | full record | unavailable: "Your role can view bookings but not change them." | read-only lists, with the reason |
| Service advisor | full | full record | available | read-only lists, with the reason |
| Admin | full | full record | available | lists, editing, the requirement policy and the change history (see [Admin editing](#admin-editing-task-30)) |

Where a deployed build offers **Sign in** (the Access login, coming back to the same page, dealership and day) and **Sign out** (the hostname's Access logout), the development server shows **How to sign in**, which leads to those settings, and no Sign out. A refusal the UI did not foresee (a session that ended, a role removed) is answered once, with "Your session has ended" and Sign in for a `401` or "Your role doesn't allow that" for a `403`, and the app reads `/me` again; when the identity changes (or `/me` cannot be read, which counts as signed out at once), whatever the previous caller read is cleared and read again, an open details sheet closes, a booking being entered is discarded with a note saying so (unless the same email keeps a role that may book), and a write's answer that arrives afterwards is thrown away.

**`TODO(final-gate)`:** add Task 17b's approved board/dashboard screenshots under `docs/media/`, in both themes and at the mobile and desktop QA viewports, and record the final clean-clone startup. No screenshot is embedded until that evidence exists.

## Admin editing (Task 30)

An Admin edits the Resources area; a Service advisor or a Viewer sees the same lists read-only, with the reason on screen. Locally the API's Development identity is `admin@keyloop.test` / Admin, so the app opens as an Admin (see [Try each role locally](#try-each-role-locally) for the others).

- **Technicians** (`/resources/technicians`): **Add technician**, and each row's menu: *Edit* (name, employee number, certifications; with vehicle-aware requirements on, the HV level 0 to 4 with its IMI-style name, valid until in the dealership's calendar, confirmed, and brand specialisms, which allocation does not use yet), *Confirm HV level* for a level nobody confirmed (also a button per technician in the "HV levels to review" note), *Deactivate* (after a preview of the upcoming appointments the board would then flag) or *Reactivate*, and *Change history*.
- **Bays** (`/resources/bays`): **Add bay**, and each row's menu: *Edit* (name and equipment), *Take out of service* (with the same preview) or *Return to service*, and *Change history*.
- **Requirement policy** (`/resources/policy`, Admin only): the dealership's typed rules in words. Edit a rule (raise *hv-routine* to HV 4, say), **Preview changes** to see which services Reading could no longer book with today's roster (nobody there holds level 4), then **Publish version 3**; publishing is offered only for the draft just previewed. New bookings use the new version; appointments keep the one they were booked under. *Versions* lists every publication and what it changed.
- **Change history** (`/resources/history`, Admin only): every Admin change, newest first, with who, when and what changed field by field (or rule by rule for a policy), filtered by kind or opened for one technician or bay from its row menu.
- **Two Admins at once**: every edit is sent with the version it was made from (`If-Match`). Open the same technician in two tabs, save in one, then save in the other: the second says what the first changed and offers **Reapply my changes** (on top of theirs, saved only when you save again) or **Discard my changes**.
- **The board** marks an appointment whose technician or bay no longer meets what it was booked with ("Review", and "needs review" in its label), and the details sheet names why; nothing is moved. Deactivate a technician with work this week, then open the dispatch board.

## Vehicle-aware allocation (ADR-029)

ADR-029 Phases 0 and 1 run behind `Scheduling:VehicleAwareRequirements`: **on in Development and Demo**, turned on with the booking UI in Task 31b, and off in SystemTest, UAT and Production unless deliberately configured (the Cloudflare demo's edge setting `KEYLOOP_VEHICLE_AWARE_REQUIREMENTS=true` passes `Scheduling__VehicleAwareRequirements=true`, [edge README](deploy/cloudflare/README.md#vehicle-aware-booking)). The web app reads public `GET /api/v1/features` and shows the vehicle step, the vehicle-aware availability and the allocation explanations only while it says on; with it off the booking flow is the earlier one and no vehicle-aware input is sent. To see that flow locally, start the API with `Scheduling__VehicleAwareRequirements=false` (the switch is fixed for the API process: restart it to change).

### Try it in the app

Sign in as Admin (the Development default) or Service advisor, open the dispatch board on Reading and a future open day, and use **Book appointment**. Each case is one of task-31-report.md's local cases:

| Case | In the booking dialog | What to look for |
|---|---|---|
| Unknown | Interim Service, leave the vehicle step Unknown | the starts are "Counted for a vehicle of unknown powertrain, planned as high-voltage"; after booking, "Why this allocation" names a level 2 technician |
| Declared ICE | Powertrain *Petrol or diesel (ICE)*, with a reason | more starts ("Updated for this vehicle: ... was ..."); the explanation needs no HV level; the details sheet shows "Declared by" with the reason |
| EV routine | Powertrain *Battery electric*, with a reason, then Brake Pads & Discs, Four-Wheel Alignment or Air-Con Regas | levels 2, 1 and 3 in the explanation |
| Heavy | Vehicle class *Heavy vehicle* (Interim or Heavy Van Service) | only the heavy-duty lift's starts, and the heavy-vehicle technician |
| Training gap | EV Charging Fault Diagnosis, *Needs live HV diagnosis* | no start: no Reading technician holds level 4, said as the workshop's gap, with the two-person warning |
| Conflict | step 2: *Manufacturer code* `BMW`, then VIN `WVWZZZ1KZAW123456` and **Look up** | "The VIN says VOLKSWAGEN, but BMW is declared", with **Use decoded data** (also on the API's 422) |
| Why not | Unknown Interim Service, *Preferred technician* Farid Haddad | "Farid Haddad holds HV level 1, below the level 2 this job needs." in the booked toast and the details sheet, from the board, the Overview and the Calendar alike |
| Accident assessment | Accident Damage Assessment, the vehicle left Unknown (or a hybrid or electric one declared) | no live diagnosis offered; Eva Lindqvist (Reading) or Hans Richter (München) "at HV level 3 or above with Damage assessment", because a collision may have damaged high-voltage cabling or parts |

Resources > Technicians shows each technician's HV level, how long it is valid, whether it was confirmed and the brand specialisms (not used for allocation yet). **Look up** sends the VIN in the request body only to `POST /api/v1/vehicle-profiles/resolve` (Admin or ServiceAdvisor, booking rate limit, offline: no registry is called and nothing is stored); availability is asked with `powertrain`, `vehicleClass`, a manufacturer code and `needsLiveDiagnosis`, never a VIN, registration or reason.

### Existing local databases

Fresh seed data gives Reading confirmed levels 1 to 3 through 2028-12-31, so every seeded service is bookable for an ICE declaration and for Unknown; no technician has level 4, which keeps the live-diagnosis gap honest. An existing developer database is different: the migration carried the old high-voltage certificate over as level 3 **unconfirmed** and every other technician as level 0, and startup seeding never rewrites a technician, so with the switch on an Unknown brake or MOT job at Reading finds no qualified technician. The Technicians page names those unconfirmed levels, and the booking dialog says which level is missing. Nothing rewrites them on its own; to try the feature, either:

1. **Reseed demo data** (the API resource's command in the Aspire dashboard; Admin and key-protected): besides rebuilding the sample week, it restores the seeded, confirmed levels of the seeded technicians whose level was never confirmed. A confirmed level and any technician outside the seed are left alone; or
2. a **fresh database**: `dotnet run --project src/Keyloop.ServiceScheduler.AppHost -- --AppHost:UsePersistentResources=false --Parameters:postgres-password=<temporary-password>`, stopped afterwards (one AppHost per machine at a time). It never touches the developer volume or the persisted password.

### The API underneath

Booking keeps its vehicle fields and accepts `vehicle.profile: { "powertrain": "Ice", "declarationReason": "Engine checked at intake" }` and top-level `needsLiveDiagnosis`; a concrete powertrain needs a private 1 to 500 character reason, stored with the authenticated actor in the booking's history and never sent in email or telemetry. For a declared manufacturer the VIN contradicts (`BMW` against a WVW VIN), booking answers `422 vehicle-profile-conflict` until `conflictChoice: "UseDecoded"`. Booking and the role-protected details return `allocation` (deciding criterion, policy version, minimum HV level, fired rules, preferred hints and reason codes) and `vehicle.profile` with server provenance; the schedule's technicians carry level, validity, confirmation and brands to a role only. With the switch off, a booking with `needsLiveDiagnosis: true` or a `vehicle.profile`, and availability with any vehicle parameter, is refused with `422 vehicle-aware-requirements-disabled` (naming `rejectedFields`) rather than answered as if the input were absent, and existing requests, responses and idempotency fingerprints are unchanged. `GET /api/v1/features` answers `{ "vehicleAwareRequirements": true }` or `false`, the same for every caller, with `Cache-Control: public, max-age=60, must-revalidate`; after that 422 the app reads it again past the cache. Brand specialist preference, continuity, warranty/OEM rules, Clef questions, registries and multi-technician bookings are later tasks.

## Optional booking intake triage

Clef-flash also evaluates optional photos of vehicles, warning lights or paperwork. Upload up to four PNG/JPEG/WebP photos (4 MiB each, 8 MiB total, 16 megapixels each) through `POST /api/v1/dealerships/{id}/booking-triage/images`, body `{ "contentType": "image/png", "base64": "..." }`, then include the returned `imageIds` with the description. Upload IDs are private, dealership-scoped and expire after one hour; storage deletes the photo within about another hour. Photos are stored and sent to Clef as uploaded, including embedded metadata such as GPS location. Uploads share the triage rate limit with evaluations (four new photos and one suggestion use five of the ten permits a minute) and, like evaluations, require Admin or ServiceAdvisor (ADR-027); the triage status read stays public. Production uses private R2 through the Container relay; local runs use a bounded transient store. PDF conversion is not included. The design is ADR-028, which supersedes the Jev decision (ADR-026).

The backend exposes `GetBookingTriageStatus` (`GET /api/v1/booking-triage`) and `TriageBookingRequest` (`POST /api/v1/dealerships/{id}/booking-triage`, body `{ "description": "Brakes squeal, it's an EV, need it Thursday." }`). The response includes `suggest`, `confirm` or `no-match`, up to three bookable service candidates with probabilities and an optional local date. Confirm a service before requesting availability; the operation never books or stores the description. Disabled or unavailable suggestions return `503 triage-unavailable` and leave manual selection available. See [ARCHITECTURE §8.10](docs/ARCHITECTURE.md#810-booking-intake-triage).

On the dispatch board, the booking dialog's first step shows the intake only when the status says it is enabled: *Describe the issue*, *Suggest a service*, and the line "Suggestions by Clef-flash via Cloudflare AI Gateway. Check before booking." Suggested services appear as cards marked *Likely* or *Possible* with their percentage and the equipment and certifications they need; *Use this* sets the service (and the day asked for, when that day is still to come and the workshop is open then), clears any start time already picked, and moves on to the free start times. Nothing is applied without that click. A failure shows the usual problem alert and leaves the service select as it was. *Copy the description into Notes* is ticked by default and never overwrites notes typed by hand; untick it to keep the description out of the booking. See [ARCHITECTURE §15](docs/ARCHITECTURE.md#15-dispatch-board-ui-harness).

Since Task 32b the answer also says what it leaves out, always in fixed client phrases and never in the model's words. A no-match says "The workshop’s bookable services do not cover what you described.", names the uncovered category when the API reports one (for example *Mentioned: lights or electrical accessories*), and offers *Book Diagnostic Fault Finding for an inspection* only when the selected dealership can book that service, then "choose a service below or contact the workshop". When a suggestion also reports an uncovered issue, a notice under the cards reads "Also mentioned: accident or body damage, which Diagnostic Fault Finding does not cover. One appointment books one service: add it to Notes or book it separately.", with *Add to Notes* to write that line into the booking's notes (when it would take them past their 1000 characters it writes nothing and says by how much to shorten them); it goes while another candidate than that service is chosen. The cards are what the API returns (its floors decide how many), and the copy reads naturally for one. Photos are added with *Add photos* or dropped on the field; the browser's own file button is hidden but its keyboard behaviour, accept list and limits stay. In the booking dialog, the Accident Damage Assessment says "Inspection and estimate of collision damage, not the repair itself." in the Service list, under the chosen service and on its suggested card; the admin services page does not show the help line.

An operator must first load Unified Billing credits, provision an account-scoped **Workers AI Read** token, and configure the `keyloop-scheduler` AI Gateway with authentication on (required for Unified Billing), log collection off, zero data retention on and a rate limit. Only after that approval, the developer can run these two commands themselves (the placeholders are intentionally not credentials):

```bash
dotnet user-secrets set 'Parameters:cloudflare-account-id' '<32-hex-account-id>' --project src/Keyloop.ServiceScheduler.AppHost
dotnet user-secrets set 'Parameters:cloudflare-ai-token' '<workers-ai-read-token>' --project src/Keyloop.ServiceScheduler.AppHost
```

The AppHost passes `Triage__*` only when both optional parameters are present, and starts without them. Never put the token in appsettings. The eight-second total timeout (raised from Jev's four seconds for Clef; latency with photos is still unmeasured), 0.5 suggestion confidence (calibrated on Clef-flash's live golden set; Jev used 0.95), 0.10 candidate floor, 0.50 relative candidate floor, 0.60 date confidence, 0.50 uncovered-issue confidence (calibrated on the 2026-10-13 live golden set: 5 correct notices, 0 false, 5 missed given an accepted service; ten positive fixtures are a small sample) and 500-character limit are configurable in `Triage`; `Security:RateLimiting:TriagePermitsPerMinute` defaults to 10. Cloudflare container deployment uses `KEYLOOP_TRIAGE_ENABLED=false` by default, with optional account/gateway settings and the `keyloop_prod_ai_token` Secrets Store binding when enabled. Public enablement requires stakeholder approval.

All regular tests use a stub HttpMessageHandler. The 49-fixture `LiveAi` category (three questions in one request per fixture; the first 25 fixtures are the original two-question set) runs only with the stakeholder's approval, `KEYLOOP_LIVE_AI=1` and both Triage environment settings, and writes [`docs/media/triage-clef-flash-golden-set.md`](docs/media/triage-clef-flash-golden-set.md); ordinary integration verification excludes it with `--filter 'Category!=LiveAi'`. The approved run of 2026-10-13 (text only, no photos) chose an accepted service in 42/49 (natural descriptions 33/36) and kept the accepted service and date, with no notice, in every one of the original 25; it suggests Accident Damage Assessment for the stakeholder's crash and air-con sentence but does not flag the air-con part, flagged 3 of 10 uncovered issues given an accepted service at the 0.60 threshold it ran with and no false notice (5 of 10 is its sweep row for 0.50, the threshold since calibrated), and took p50 590 ms, p95 959 ms and about 2,150 input tokens per request. The previous Jev report, [`docs/media/triage-live-golden-set.md`](docs/media/triage-live-golden-set.md), is historical, and so is the first Clef-flash run (2026-10-12, 25 fixtures, two questions, text cases, no photos; its report was replaced by the 49-fixture one), which chose the right service in 25/25, both relative dates, the German and injection cases and both out-of-scope `no-match`es; at the calibrated 0.5 threshold 21 clear requests come back as `suggest` and the vague one (confidence 0.19) as `confirm`; p50 736 ms, p95 1,787 ms, about 1,590 input tokens per triage. Photo cases are not yet measured. The first Jev run (2026-10-12) scored 24/25 at the original 0.70 threshold, with p50 430 ms, p95 860 ms and about 1,940 input tokens per triage; its one miss, a vague description, led to the 0.95 threshold, and the rerun at 0.95 scores 25/25 (ARCHITECTURE §14).

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

# Adversarial concurrency proofs only: the 30-way contention cases, xmin/cancel races and the Admin in-flight edit cases.
dotnet test --project tests/Keyloop.ServiceScheduler.IntegrationTests -c Release --no-build \
  --filter "FullyQualifiedName~Concurrency"

# Runtime/build-time OpenAPI parity and contract assertions only.
dotnet test --project tests/Keyloop.ServiceScheduler.IntegrationTests -c Release --no-build \
  --filter "Category=Contract"

# AppHost smoke tests, with Docker and the frontend prerequisites installed.
dotnet test --project tests/Keyloop.ServiceScheduler.AspireTests -c Release --no-build \
  --filter "Category=Aspire"

# Browser E2E: starts PostgreSQL, API, Vite and Mailpit; installs Chromium idempotently.
# One AppHost per machine: if this prints a running host, wait for its owner to stop it.
ps -axo comm,args | grep -E '^(dotnet|aspire) ' | grep AppHost
dotnet test --project tests/Keyloop.ServiceScheduler.E2ETests

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

Browser E2E tests (`Category=E2E`) use .NET Playwright with Chromium and Aspire.Hosting.Testing. Install Node 22 and pnpm first (on this macOS setup: `source ~/.nvm/nvm.sh && nvm use 22`); the AppHost installs the frozen web dependencies. On a fresh Linux machine set `KEYLOOP_E2E_INSTALL_DEPS=1` to install Chromium's system dependencies too. Two class fixtures serialize an Admin stack and an anonymous stack, using temporary passwords, session containers, no named database volume and disabled triage. Dates come from Reading's operating hours on the real clock. Each test has fresh browser storage and unique booking data. Failed journeys retain trace ZIPs (screenshots, snapshots, sources), screenshots, accessible snapshots, browser logs and video under `TestResults/e2e/`; passing journeys retain result JSON, axe results and the dark-mode page screenshots. Open a failed trace with `pnpm dlx playwright@1.63.0 show-trace <trace.zip>` (no PowerShell). CI caches `~/.cache/ms-playwright` and always uploads the evidence. Do not run this suite concurrently with Aspire smoke tests or a developer AppHost; the fixture waits up to five minutes for a running host and never stops it.

The journeys cover browser booking and conflict recovery, real API 400/422 form feedback, cancellation/history, day/list filters and URL persistence, overview/calendar consistency, vehicle competence, Admin stale edits and policy preview tokens, visitor masking, Mailpit, phone booking, dark-mode persistence and serious/critical axe checks. Appointments currently has a single-day selector, so a date-range list filter has no UI to exercise. The visitor Book action opens a sign-in prompt. Triage needs a model and remains covered by the fake-endpoint integration/component tests.

The [CI workflow](.github/workflows/ci.yml) defines backend build/test/contract checks, NuGet vulnerability auditing, frontend client drift checks, Aspire smoke tests, the E2E job after backend/frontend, API/web image builds, edge typechecks/tests/local builds, Grafana validator checks and offline k6 inspections/self-tests. [Dependabot](.github/dependabot.yml) groups weekly dependency updates. **`TODO(final-gate)`:** record final unit, integration, concurrency, contract, Aspire and frontend totals, durations and coverage from the clean integrated checkout, plus the CI run result. Earlier branch totals are not submission totals.

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
  Keyloop.ServiceScheduler.E2ETests/
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

The shared production/UAT global rate limit is 300/min/IP. Every environment uses problems with `traceId`, without a developer exception page or exposed exception details. Production's runtime OpenAPI/Scalar mapping is disabled by `Program.cs`; the committed contract is the build artifact, and the Cloudflare edge publishes it at `/openapi/v1.json` with a static Scalar reference at `/scalar/v1` ([edge README](deploy/cloudflare/README.md#static-api-reference)).

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

The .NET container's OTLP export to Grafana Cloud is an optional Worker setting, `KEYLOOP_API_OTLP_ENABLED`, with a Secrets Store token read only at container start; its series carry `job="keyloop-scheduler/api"` and `deployment_environment_name="Production"`, which the committed dashboards select ([edge README](deploy/cloudflare/README.md#optional-api-telemetry)). Enabling it on the live deployment, together with pushing the [dashboards as code](observability/grafana/README.md), is ordered in [Enable API telemetry](deploy/cloudflare/DEPLOY-RUNBOOK.md#enable-api-telemetry). **`TODO(grafana-cloud)`:** verify metric translation against deployed data, publish the runbooks, and prepare alerts for an approved contact point. The optional secret-free browser Worker relay is implemented and validated locally and stays off.

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

### CI/CD

[CI](.github/workflows/ci.yml) remains the validation gate. [Deploy public demo](.github/workflows/deploy.yml) plans an exact successful main SHA, builds its API image natively on Ubuntu with a 12-character SHA tag, pushes the build image and dry-runs the SPA/edge deployment. The stakeholder approves the `production` environment before deployment. Manual `migrate=true` first applies pending EF migrations and idempotent Neon runtime grants behind the same environment protection. Verification polls the real container image and checks API readiness, the SPA, feature flag, exact OpenAPI and anonymous masking within six minutes. Main advancing while approval is pending makes the old release fail before migration/deployment.

The [Actions runbook](deploy/cloudflare/DEPLOY-RUNBOOK.md#deploy-from-github-actions) documents required reviewers, the complete GitHub input list, the controller-only setup script and minimal token permissions. Both triggers become available only after the workflow is on default `main`, and CI evidence must come from a successful `push` run. `plan` and `verify` use a main-only `plan` environment without reviewers and a separate registry/inspection token. `migrate` and `deploy` use main-only `production` with stakeholder approval; migration-owner credentials stay there, and application credentials stay in Cloudflare Secrets Store. Shared build inputs live in both environments, with no repository-wide secret or variable copies. No private build output is uploaded. The laptop deployment path remains the break-glass fallback; the first live Actions run is a controller operation.

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

The dispatch board adapts the **MIT-licensed shadcn-dashboard-landing-template (Vite variant)** by ShadcnStore and the MIT **shadcn/ui** primitives it vendors: the project layout and configuration, the application shell, `components/ui/*`, the Tailwind v4 theme tokens, and several template apps adapted to the generated API client with their sample data removed (dashboard cards for the KPI strip; the dashboard and dashboard-2 apps' page layout, section cards, interactive area chart (redrawn without a chart library), revenue breakdown (as a bar list), recent transactions and quick actions for the Overview; the calendar app's page, header, month grid, list view and new-event action for the Calendar's toolbar, week and month views and phone agenda; the calendar's date picker, calendars list, list view, mobile sheet and event form for the board's date control, lane filter, phone agenda, Filters sheet and booking dialog, with the users app's form dialog; the tasks app's data table for the Appointments list; the users app's page, data table and stat cards for the Appointments figures and the Technicians, Bays and Services pages; the settings app's appearance and account pages; and the errors app's pages). Every file adopted from the template, the configuration, application shell, `components/ui/*` primitives and theme tokens included, opens with a header comment that names its template source and carries the template's copyright line; the primitives' headers also carry shadcn/ui's. `src/Keyloop.ServiceScheduler.Web/src/attribution.test.ts` keeps the list of those files, checks every header on it, and fails when a primitive or a file that refers to the template is missing from the list. `package.json` and `components.json`, started from the template's, are JSON without comment syntax; the notice below covers them. The copyright and permission notice, which must accompany copies of that code, is reproduced at the end of this section. No repository-wide application licence is inferred from the template's licence.

Reference material, kept outside this repository (one level up, never committed):

| Reference | Upstream | Licence | Used for |
|-----------|----------|---------|----------|
| shadcn-dashboard-landing-template (vite-version) | https://github.com/shadcnstore/shadcn-dashboard-landing-template | MIT | App shell, `components/ui/*`, Tailwind v4 tokens, ESLint/TS config (vendored, "own your components") |
| carcareco | https://github.com/rene98c/carcareco | see upstream | Domain inspiration only (vehicle/work-order shape); no code copied |
| MiroTalk WEB (booking module) | https://github.com/miroslavpejic85/mirotalkwebrtc | AGPL-3.0 | Design inspiration only (availability model, DST handling, re-check-then-insert); **no code copied** |

The typefaces are **Plus Jakarta Sans** (Copyright 2020 The Plus Jakarta Sans Project Authors), **IBM Plex Sans** (Copyright 2019 IBM Corp.) and **IBM Plex Mono** (Copyright 2017 IBM Corp.), all under the **SIL Open Font License 1.1**, served from the `@fontsource` packages whose `LICENSE` files carry the full licence text. Original illustrations and backdrops were generated for this project using OpenAI `image_gen.imagegen` via Codex, without third-party source images, logos or real people. The first set is eight WebP files; a second set of ten (wave 2, 2026-10-12) was generated with the same tool, using the first set only as style references, and exported through the same pipeline (1200 × 900 RGBA WebP with a transparent margin of at least 24 px, each under 160,000 bytes, alpha checked pixel for pixel); it contains no written text, logos, trademarks, real people or faces, and its cars are generic and unbranded. All ten wave-2 files ship now: `unauthorized`, `forbidden`, `server-error`, `maintenance` and `not-found` on the error pages, `empty-technicians` on the empty Technicians and Bays lists, `photo-evidence` in the triage photo field, `sign-in-to-book` (alt text "Calendar booking card beside a car key.", 122,858 bytes, copied unchanged from the wave-2 set, prompt P9 in its README) in the sign-in prompt before booking and the details sheet's sign-in panel, `dashboard-insights` (alt text "Workshop bay silhouette with rising blue bars and a simple gauge.", 120,542 bytes, SHA-256 `3a74a9ff86021dd40e1cefe484b087eb3d7fdc27b7aeb67735883381d044f5b7`, copied unchanged from the wave-2 set, prompt P8 in its README) on the Overview when nothing is booked around today, and `empty-calendar` (alt text "Week-view calendar with open slots and a small generic car icon.", 126,736 bytes, SHA-256 `0c7427d558df7e5e8e736947c981a561b86b1b6657af7460e7c638d4f1edeba2`, copied unchanged from the wave-2 set, prompt P7 in its README) on a Calendar week or month with nothing booked. All shipped files are in [the illustration assets](src/Keyloop.ServiceScheduler.Web/src/assets/illustrations); [UI_DESIGN §12](docs/UI_DESIGN.md#12-illustrations-empty-and-error-states) documents their use and alt text, and both images READMEs (prompts, alt text and verification) are kept with the design working files. No image-model version is asserted: the tool did not expose one.

The deployed site's static API reference (`/scalar/v1` on the Cloudflare edge, [edge README](deploy/cloudflare/README.md#static-api-reference)) serves the browser bundle of **Scalar API Reference** (`@scalar/api-reference` 1.72.2, Copyright (c) 2023-present Scalar, **MIT**, https://github.com/scalar/scalar) unmodified from the edge's pinned npm dependency; its copyright and permission notice is published beside it as `/scalar/LICENSE.txt` (source: `deploy/cloudflare/api-reference/SCALAR-LICENSE.txt`). The API's own Development reference uses the MIT `Scalar.AspNetCore` NuGet package by the same authors.

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
