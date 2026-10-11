# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

The Keyloop Principal Software Engineer technical assessment, Scenario A: a **Unified Service Scheduler** for dealership workshops. The **backend is the evaluated deliverable**; the React app is a dispatch-board harness that exercises the real API. The brief is at `../docs/KeyloopCodingChallange.pdf` (outside the repo). Two documents are the source of truth and must stay consistent with the code:

- `docs/SYSTEM_DESIGN.md` — domain model, availability algorithm, concurrency strategy, API/problem catalogue, environments, security, observability, ADRs. Read §5–§8 before touching backend code.
- `docs/superpowers/plans/2026-10-11-keyloop-service-scheduler.md` — the task-by-task implementation plan with exact type names and test lists.

## Commands

Prerequisites: .NET SDK 10.0.100 (`global.json`), Node 22 + pnpm, and a running Docker daemon. On this machine Docker is provided by **Colima**: `colima status` and, if stopped, `colima start --cpu 4 --memory 6 --disk 40`.

```bash
# whole stack (PostgreSQL container, API, Vite app, Aspire dashboard)
dotnet run --project src/Keyloop.ServiceScheduler.AppHost

# build with the same strictness as CI (warnings are errors)
dotnet build -warnaserror

# tests
dotnet test tests/Keyloop.ServiceScheduler.UnitTests                               # pure domain, no Docker
dotnet test tests/Keyloop.ServiceScheduler.IntegrationTests                        # Testcontainers PostgreSQL 17
dotnet test tests/Keyloop.ServiceScheduler.IntegrationTests --filter FullyQualifiedName~Concurrency   # 30-way contention proof
dotnet test tests/Keyloop.ServiceScheduler.IntegrationTests --filter "FullyQualifiedName~BookAppointmentTests.Books_and_returns_201"  # single test

# OpenAPI contract: export (rewrites contracts/openapi/v1.json) and check for drift
scripts/export-openapi.sh
dotnet test tests/Keyloop.ServiceScheduler.IntegrationTests --filter Category=Contract

# EF Core migrations (design-time factory needs no database)
dotnet ef migrations add <Name> --project src/Keyloop.ServiceScheduler.Api -o Infrastructure/Persistence/Migrations

# frontend (run inside src/Keyloop.ServiceScheduler.Web)
pnpm install && pnpm generate:api      # regenerates src/api/*.gen.ts from contracts/openapi/v1.json — never hand-edit generated files
pnpm dev | pnpm lint | pnpm typecheck | pnpm test | pnpm build
```

## Architecture in one screen

- **Vertical slices, no mediator.** `src/Keyloop.ServiceScheduler.Api/Features/<Capability>/<Slice>/` holds the endpoint (implements `IEndpoint`, discovered by reflection into the `/api/v1` group), request record, FluentValidation validator (applied by `ValidationFilter<T>`), handler (plain class registered in DI), and response records. Handlers query `SchedulerDbContext` directly; there is no repository layer.
- **Domain is persistence-ignorant.** `Domain/` contains aggregates (`Appointment`, `Dealership`), entities (`ServiceBay`, `Technician`, `ServiceType`), value objects (`TimeSlot`, `Vin`, `ServiceDuration`, `OperatingHours`) and domain services (`AvailabilityCalculator`, `AllocationPolicy`, `BookingWindowPolicy`). It never references EF Core or ASP.NET Core. Rule violations throw `DomainRuleViolationException(ruleCode, …)` whose `ruleCode` is the problem slug (→ 422); illegal lifecycle calls throw `InvalidStateTransitionException` (→ 409).
- **Concurrency model (do not weaken):** the overlap invariant lives in PostgreSQL as two partial GiST **exclusion constraints** on `appointments(bay_id, time_range)` and `(technician_id, time_range)` over a stored generated `tstzrange`. `BookAppointmentHandler` runs at **`READ COMMITTED`**, takes `pg_advisory_xact_lock(dealershipKey)` first, then checks and inserts. A booking transaction must never take a second lock or perform a second contended insert (ADR-003). `xmin` is the concurrency token for state transitions. `PostgresErrorClassifier` is the single place SQLSTATEs are interpreted.
- **Time:** UTC `DateTime` everywhere in code and DB; dealership `TimeZoneId` (IANA) drives operating hours via `LocalTimeConverter` (DST gap → first valid instant, ambiguity → earlier instant). Half-open intervals. Inject `TimeProvider`; never call `DateTime.UtcNow`.
- **Errors:** RFC 9457 ProblemDetails with types under `https://api.keyloop.example/problems/<slug>`; 400 = malformed, 422 = business rule, 409 = state conflict (`slot-unavailable`, `slot-conflict`, `invalid-state-transition`, `concurrency-conflict`). `GlobalExceptionHandler` is the only mapper.
- **Audit/events:** aggregates raise domain events; `DomainEventInterceptor` writes `appointment_history` rows in the same transaction and notifies `IDomainEventObserver`s after commit.
- **Telemetry:** `SchedulerTelemetry` owns the `ActivitySource`/`Meter` named `Keyloop.ServiceScheduler`; ServiceDefaults wires OTLP to the Aspire dashboard. Metric names are part of the design (§12) — do not rename.
- **Contract sync:** the integration test `OpenApiContractTests` exports `/openapi/v1.json` to `contracts/openapi/v1.json` (`UPDATE_CONTRACT=1`) and otherwise fails on drift; HeyAPI (`openapi-ts.config.ts`) generates `src/api/*.gen.ts` including TanStack `queryOptions`/`mutationOptions`. Operation ids (`BookAppointment`, `GetAvailability`, …) are stable API.
- **Environments:** `Development` (migrate + seed on startup, Scalar on), `SystemTest` (integration tests; rate limiting off), `UAT`/`Production` (migration bundles, no seed, Scalar off in Production). Behaviour differs only via `appsettings.{Env}.json` and options classes validated on start.
- **Frontend conventions** follow the shadcn dashboard template (Vite variant): Base UI primitives, `cn` from the `cn` package inside `components/ui`, `@/` alias, Tailwind v4 tokens in `src/index.css`. Vite proxies `/api`, `/openapi`, `/scalar` to the API (no CORS in dev). Aspire sets `PORT` and `VITE_API_PROXY_TARGET`.

## Working rules specific to this repo

- Keep `docs/SYSTEM_DESIGN.md` and the code in agreement; if a design decision changes, update the ADR table in the same commit.
- Test names describe behaviour (`Rejects_off_grid_start_422`); domain tests use `FakeTimeProvider` at `2026-10-12T08:00:00Z` and book on `2026-10-13`.
- Integration tests need Docker; the concurrency test runs five rounds and its assertions are not to be loosened — a failure is a design defect.
- `references/` holds provenance notes only; the reference clones live outside the repo and the AGPL one (MiroTalk) must never be copied.
- Commit messages: Conventional Commits, ending with the `Co-Authored-By`/`Claude-Session` trailers used in the existing history.
