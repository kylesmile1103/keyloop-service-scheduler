# Unified Service Scheduler

[![CI](https://github.com/kylesmile1103/keyloop-service-scheduler/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/kylesmile1103/keyloop-service-scheduler/actions/workflows/ci.yml)
[![Deploy public demo](https://github.com/kylesmile1103/keyloop-service-scheduler/actions/workflows/deploy.yml/badge.svg?branch=main)](https://github.com/kylesmile1103/keyloop-service-scheduler/actions/workflows/deploy.yml)
[![Live demo](https://img.shields.io/website?url=https%3A%2F%2Fkeyloop.kylesmile.me%2Fapi%2Fready&label=live%20demo&up_message=ready&up_color=1AA7A0&down_message=down&down_color=CC7A20&logo=cloudflare&logoColor=white)](https://keyloop.kylesmile.me)
[![AI triage](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fkeyloop.kylesmile.me%2Fapi%2Fv1%2Fbooking-triage&query=%24.provider&label=AI%20triage&color=3DA5FF&logo=cloudflare&logoColor=white)](#optional-booking-intake-triage)
[![Concurrency proof](https://img.shields.io/badge/concurrency%20proof-30%20callers%20%C3%97%205%20rounds%20%E2%86%92%201%20winner-1AA7A0?labelColor=11181C)](#run-the-tests)

[![.NET 10](https://img.shields.io/badge/.NET-10-512BD4?logo=dotnet&logoColor=white)](global.json)
[![Aspire 13.6](https://img.shields.io/badge/Aspire-13.6-512BD4?logo=dotnet&logoColor=white)](src/Keyloop.ServiceScheduler.AppHost)
[![PostgreSQL 17](https://img.shields.io/badge/PostgreSQL-17%20on%20Neon-4169E1?logo=postgresql&logoColor=white)](docs/ARCHITECTURE.md#7-concurrency-and-data-integrity)
[![React 19](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)](src/Keyloop.ServiceScheduler.Web)
[![Cloudflare Workers + Containers](https://img.shields.io/badge/Cloudflare-Workers%20%2B%20Containers-F38020?logo=cloudflare&logoColor=white)](deploy/cloudflare/DEPLOY-RUNBOOK.md)
[![OpenTelemetry](https://img.shields.io/badge/OpenTelemetry-traces%20%C2%B7%20metrics%20%C2%B7%20logs-425CC7?logo=opentelemetry&logoColor=white)](#observability)
[![OpenAPI](https://img.shields.io/badge/API%20reference-Scalar-6BA539?logo=openapiinitiative&logoColor=white)](https://keyloop.kylesmile.me/scalar/v1)

**[Live demo](https://keyloop.kylesmile.me)** · **[API reference](https://keyloop.kylesmile.me/scalar/v1)** · **[System design](docs/SYSTEM_DESIGN.md)** · **[Architecture](docs/ARCHITECTURE.md)** · **[AI collaboration](#ai-collaboration-narrative)**

A dealership appointment needs a compatible service bay and a certified technician for its entire duration. This Keyloop Principal Engineer take-home implements that booking engine with .NET 10, vertical slices, a DDD domain, EF Core and PostgreSQL. A React dispatch board demonstrates bookings, conflicts and cancellations against the real API.

PostgreSQL owns the overlap invariant; Aspire provides the local application model and correlated telemetry. The backend is the evaluated deliverable, and the board is its demo harness.

**Optional booking intake triage:** the backend can suggest bookable services and a preferred local date using Clef-flash through Cloudflare AI Gateway. Suggestions require human confirmation and manual booking works without them. Triage defaults off.

**Status:** backend, dispatch board, notifications, optional triage, the Aspire model and the edge, observability and load tooling are integrated. Chrome visual QA, an independent whole-branch review and a clean-clone verification with coverage ran on 2026-10-13 ([Run the tests](#run-the-tests), [Defects the process found](#defects-the-process-found)).

## Live demo

**https://keyloop.kylesmile.me** runs the `main` branch: a Cloudflare Worker with the web app's static assets in front of the .NET API in a Cloudflare Container, and Neon PostgreSQL 17 in Frankfurt. Every merge to `main` deploys through [Deploy public demo](.github/workflows/deploy.yml) once CI has passed (see [Deployment](#deployment)).

- **Without signing in** you can browse the dispatch board, calendar, overview and appointments, with customer names, VINs and registrations masked, and read the API reference.
- **Keyloop reviewers:** choose **Sign in** and enter your `@keyloop.com` work email. Cloudflare Access emails a one-time code: no password, no account to create. These addresses have the Admin role, so you can book and cancel, search returning customers and use the admin area. Other addresses can be added on request.
- The data is fictitious (seeded `@example.com` customers) and email notifications are off. A sign-in lasts an hour and the app renews it while the 24-hour Cloudflare session holds ([ADR-027](docs/ADR-027.md)).

## Screens

Captured on 2026-10-13 from a production build of the web app against the Development API with its seeded week (headless Chromium, 1440 × 900 and 390 × 844). The GIF books a returning customer from the dispatch board.

![Booking a returning customer from the dispatch board](docs/media/booking-flow.gif)

| | |
|---|---|
| ![Dispatch board, light](docs/media/board-light.png) | ![Dispatch board, dark](docs/media/board-dark.png) |
| Dispatch board: bays across the workshop day, KPI cards and the status legend | The same board in the dark theme |
| ![Booking dialog, step 1](docs/media/booking-dialog.png) | ![A real 409 with suggestions](docs/media/conflict.png) |
| Booking dialog: free start times with their bay and technician counts | A slot taken a moment earlier: `409 slot-unavailable`, its trace id and nearby free times |
| ![Returning-customer search](docs/media/returning-customer.png) | ![Docked appointment details](docs/media/inspector-dark.png) |
| Step 2: a returning customer found by registration | Appointment details docked beside the board |

Phone (390 px): [board, light](docs/media/board-mobile-light.png), [board, dark](docs/media/board-mobile-dark.png), [returning-customer search](docs/media/returning-customer-mobile.png). API reference: [Scalar](docs/media/scalar.png).

### Phone

390 × 844 at 2x, light theme, captured on 2026-10-14 from the Vite app under the AppHost (headless Chromium through Playwright).

| | | | |
|---|---|---|---|
| ![Overview on a phone](docs/media/mobile-overview.png) | ![Calendar on a phone](docs/media/mobile-calendar.png) | ![Appointments list on a phone](docs/media/mobile-appointments.png) | ![Appointment details sheet](docs/media/mobile-details.png) |
| Overview: today's figures and the next free start | Calendar, week view | Appointments list with filters | Appointment details as a sheet |
| ![Booking sheet, step 1](docs/media/mobile-booking-step1.png) | ![Booking sheet, step 2](docs/media/mobile-booking-step2.png) | ![409 on a phone](docs/media/mobile-conflict.png) | ![Booked on a suggested time](docs/media/mobile-booked.png) |
| Booking sheet: service, powertrain and the free start times | Customer and vehicle, with the VIN look-up | The slot taken a moment earlier: `409` with its trace id and nearby free times | Booked on a suggested time, with the allocation explained |

### Aspire dashboard

Captured on 2026-10-14 from `dotnet run --project src/Keyloop.ServiceScheduler.AppHost` (1440 × 900) after a burst of availability reads, three bookings and three refused duplicates.

| | |
|---|---|
| ![Aspire resources](docs/media/aspire-resources.png) | ![Aspire resource graph](docs/media/aspire-graph.png) |
| Resources: PostgreSQL with its database, pgweb, Mailpit, the Vite app and the API, each with its endpoints and commands | The same model as a graph |
| ![Aspire parameters](docs/media/aspire-parameters.png) | ![Aspire structured logs](docs/media/aspire-structured-logs.png) |
| Parameters: the generated database password and the optional keys stay masked | Structured logs, filtered to the API |
| ![Aspire traces](docs/media/aspire-traces.png) | ![One refused booking as a trace](docs/media/aspire-trace-booking.png) |
| Traces: each request with its API and PostgreSQL spans | One `409` end to end: the request, the advisory lock, the re-check and the suggestions query |
| ![Aspire metrics](docs/media/aspire-metrics.png) | |
| Metrics: the scheduler's own `Keyloop.ServiceScheduler` meter beside ASP.NET Core, Npgsql and the runtime | |

### Email

The booking confirmation's HTML part as a mail client renders it (a plain-text part travels with it). The source is [Notification.mjml](src/Keyloop.ServiceScheduler.Infrastructure/Notifications/Templates/Notification.mjml), compiled by `scripts/build-email-template.sh` into the embedded HTML the dispatcher fills in.

| | |
|---|---|
| ![Booking confirmation email](docs/media/email-confirmation.png) | ![The same email on a phone](docs/media/email-confirmation-mobile.png) |

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
- **Node 22 and pnpm 12.9.1**; the web project's `packageManager` pins the version used by Aspire and CI.
- No Aspire workload. The 13.6.1 AppHost uses the CLI bundle, resolved through an installed Aspire CLI or the SDK's DNX download; `dotnet run` works. For matching publish tooling use `dotnet dnx --yes aspire.cli@13.6.1 -- publish` with the arguments below (the local 13.6.0 CLI also works).
- `curl`, `jq` and `uuidgen` for the examples. Trust the development HTTPS certificate with `dotnet dev-certs https --trust` when using the HTTPS profile.

## Run everything

Run from the repository root:

```bash
dotnet tool restore
dotnet run --project src/Keyloop.ServiceScheduler.AppHost
```

The AppHost generates and persists the PostgreSQL password in its user secrets, starts PostgreSQL with a named data volume and pgweb, then starts the API after database readiness. The API migrates and seeds in Development.

The web app is always in the model: `AddViteApp` runs `pnpm install --frozen-lockfile`, waits for the API, and proxies to it through `API_HTTP` discovery. [Environments](#environments-and-configuration) lists the deployment differences.

**Dashboard and resources.** Open the dashboard URL the AppHost prints, with its login token: `https://scheduler.dev.localhost:17180`.

- Browser-facing resources link as `<resource>-scheduler.dev.localhost:<port>`. The same ports answer on plain `localhost`, the form for curl and for Safari ([aspire#20228](https://github.com/microsoft/aspire/issues/20228)).
- In **Resources**, the `web` link opens the app on the Overview, the `api` **Scalar API reference** link opens `/scalar/v1`, and `pgweb` inspects the database. Use those links for `API_BASE` below.
- Do not share dashboard tokens or show secrets in recordings.

**Seeded data.** Two dealerships, Reading (`Europe/London`) and München (`Europe/Berlin`), with nine bays, nine technicians and eleven services. The upcoming workshop week is booked and elapsed starts are skipped, so today's board can be empty outside opening hours. Demonstrate bookings on Reading and a future open day.

- Reading's EV Battery Health Check has one qualified bay. With vehicle-aware requirements on (the Development default) any technician at HV level 3 can take it; with them off, only Ben Okafor.
- Accident Damage Assessment takes 60 minutes on a standard lift with a DamageAssessment-certified technician (Eva at Reading, Hans at München).
- Existing databases receive new services and a versioned policy upgrade at startup; resources stay as they are until edited or reseeded.

**Pages**, each keeping the dealership in the address (`?dealership=`):

- **Overview** (`/overview`, where `/` lands): today's figures, bookings per day, the service mix and the next appointments.
- **Dispatch board** (`/dispatch`): one day's bays or technicians on a timeline (an agenda on phones), with booking, details and cancellation.
- **Calendar** (`/calendar`): a week or a month, with *New appointment* on a day.
- **Appointments** (`/appointments`): the day as a filterable list.
- **Resources** (`/resources/...`) and **Settings** (`/settings/...`).

**Commands and email.** The API resource's **Reseed demo data** command replaces the demo dealerships' appointments and rebuilds the sample week; it is key-protected and excluded from OpenAPI. Keep the AppHost's stored database password with the persistent volume across restarts.

Open **Mailpit inbox** on the `mailpit` resource to see the confirmation and cancellation emails. Seeded `@example.com` customers are suppressed, so book with another address. UAT, Production and Demo leave email dispatch off by default.

For an isolated check, add `-- --AppHost:UsePersistentResources=false --Parameters:postgres-password=<temporary-password>` and stop the AppHost afterwards. This never touches the developer's database volume or persisted password.

### Try each role locally

Locally, who you are is configuration: the AppHost runs the API as `admin@keyloop.test` / Admin unless told otherwise, so there is no login page. To see another role, restart the AppHost with it (Settings > Account lists the same settings):

```bash
dotnet run --project src/Keyloop.ServiceScheduler.AppHost -- --Parameters:auth-development-roles=ServiceAdvisor --Parameters:auth-development-email=advisor@keyloop.test
dotnet run --project src/Keyloop.ServiceScheduler.AppHost -- --Parameters:auth-development-roles=Viewer
dotnet run --project src/Keyloop.ServiceScheduler.AppHost -- --Parameters:auth-development-roles=""   # signed out
```

Running the API on its own, set `Auth__Development__Roles__0` to `Admin`, `ServiceAdvisor`, `Viewer` or empty (signed out), and optionally `Auth__Development__Email`; the Vite dev server (`pnpm dev`, with `API_HTTP` naming the API) needs nothing else.

| Role | Board and appointments list | Details sheet | Book, cancel, service suggestions | Resources |
|---|---|---|---|---|
| Signed out | names as initials, VINs as their last six characters, plates as `*******` | the masked card and a sign-in panel; the record is not requested | a "Sign in to book" prompt instead of the booking dialog | the 401 page |
| No role (signed in) | masked, as signed out | masked, with the reason | unavailable, with the reason on screen | the 403 page |
| Viewer | full | full record | unavailable: "Your role can view bookings but not change them." | read-only lists, with the reason |
| Service advisor | full | full record | available | read-only lists, with the reason |
| Admin | full | full record | available | lists, editing, the requirement policy and the change history (see [Admin editing](#admin-editing)) |

A deployed build offers **Sign in** (the Access login, returning to the same page) and **Sign out**; the development server shows **How to sign in** instead. An unforeseen `401` or `403` is answered once ("Your session has ended", "Your role doesn't allow that") and the app reads `/me` again.

When the identity changes, the previous caller's data is cleared, an open details sheet closes, a booking being entered is discarded with a note, and a late answer to a write is thrown away ([ARCHITECTURE §15](docs/ARCHITECTURE.md#15-dispatch-board-ui-harness)).

## Admin editing

An Admin edits the Resources area; a Service advisor or a Viewer sees the same lists read-only, with the reason on screen.

- **Technicians** (`/resources/technicians`): add and edit name, employee number and certifications, plus the HV level 0 to 4, its validity, confirmation and brand specialisms when vehicle-aware requirements are on. *Confirm HV level*, *Deactivate* (after a preview of the appointments the board would then flag), *Reactivate* and *Change history* are in each row's menu.
- **Bays** (`/resources/bays`): add and edit (name and equipment), *Take out of service* (with the same preview) or *Return to service*, and *Change history*.
- **Requirement policy** (`/resources/policy`, Admin only): the dealership's typed rules in words. Edit a rule (raise *hv-routine* to HV 4, say), **Preview changes** to see which services Reading could no longer book, then **Publish**; only the draft just previewed can be published. New bookings use the new version; appointments keep theirs.
- **Change history** (`/resources/history`, Admin only): every Admin change, newest first, field by field or rule by rule, filtered by kind or opened for one technician or bay.
- **Two Admins at once**: every edit carries the version it was made from (`If-Match`). Save the same technician in two tabs: the second says what the first changed and offers **Reapply my changes** or **Discard my changes**.
- **The board** marks an appointment whose technician or bay no longer meets what it was booked with ("Review", "needs review" in its label) and the details sheet names why; nothing is moved.

## Vehicle-aware allocation (ADR-029)

ADR-029 Phases 0 and 1 run behind `Scheduling:VehicleAwareRequirements`: **on in Development and Demo**, off in SystemTest, UAT and Production unless configured. The Cloudflare demo turns it on with `KEYLOOP_VEHICLE_AWARE_REQUIREMENTS=true` ([edge README](deploy/cloudflare/README.md#vehicle-aware-booking)).

The web app reads public `GET /api/v1/features` and shows the vehicle step, vehicle-aware availability and allocation explanations only while it says on. To see the plain flow locally, start the API with `Scheduling__VehicleAwareRequirements=false`; the switch is fixed per process.

### Try it in the app

Sign in as Admin or Service advisor, open the dispatch board on Reading and a future open day, and use **Book appointment**:

| Case | In the booking dialog | What to look for |
|---|---|---|
| Unknown | Interim Service, leave the vehicle step Unknown | the starts are "Counted for a vehicle of unknown powertrain, planned as high-voltage"; after booking, "Why this allocation" names a level 2 technician |
| Declared ICE | Powertrain *Petrol or diesel (ICE)*, with a reason | more starts ("Updated for this vehicle: ... was ..."); the explanation needs no HV level; the details sheet shows "Declared by" with the reason |
| EV routine | Powertrain *Battery electric*, with a reason, then Brake Pads & Discs, Four-Wheel Alignment or Air-Con Regas | levels 2, 1 and 3 in the explanation |
| Heavy | Vehicle class *Heavy vehicle* (Interim or Heavy Van Service) | only the heavy-duty lift's starts, and the heavy-vehicle technician |
| Training gap | EV Charging Fault Diagnosis, *Needs live HV diagnosis* | no start: no Reading technician holds level 4, said as the workshop's gap, with the two-person warning |
| Conflict | step 2: *Manufacturer code* `BMW`, then VIN `WVWZZZ1KZAW123456` and **Look up** | "The VIN says VOLKSWAGEN, but BMW is declared", with **Use decoded data** (also on the API's 422) |
| Why not | Unknown Interim Service, *Preferred technician* Farid Haddad | "Farid Haddad holds HV level 1, below the level 2 this job needs." in the booked toast and the details sheet |
| Accident assessment | Accident Damage Assessment, the vehicle left Unknown (or a hybrid or electric one declared) | no live diagnosis offered; Eva Lindqvist (Reading) or Hans Richter (München) "at HV level 3 or above with Damage assessment", because a collision may have damaged high-voltage parts |

**Look up** sends the VIN in the request body only, to `POST /api/v1/vehicle-profiles/resolve` (Admin or ServiceAdvisor, booking rate limit, offline, nothing stored). Availability is asked with `powertrain`, `vehicleClass`, a manufacturer code and `needsLiveDiagnosis`, never a VIN, registration or reason.

### Existing local databases

Fresh seed data gives Reading confirmed levels 1 to 3 through 2028-12-31 and no level 4, which keeps the live-diagnosis gap honest.

An existing developer database carried the old high-voltage certificate over as level 3 **unconfirmed** and every other technician as level 0. Startup seeding never rewrites a technician, so with the switch on an Unknown brake or MOT job at Reading finds no qualified technician.

To fix that, run **Reseed demo data**, which restores the seeded confirmed levels of seeded technicians whose level was never confirmed. Or start a fresh database with `--AppHost:UsePersistentResources=false` and a temporary password.

### The API underneath

- Booking accepts `vehicle.profile: { "powertrain": "Ice", "declarationReason": "Engine checked at intake" }` and top-level `needsLiveDiagnosis`. A concrete powertrain needs a private 1 to 500 character reason, stored with the actor in the booking's history and never sent in email or telemetry.
- A declared manufacturer the VIN contradicts (`BMW` against a WVW VIN) is `422 vehicle-profile-conflict` until `conflictChoice: "UseDecoded"`.
- Booking and the role-protected details return `allocation` (deciding criterion, policy version, minimum HV level, fired rules, preferred hints and reason codes) and `vehicle.profile` with server provenance.
- With the switch off, any vehicle-aware input is refused with `422 vehicle-aware-requirements-disabled` (naming `rejectedFields`), never ignored. `GET /api/v1/features` answers the switch with `Cache-Control: public, max-age=60, must-revalidate`.
- Brand preference, continuity, warranty/OEM rules, Clef questions, registries and multi-technician bookings are not implemented. The full contract is [ARCHITECTURE §8.7](docs/ARCHITECTURE.md#87-api-contract).

## Optional booking intake triage

The design is [ARCHITECTURE §8.10](docs/ARCHITECTURE.md#810-booking-intake-triage) (ADR-028, which supersedes the Jev decision, ADR-026).

- `GetBookingTriageStatus` (`GET /api/v1/booking-triage`, public) says whether triage is on.
- `TriageBookingRequest` (`POST /api/v1/dealerships/{id}/booking-triage`, body `{ "description": "Brakes squeal, it's an EV, need it Thursday." }`) answers `suggest`, `confirm` or `no-match`. The answer carries up to three bookable service candidates, their probabilities and an optional local date.
- Triage never books or stores the description. Disabled or unavailable, it returns `503 triage-unavailable` and manual selection carries on.
- Up to four PNG, JPEG or WebP photos (4 MiB each, 8 MiB total, 16 megapixels) go through `POST /api/v1/dealerships/{id}/booking-triage/images` first. Their ids are private, dealership-scoped and expire after an hour. Photos are stored in private R2 (a bounded transient store locally) and sent as uploaded, embedded metadata such as GPS location included. PDF conversion is not included.
- Evaluation and upload require Admin or ServiceAdvisor and share a rate limit of ten permits a minute.

In the booking dialog's first step, when the status says on: *Describe the issue*, optional photos, *Suggest a service*, and the line "Suggestions by Clef-flash via Cloudflare AI Gateway. Check before booking."

- Candidates are cards marked *Likely* or *Possible* with their percentage. *Use this* sets the service (and the day asked for, when it is open and still to come) and moves to the free start times. Nothing is applied without that click.
- *Copy the description into Notes* is ticked by default and never overwrites notes typed by hand.
- What the answer leaves out is said in fixed client phrases, never the model's words. A no-match names the uncovered category and offers *Book Diagnostic Fault Finding for an inspection* where that service is bookable; an uncovered issue beside a suggestion gets an *Also mentioned* note with *Add to Notes*.

**Enabling it.** An operator first loads Unified Billing credits, provisions an account-scoped **Workers AI Read** token, and configures the `keyloop-scheduler` AI Gateway: authentication on, log collection off, zero data retention on, and a rate limit. Then:

```bash
dotnet user-secrets set 'Parameters:cloudflare-account-id' '<32-hex-account-id>' --project src/Keyloop.ServiceScheduler.AppHost
dotnet user-secrets set 'Parameters:cloudflare-ai-token' '<workers-ai-read-token>' --project src/Keyloop.ServiceScheduler.AppHost
```

The AppHost passes `Triage__*` only when both parameters are present and starts without them; the token never goes in appsettings. The Cloudflare deployment keeps `KEYLOOP_TRIAGE_ENABLED=false` by default, and public enablement is a deliberate operator decision.

| `Triage` option | Default |
|---|---|
| Total timeout | 8 s |
| Suggestion confidence | 0.5 |
| Candidate floor / relative floor | 0.10 / 0.50 |
| Date confidence | 0.60 |
| Uncovered-issue confidence | 0.50 |
| Description limit | 500 characters |
| `Security:RateLimiting:TriagePermitsPerMinute` | 10 |

**Evidence.** Regular tests use a stub `HttpMessageHandler`. The 49-fixture `LiveAi` category runs only with `KEYLOOP_LIVE_AI=1` and both Triage settings, and writes [the golden-set report](docs/media/triage-clef-flash-golden-set.md); ordinary verification excludes it with `--filter 'Category!=LiveAi'`.

The run of 2026-10-13 (text only) chose an accepted service in 42/49 (natural descriptions 33/36) and raised no false uncovered-issue notice. It took p50 590 ms and p95 959 ms at about 2,150 input tokens per request, and the thresholds above were calibrated on it. Photo cases are not yet measured; the earlier [Jev report](docs/media/triage-live-golden-set.md) is historical.

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

Use a short `TMPDIR`: Microsoft.Testing.Platform's pipe path must stay under 104 bytes on macOS. Frontend checks run in `src/Keyloop.ServiceScheduler.Web`:

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

**The concurrency proof.** Five rounds of thirty simultaneous requests for a dealership with one qualified resource pair must give:

- exactly **one 201 and twenty-nine 409**, with no 5xx and no Error logs;
- no deadlock or constraint-backstop events;
- one active appointment with its history row, and no orphan history or idempotency rows.

Further cases check distinct slots, measured queueing and independence between dealerships. The lock-disabled comparison was a scratch mutation probe; there is no product switch for disabling the lock.

**Aspire smoke tests** live in their own project because the Aspire testing host needs reflection-based JSON, which the API integration process disables. The fixture waits for API and web health under one five-minute deadline, then reads `/api/v1/dealerships` through the web proxy and checks the exact seeded names.

**Browser E2E tests** (`Category=E2E`) use .NET Playwright with Chromium and Aspire.Hosting.Testing.

- Install Node 22 and pnpm first. On a fresh Linux machine set `KEYLOOP_E2E_INSTALL_DEPS=1` for Chromium's system dependencies.
- Two fixtures serialise an Admin stack and an anonymous stack with temporary passwords and no named volume. Dates come from Reading's operating hours on the real clock. Do not run the suite beside an Aspire smoke test or a developer AppHost.
- Failed journeys keep traces, screenshots, accessible snapshots, logs and video under `TestResults/e2e/`; open a trace with `pnpm dlx playwright@1.63.0 show-trace <trace.zip>`. Passing ones keep result JSON, axe results and dark-mode screenshots.
- The journeys cover booking and conflict recovery, API 400/422 form feedback, cancellation and history, filters with URL persistence, overview and calendar consistency, vehicle competence, Admin stale edits and policy preview tokens, visitor masking, Mailpit, phone booking, dark mode and serious or critical axe findings.

**Continuous integration.** The [CI workflow](.github/workflows/ci.yml) runs backend build, test and contract checks, NuGet vulnerability auditing, frontend client drift checks, Aspire smoke tests, the E2E job, API and web image builds, edge checks, Grafana validator checks and offline k6 self-tests. [Dependabot](.github/dependabot.yml) groups weekly updates.

Totals from the clean integrated checkout of 2026-10-13. Its coverage run measured 86.7% line and 76.0% branch coverage of the API, Domain and Infrastructure assemblies from the integration suite, and 91.8% line coverage of Domain from the unit suite alone.

| Suite | Count | Note |
|---|---|---|
| Unit | 1,058 | |
| Integration | 893 | about 3.5 minutes, including 19 contract tests and the ten-case 30-way concurrency proof |
| Aspire smoke | 20 | 27 s |
| Browser journeys | 15 | about 1 minute 50 s |
| Web | 1,588 | |
| Edge | 347 | |

GitHub Actions run 38428132843 passed all eight required checks on `c0e2a52`, and every pull request to `main` runs the same checks.

## Try it with curl

Routes and body fields follow the [OpenAPI contract](contracts/openapi/v1.json). The sequence was rehearsed on 2026-10-13 against an isolated Development stack, with the outcomes the comments state.

Set `API_BASE` to the API's plain-HTTP endpoint from the dashboard, without a trailing slash, and `DATE` to a future open local date in Reading (`yyyy-MM-dd`, within the booking horizon).

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

If `.slots[0]` is absent, inspect `unavailableReason` and choose another open date.

- Normal contention is `https://api.keyloop.example/problems/slot-unavailable`, with `suggestedSlots` when the day has later capacity; the database backstop is `https://api.keyloop.example/problems/slot-conflict`. Both are `application/problem+json` with a `traceId`, and the URIs are contract identifiers.
- A second cancel is `409 invalid-state-transition`; a stale concurrent update is `409 concurrency-conflict`; a live key with a different body is `422 idempotency-key-reuse`.
- Keep one key across transport retries of one booking intention. A new unkeyed request can allocate a second appointment when spare resources exist, and a new booking after cancellation needs a new key.

## Project layout

The layout follows ADR-025:

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

Api references Infrastructure and Domain; Infrastructure references Domain only; Domain has no project or package references. Handlers sit beside their endpoints and query `SchedulerDbContext` directly; there is no Service/Application project or repository layer. Unit architecture tests guard both the project files and the compiled assembly references.

## Design summary

[ARCHITECTURE.md](docs/ARCHITECTURE.md) contains the domain, availability algorithm, C4 diagrams, trade-offs and ADRs.

Availability shrinks each resource's free gaps by the full service duration before combining feasible starts; it never pools short gaps across technicians or bays. Allocation honours qualified free preferences, then chooses by surplus qualifications, daily load, ordinal name and id.

The concurrency model in [§7](docs/ARCHITECTURE.md#7-concurrency-and-data-integrity), ADR-003 and ADR-004:

1. PostgreSQL stores a generated `tstzrange(start_utc, end_utc, '[)')`; adjacent appointments do not overlap.
2. Partial GiST exclusion constraints independently forbid overlapping bays and technicians in `Confirmed`, `CheckedIn` and `InProgress`.
3. A live matching idempotency key replays before rule or availability checks; mismatched fingerprints are refused.
4. Booking opens an explicit `READ COMMITTED` transaction and takes its dealership's transaction-scoped advisory lock before any write.
5. After the lock, it checks the request's minted id, rechecks the key, deletes an expired key row if needed, and reads the schedule with fresh statement snapshots.
6. It revalidates whole-duration availability and allocates a qualified bay and technician while holding the lock.
7. Appointment, history and any successful-response key commit atomically; refusals roll back, and the lock ends with the transaction.
8. ADR-003 forbids a second lock or contended insert except the request's own key row; cross-dealership same-key waits cannot close a lock cycle.
9. Transient retries rerun the whole transaction under one request id; `verifySucceeded` and the in-lock id check recognise a lost commit acknowledgement.
10. State changes use `xmin` for first-writer-wins and `409 concurrency-conflict`; cancellation recovery takes a first-and-only row lock when settling an in-doubt commit.

`23P01` maps to `409 slot-conflict` and increments `scheduler.booking.constraint_backstop`. A `40P01` from booking `SaveChanges` is answered without retry and records event `1004` plus `scheduler.booking.deadlocks` (§7.4).

Per-dealership serialisation trades maximum site throughput for a small, reviewable protocol; this README makes no measured throughput claim. If retries run out while a post-commit notification is still in doubt, the request can return `500 internal-error` although a transaction committed. The history row remains atomic with the appointment.

## Environments and configuration

The environment model is [ARCHITECTURE §10](docs/ARCHITECTURE.md#10-environments-and-configuration). Deployment rows describe the specified posture, not a completed deployment.

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

The shared production/UAT global rate limit is 300/min/IP. Every environment answers problems with a `traceId` and no exception details. Production disables the runtime OpenAPI and Scalar mapping; the Cloudflare edge publishes the committed contract at `/openapi/v1.json` with a static Scalar reference at `/scalar/v1` ([edge README](deploy/cloudflare/README.md#static-api-reference)).

- **Options** come from `appsettings.json`, environment files, Development user secrets and environment variables. Aspire injects `ConnectionStrings__schedulerdb` and telemetry settings, and `[OptionsValidator]` plus generated binding validate them at startup.
- **Key settings:** `Auth:Mode`, `Auth:TeamDomain`, `Auth:Audience`, `Auth:Roles:{Admin,ServiceAdvisor,Viewer}`, `Scheduling`, `Database:MigrateOnStartup`, `Database:SeedDemoData`, `Security:AllowedOrigins` and `Security:ForwardedHeaders`.
- **Forwarded headers.** UAT and Production enable them with empty trusted-peer lists and refuse startup until the platform supplies `KnownProxies` or `KnownNetworks`. Startup diagnostics name members and paths, never raw values.
- **Database role.** UAT and Production run as `scheduler_app`, with migrations as owner. The [runtime-role script](deploy/neon/runtime-role.sql) makes audit and policy tables append-only, forbids appointment DELETE and grants only the per-table writes the API needs.

**Identity** ([ADR-027](docs/ADR-027.md)). Cloudflare Access signs people in, and API roles come from external lists, never token claims. See the [operator checklist](deploy/cloudflare/README.md#access-login-and-api-roles) before deployment.

- Public reads mask personal data. Booking, cancellation and triage writes need Admin or ServiceAdvisor; details need any role; reseed needs Admin plus its key.
- `GET /api/v1/me` discovers the identity, roles and the `/auth/login?returnTo=%2F` and `/cdn-cgi/access/logout` URLs. There is no password form and no JWT in browser storage.
- `Auth:Mode=Development` fails outside Development; `None` is SystemTest-only and grants no write access.

### Publish a local Demo bundle

`aspire publish` generates Compose YAML and `.env`; it does not build images, fill secrets or create EF migration bundles (`aspire deploy --apphost src/Keyloop.ServiceScheduler.AppHost -o artifacts/compose` is the managed pipeline). The manual sequence uses the committed Dockerfiles and an isolated project:

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

The manual inputs are `API_IMAGE`, `WEB_IMAGE`, `POSTGRES_PASSWORD`, `ACCESS_TEAM_DOMAIN` and `ACCESS_AUDIENCE`; Demo validates Access configuration and has no Development bypass.

- nginx serves the static app with CSP, frame, `nosniff`, referrer, permissions and COOP headers on a dynamic host port, and proxies `/api`, `/auth`, `/openapi` and `/scalar` to `http://api:8080` with the URI unchanged.
- The API trusts only the generated `172.30.14.0/24` network and stays unpublished, because that subnet includes the host-port bridge gateway.
- Never use or remove `keyloop-scheduler-pgdata` for verification. UAT and Production still need configured ingress trust and a separately generated EF migration bundle.

## Observability

Use the Aspire dashboard to follow an action from browser to SQL:

1. **Resources:** PostgreSQL, API and web readiness; pgweb and Scalar; masked parameters; the demo reseed command.
2. **Traces:** book once, then inspect `scheduler.book_appointment`, `scheduler.acquire_dealership_lock`, `scheduler.compute_availability`, `scheduler.persist_appointment` and the Npgsql spans, with `booking.outcome` and `lock.wait_ms`.
3. **Metrics:** `scheduler.booking.requests` by outcome, `scheduler.booking.duration` and `scheduler.booking.lock_wait`. The concurrency proof requires `scheduler.booking.deadlocks` and `scheduler.booking.constraint_backstop` to stay zero on its normal path.
4. **Structured logs:** filter by `AppointmentId`, `DealershipId` or request correlation. Expected conflicts have explicit events; unexpected failures stay Error.
5. **Browser correlation:** `ui.book_appointment` and `ui.booking_triage` propagate into the backend spans. Browser OTLP credentials exist only in the Development dev server.

`/alive` is the process probe; `/health` requires connectivity and applied migrations, and the Cloudflare verifier requires the edge-only `GET /api/ready` that wraps it. Business time uses `TimeProvider`; durations use `Stopwatch`. [§12](docs/ARCHITECTURE.md#12-observability) lists instrument names, correlation and proposed alert thresholds.

The k6 [full local gate](tests/load/k6/README.md#full-local-gate) passed on 2026-10-13 against a local Release API: availability p95 20 ms, booking p95 28 ms, a 30-minute soak with no 5xx, and exactly one winner per 30-way round. These are local figures, not the deployed demo's.

### Grafana Cloud

The container's OTLP export to Grafana Cloud is an optional Worker setting, `KEYLOOP_API_OTLP_ENABLED`, with a Secrets Store token read at container start ([edge README](deploy/cloudflare/README.md#optional-api-telemetry)).

Its series carry `job="keyloop-scheduler/api"` and `deployment_environment_name="Production"`, which the committed [dashboards as code](observability/grafana/README.md) select. The [runbook](deploy/cloudflare/DEPLOY-RUNBOOK.md#enable-api-telemetry) orders enabling it; verification against deployed data and alert contact points follow.

## Runtime reflection budget

The source-generation policy is [ADR-016 / §9.1](docs/ARCHITECTURE.md#91-runtime-reflection-budget-and-nativeaot-readiness). `scripts/aot-readiness.sh` forces a Release analyzer rebuild, keeps its logs under `artifacts/aot-readiness/` and deduplicates diagnostics; CI uploads the result as the **AOT readiness** artifact. This is analyzer evidence; `PublishAot` is not enabled.

| Concern | Implementation | Residual work |
|---|---|---|
| Request dispatch, JSON | Request Delegate Generator and Api `SchedulerJsonContext`; Infrastructure `PersistenceJsonContext` for audit/outbox JSON; reflection-based JSON disabled | Register every new wire/extension type; a missing registration fails instead of falling back |
| Mapping, binding, validation, logging, regex | Mapperly, configuration binder generator, `[OptionsValidator]`, `[LoggerMessage]`, `[GeneratedRegex]` | Maintain generated paths |
| Endpoint/handler/validator discovery | Explicit registry and DI registrations | No assembly scanning |
| Microsoft DI | Explicit registrations, framework container | Constructor discovery at startup, accepted in the budget |
| FluentValidation | Explicit validators | Expression compilation remains |
| EF Core | Runtime model and query translation, migrations in local/test environments | Evaluate compiled models and precompiled queries; externalise migrations for an eventual AOT runtime |
| OpenAPI | Build-time document and XML-comment generation | Attribute reflection only while generating a document outside Production |

On the clean clone of `64a91f0` (2026-10-13) the Release analyzer build reported six unique diagnostics, none application-owned. All six come from EF Core: 1 IL2026 and 5 IL3050 at the `SchedulerDbContext` constructor and the `DatabaseInitializer` and `SchedulerReadinessCheck` migration calls.

Compiled models and deployment-time migrations are the removal path. The compiled-model step (`dotnet ef dbcontext optimize ... --output-dir Persistence/CompiledModels`) is deferred: a stale generated model is a correctness risk, and it does not by itself establish NativeAOT support.

The DbContext, design-time factory and migrations live in Infrastructure; migration commands use Api as the startup project:

```bash
dotnet tool restore
dotnet ef migrations add <Name> --project src/Keyloop.ServiceScheduler.Infrastructure \
  --startup-project src/Keyloop.ServiceScheduler.Api --output-dir Persistence/Migrations
dotnet ef migrations has-pending-model-changes --project src/Keyloop.ServiceScheduler.Infrastructure \
  --startup-project src/Keyloop.ServiceScheduler.Api
dotnet ef migrations bundle --project src/Keyloop.ServiceScheduler.Infrastructure \
  --startup-project src/Keyloop.ServiceScheduler.Api
```

## Deployment

The public demo at `keyloop.kylesmile.me` runs on Neon PostgreSQL 17 (Frankfurt, a DML-only runtime role and an owner role for migrations), a Cloudflare Worker with static assets in front of the API in a Cloudflare Container, Cloudflare Secrets Store for credentials and Cloudflare Access for sign-in. Email delivery stays off in the demo.

The [edge implementation and runbook](deploy/cloudflare/README.md) are committed; [ADR-022..024](docs/ARCHITECTURE.md#18-architecture-decision-records) define the Worker, the Container, PostgreSQL and the credential boundary.

### CI/CD

[CI](.github/workflows/ci.yml) is the validation gate. [Deploy public demo](.github/workflows/deploy.yml) then runs four jobs on an exact successful main SHA:

1. **plan** builds the API image natively with a 12-character SHA tag and dry-runs the edge deployment.
2. **migrate** (manual `migrate=true` only) applies pending EF migrations and idempotent Neon runtime grants, behind the `production` environment's reviewer approval.
3. **deploy** also waits for that approval. Main advancing while approval is pending fails the old release.
4. **verify** polls the real container image and checks readiness, the SPA, the feature flag, the exact OpenAPI document and anonymous masking within six minutes.

`plan` and `verify` use a reviewer-less `plan` environment with a separate inspection token. Migration-owner credentials stay in `production` and application credentials in Secrets Store. The [Actions runbook](deploy/cloudflare/DEPLOY-RUNBOOK.md#deploy-from-github-actions) lists the inputs and the one-time setup; the laptop path remains the break-glass fallback.

## AI Collaboration Narrative

### Strategy and evidence

- **Design.** Claude **Fable 5.1** designed the architecture and the written plan, following the author's design-first instruction. The plan, with reflection/AOT, OpenAPI/UI and Aspire addenda, stays outside the repository; the committed record of its decisions is the ADR table in [ARCHITECTURE.md §18](docs/ARCHITECTURE.md#18-architecture-decision-records).
- **Implementation.** Claude **Opus 5.5** implemented and reviewed task by task: a brief, an implementation report, an independent review, fix rounds and scoped re-reviews. Backend, concurrency and frontend ran as separate lanes, one implementer per worktree. Some early work used Sonnet-labelled agents whose commits carry Fable trailers, so a trailer is not proof of the model behind every change.
- **Cross-model work.** **OpenAI Codex (gpt-6.1-sol)** took isolated delegations: CI and Dependabot, AOT measurement and the walkthrough (`5cdebea`, `dfc9493`, `a098a67`), and an adversarial backend review at `0ca96b1` with its hardening fixes (`cdc2e96` through `533b1e0`). Claude Opus then reviewed those fixes in the other direction and approved them.
- **Aspire and illustrations.** Codex audited the Aspire model against `dotnet/aspire-samples` (`a85d501`, `bc462ec`, `a574af9`, `ec455c3`) and produced the UI illustrations with OpenAI's image-generation tool, which exposed no model identifier.
- **Visual design.** Claude in Chrome researched Keyloop's public design language. A separate design workflow produced the theme tokens and component recipes and revised them against contrast, build and brand checks ([UI_DESIGN.md](docs/UI_DESIGN.md)). This is a take-home demo inspired by Keyloop, not an official product.

### Verification practices

- **RED before GREEN**, including behavioural failures for existing defects. Characterisation tests that were already green were named as such.
- **Mutation probes** removed guards, registrations, constraints or middleware to confirm a test could fail: exclusion-constraint removal, idempotency-order mutations, a lost-commit fault injector, an independent availability oracle, the HSTS removal probe.
- **Strict builds.** Warnings are errors, reflection-based JSON is disabled in the API and its integration tests, and mapping and contract drift checks catch generated-code omissions.
- **Independent checks.** Reviewers retraced the availability example and DST values by hand and asked for fixes rather than weaker assertions.
- **Final gates.** The suites do not establish Chrome layout, console or network cleanliness, so Chrome visual QA, a clean-clone gate and an independent whole-branch review by Codex ran on 2026-10-13. Their findings are the last rows below.

### Defects the process found

| Area | Defect | Outcome |
|---|---|---|
| Test runner | VSTest incompatible with xunit.v3 and obsolete coverage packages | Microsoft.Testing.Platform and native coverage (`c76fe9b`) |
| Domain values | Record `ToString` leaked the full VIN | Masked output with a regression test (`e308e54`) |
| DST windows | Contradictory DST ambiguity rules in the design | Earlier-instant rule, independently checked (`3d000bd`) |
| Booking observers | Observer failures could turn committed bookings into errors and retries | Post-commit failures isolated and logged (`73e62d9`) |
| Rate limiting | 429 became 500 when `Accept` excluded JSON | `TryWriteAsync` plus tests (`227f7a6`) |
| Forwarded headers | No handling; partial array overrides could keep broad trust | Explicit trusted peers, fail-closed defaults (`227f7a6`, `72d57ce`) |
| Availability query | The active-technician filter had no effective regression test | A test that fails without the filter (`86e5d24`) |
| Local times | No offsets; `zzz` on `DateTime` used the machine offset | `DateTimeOffset` local strings (`3c4b876`) |
| Idempotency order | Replay checked after availability, refusing a client's own success | Key lookup before availability and under the lock (`2a25835`) |
| Lost COMMIT | A second unkeyed appointment after a lost acknowledgement | Stable request id, commit verification, in-lock guard (`c51ba9e`) |
| Isolation level | REPEATABLE READ kept the snapshot taken before waiting | Explicit READ COMMITTED, tested (`2a25835`, ADR-004) |
| OpenAPI contract | Overwritten body descriptions, untyped enums, missing traceId schema, incomplete 429 docs | Transformers, response metadata, parity tests (`da69f02`, `9f5a168`) |
| In-doubt commits | Inconclusive verification dropped events before the lock settled them | The doubt is kept until a conclusive read (`55ca317`) |
| Cancellation recovery | An in-doubt commit was forgotten after another transient fault | Request-lifetime written-version marker (`2c055e1`) |
| Startup diagnostics | Validators and fallback logs leaked raw configuration values | Member, index, path and type names only (`cdc2e96`) |
| Operating hours | Sub-minute hours produced starts that booking rejected | Whole-minute guards and a database CHECK (`d8b0417`) |
| Readiness | Healthy with an unmigrated database | Connectivity plus pending-migration check (`bff9fc4`, `64f159f`) |
| Horizon bounds | An extreme UTC start overflowed to 500 before validation | Bound the start before slot arithmetic (`f34f5c8`) |
| Optional keys | The design promised unkeyed retries could never double-book | Corrected semantics, spare-capacity tests, a stable UI key (`8dac682`) |
| Request correlation | The promised X-Request-Id echo and log scopes were absent | Bounded UUID echo, CORS exposure, Activity tags (`beb971c`) |
| HSTS | Tests stayed green with HSTS removed | Deployment cases proven RED by middleware removal (`2622631`) |
| AOT bounds | Trim-sensitive TimeSpan validation | Typed bounds through the generated validator (`533b1e0`) |
| Frontend theme and client | The theme ignored system changes; a lazy-import test was vacuous; generation could delete runtime config | Behaviour tests, an import probe, `output.clean=false` (`19fdf75`, `773103a`) |
| Frontend interceptors | One request id per session; auto dealership selection cancelled a pending navigation | Per-request interceptor, navigation-aware selection (`773103a`) |
| Qualification locks | A booking could commit with a resource that lost its qualification while it waited; dealership ids on metric labels; policy churn answered 500 | Admin writes under the dealership lock (`5b70e67`), bounded labels (`de3c6f4`), retryable `409` (`0593c46`) |
| Live rollout | A request during a version hand-over got a raw 500 from the edge | RFC 9457 `503` with `Retry-After`, one retry for safe methods (`c3e9e02`) |
| Whole-branch review | A booking could commit after its start passed while waiting for the lock | Window revalidated under the lock (`894bf89`) |
| Whole-branch review | Catalogue and triage used the legacy HV certificate; availability and booking used levels | One qualification model with parity tests (`91417fb`) |
| Whole-branch review | Runtime grants allowed audit updates and appointment deletes; deploy verification passed with a migration missing | Per-table grants with 15 role tests, an `/api/ready` gate, an inventory from the pinned bundle (`71b5f7d`) |
| Clean-clone gate | Role tests exhausted the test server's connections; a journey's booking sorted onto page 2 | Pools released per test (`5049620`), search before asserting (`f5c6fb1`) |

All fixes are integrated on `main`.

### Rejections and trade-offs

- A mediator and assembly scanning: rejected for direct handlers and explicit registration (ADR-001/016).
- Row locks as the primary guarantee, SERIALIZABLE retry storms and a single-writer queue: rejected on correctness, contention and operational cost. Exclusion constraints alone are correct but can cause mutual waits; the advisory lock supplies the normal serialisation path (§7.2/7.3).
- Jab or Pure.DI in place of Microsoft's container: rejected as risk for limited gain. EF compiled models and `PublishAot`: deferred, they need more than suppressed warnings.
- Same-VIN or body-based deduplication to disguise the unkeyed retry defect: not added. Independent same-vehicle bookings stay valid; the optional-key contract stays explicit.
- MiroTalk's AGPL code: never copied. The MIT template's auth, chat, mail, landing, pricing and billing apps, and Keyloop's logos and images: excluded.
- A product switch for disabling the lock: not added for a test. Scratch mutation evidence demonstrates the trade-off without a production escape hatch.

### Process incidents and lessons

- **Duplicate agents.** A message to running implementers resumed duplicates in the same worktrees. One cleared the persisted database password, which was restored from the running container without displaying it. Rule adopted: pass mid-run changes through briefs and workflow results, and verify exclusive worktree ownership before destructive maintenance.
- **Colliding edits.** A hand-applied punctuation sweep collided with concurrent edits and corrupted text in `CLAUDE.md`. The repair reapplied the exact replacement to committed text, then rebuilt and tested before a separate style commit per lane (`c156b83`, `a38342e`). Lesson: no broad edits over an active implementer's files, and validate the whole diff.
- **Leftovers.** A killed mutation run left temporary mutants, restored before committing. A documentation commit polluted a review range, and the review package was rebuilt without it.

These are process failures with recorded recovery, not examples of a flawless automated workflow.

## Video

The [video walkthrough guide](docs/VIDEO_WALKTHROUGH.md) outlines the 10-minute presentation: the scenario and dispatch board, system design and C4 architecture, implementation highlights, a live booking, conflict and cancellation, the 30-way concurrency proof, the Aspire observability tour and the AI collaboration narrative.

## Licence and attribution

The dispatch board adapts the **MIT-licensed shadcn-dashboard-landing-template (Vite variant)** by ShadcnStore and the MIT **shadcn/ui** primitives it vendors. That covers the project layout and configuration, the application shell, `components/ui/*`, the Tailwind v4 theme tokens, and the template's dashboard, calendar, tasks, users, settings and errors apps, adapted to the generated API client with their sample data removed.

Every adopted file opens with a header comment naming its template source and carrying the template's copyright line; the primitives' headers also carry shadcn/ui's. `src/Keyloop.ServiceScheduler.Web/src/attribution.test.ts` keeps that list and fails when a header is missing. `package.json` and `components.json`, started from the template's, are covered by the notice below. No repository-wide application licence is inferred from the template's licence.

Reference material, kept outside this repository (one level up, never committed):

| Reference | Upstream | Licence | Used for |
|-----------|----------|---------|----------|
| shadcn-dashboard-landing-template (vite-version) | https://github.com/shadcnstore/shadcn-dashboard-landing-template | MIT | App shell, `components/ui/*`, Tailwind v4 tokens, ESLint/TS config (vendored, "own your components") |
| carcareco | https://github.com/rene98c/carcareco | see upstream | Domain inspiration only (vehicle/work-order shape); no code copied |
| MiroTalk WEB (booking module) | https://github.com/miroslavpejic85/mirotalkwebrtc | AGPL-3.0 | Design inspiration only (availability model, DST handling, re-check-then-insert); **no code copied** |

The typefaces are **Plus Jakarta Sans** (Copyright 2020 The Plus Jakarta Sans Project Authors), **IBM Plex Sans** (Copyright 2019 IBM Corp.) and **IBM Plex Mono** (Copyright 2017 IBM Corp.), all under the **SIL Open Font License 1.1**, served from the `@fontsource` packages whose `LICENSE` files carry the full licence text.

The illustrations and backdrops were generated for this project with OpenAI's image-generation tool, without third-party source images, logos or real people. The files live in [`src/Keyloop.ServiceScheduler.Web/src/assets/illustrations`](src/Keyloop.ServiceScheduler.Web/src/assets/illustrations), and [UI_DESIGN §12](docs/UI_DESIGN.md#12-illustrations-empty-and-error-states) documents their use and alt text.

The deployed site's static API reference (`/scalar/v1` on the Cloudflare edge, [edge README](deploy/cloudflare/README.md#static-api-reference)) serves the browser bundle of **Scalar API Reference** (`@scalar/api-reference` 1.72.2, Copyright (c) 2023-present Scalar, **MIT**, https://github.com/scalar/scalar) unmodified from the edge's pinned npm dependency.

Its notice is published beside it as `/scalar/LICENSE.txt` (source: `deploy/cloudflare/api-reference/SCALAR-LICENSE.txt`). The API's own Development reference uses the MIT `Scalar.AspNetCore` NuGet package by the same authors.

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
