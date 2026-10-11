# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Resuming this project in a fresh session? Read `docs/HANDOFF.md` first** — current state, process, remaining tasks with binding carry-overs, rulings and gotchas.

## What this repository is

The Keyloop Principal Software Engineer technical assessment, Scenario A: a **Unified Service Scheduler** for dealership workshops. The **backend is the evaluated deliverable**; the React app is a dispatch-board harness that exercises the real API. The brief is at `../docs/KeyloopCodingChallange.pdf` (outside the repo). Two documents are the source of truth and must stay consistent with the code:

- `docs/SYSTEM_DESIGN.md` — domain model, availability algorithm, concurrency strategy, API/problem catalogue, environments, security, observability, ADRs. Read §5–§8 before touching backend code.
- `docs/superpowers/plans/2026-10-11-keyloop-service-scheduler.md` — the task-by-task implementation plan with exact type names and test lists.

## Commands

Prerequisites: .NET SDK 10.0.100 (`global.json`), Node 22 + pnpm, and a running Docker daemon. On this machine Docker is provided by **Colima**: `colima status` and, if stopped, `colima start --cpu 4 --memory 6 --disk 40`.

```bash
# whole stack (PostgreSQL container, API, Vite app, Aspire dashboard); `aspire run` is equivalent
dotnet run --project src/Keyloop.ServiceScheduler.AppHost

# Docker Compose bundle generated from the AppHost model (Demo environment)
aspire publish --project src/Keyloop.ServiceScheduler.AppHost -o artifacts/compose

# build with the same strictness as CI (warnings are errors)
dotnet build -warnaserror

# tests
dotnet test --project tests/Keyloop.ServiceScheduler.UnitTests                               # pure domain, no Docker
dotnet test --project tests/Keyloop.ServiceScheduler.IntegrationTests                        # Testcontainers PostgreSQL 17
dotnet test --project tests/Keyloop.ServiceScheduler.IntegrationTests --filter "FullyQualifiedName~Concurrency"   # 30-way contention proof
dotnet test --project tests/Keyloop.ServiceScheduler.IntegrationTests --filter "FullyQualifiedName~BookAppointmentTests.Books_and_returns_201"  # single test
dotnet test --project tests/Keyloop.ServiceScheduler.AspireTests                         # whole-stack smoke (Category=Aspire): boots the AppHost; one AppHost per machine at a time

# OpenAPI contract: every `dotnet build` of the API rewrites contracts/openapi/v1.json (build-time generation, no database needed);
# the script forces a regeneration even when the API assembly is unchanged and prints `git status` for contracts/ — commit the file
scripts/export-openapi.sh
dotnet test --project tests/Keyloop.ServiceScheduler.IntegrationTests --filter "Category=Contract"   # runtime document == committed file, contract rules

# API container image (context: the repository root; Dockerfile.dockerignore next to the Dockerfile narrows it)
docker build -f src/Keyloop.ServiceScheduler.Api/Dockerfile -t keyloop-scheduler-api .

# EF Core migrations (design-time factory needs no database; dotnet-ef is pinned in .config/dotnet-tools.json)
dotnet tool restore && dotnet ef migrations add <Name> --project src/Keyloop.ServiceScheduler.Api -o Infrastructure/Persistence/Migrations

# frontend (run inside src/Keyloop.ServiceScheduler.Web)
pnpm install && pnpm generate:api      # regenerates src/api/*.gen.ts from contracts/openapi/v1.json — never hand-edit generated files
pnpm dev | pnpm lint | pnpm typecheck | pnpm test | pnpm build
```

## Architecture in one screen

- **Vertical slices, no mediator.** `src/Keyloop.ServiceScheduler.Api/Features/<Capability>/<Slice>/` holds the endpoint (implements `IEndpoint`, listed in `EndpointRegistry`, which maps it into the `/api/v1` group), request record, FluentValidation validator (applied by `ValidationFilter<T>`), handler (plain class registered in DI), and response records. Handlers query `SchedulerDbContext` directly; there is no repository layer.
- **Domain is persistence-ignorant.** `Domain/` contains aggregates (`Appointment`, `Dealership`), entities (`ServiceBay`, `Technician`, `ServiceType`), value objects (`TimeSlot`, `Vin`, `ServiceDuration`, `OperatingHours`) and domain services (`AvailabilityCalculator`, `AllocationPolicy`, `BookingWindowPolicy`). It never references EF Core or ASP.NET Core. Rule violations throw `DomainRuleViolationException(ruleCode, …)` whose `ruleCode` is the problem slug (→ 422); illegal lifecycle calls throw `InvalidStateTransitionException` (→ 409).
- **Concurrency model (do not weaken):** the overlap invariant lives in PostgreSQL as two partial GiST **exclusion constraints** on `appointments(bay_id, time_range)` and `(technician_id, time_range)` over a stored generated `tstzrange`. `BookAppointmentHandler` runs at **`READ COMMITTED`**, takes `pg_advisory_xact_lock(dealershipKey)` first, then checks and inserts. A booking transaction must never take a second lock or perform a second contended insert, with one scoped exception: the idempotency-key row, which only the same key used at another dealership can contend, and the lock holder never waits on its own lock's waiters (ADR-003). The appointment id is minted once outside the execution strategy and a lost commit acknowledgement is resolved by `verifySucceeded` plus an in-attempt id check (§7.3, §7.5). `xmin` is the concurrency token for state transitions (a stale cancel is `409 concurrency-conflict`; a cancel's lost commit acknowledgement is verified by the `xmin` it wrote, and only the runs after an in-doubt commit lock the row, §7.3 layer 3). `PostgresErrorClassifier` is the single place SQLSTATEs are interpreted.
- **Time:** UTC `DateTime` everywhere in code and DB; dealership `TimeZoneId` (IANA) drives operating hours via `LocalTimeConverter` (DST gap → first valid instant, ambiguity → earlier instant). Half-open intervals. Inject `TimeProvider`; never call `DateTime.UtcNow`.
- **Errors:** RFC 9457 ProblemDetails with types under `https://api.keyloop.example/problems/<slug>`; 400 = malformed, 422 = business rule, 409 = state conflict (`slot-unavailable`, `slot-conflict`, `invalid-state-transition`, `concurrency-conflict`). `GlobalExceptionHandler` is the only mapper.
- **Audit/events:** aggregates raise domain events; `DomainEventInterceptor` writes `appointment_history` rows in the same transaction and notifies `IDomainEventObserver`s after commit.
- **Telemetry:** `SchedulerTelemetry` owns the `ActivitySource`/`Meter` named `Keyloop.ServiceScheduler`; ServiceDefaults wires OTLP to the Aspire dashboard. Metric names are part of the design (§12) — do not rename.
- **Contract sync:** `dotnet build` of the API writes `contracts/openapi/v1.json` (commit it); `OpenApiContractTests` asserts the runtime document equals that file; HeyAPI (`openapi-ts.config.ts`) generates `src/api/*.gen.ts` including TanStack `queryOptions`/`mutationOptions`. Operation ids (`BookAppointment`, `GetAvailability`, …) are stable API.
- **Environments:** `Development` (migrate + seed on startup, Scalar on), `SystemTest` (integration tests; rate limiting off), `UAT`/`Production` (migration bundles, no seed, Scalar off in Production), and `Demo` (only for the Aspire-published compose bundle: UAT posture plus migrate/seed at startup).
- **Aspire (ADR-019):** the AppHost owns secrets (generated `postgres-password` parameter persisted to user secrets — never put credentials in appsettings), persistent PostgreSQL + pgweb, health-gated startup, `pnpm install` for the web app, `API_HTTP` service discovery for the Vite proxy, browser OTLP to the dashboard (dev only), and the *Reseed demo data* dashboard command (`POST /api/v1/admin/demo/reseed`, key-protected, excluded from OpenAPI). Behaviour differs only via `appsettings.{Env}.json` and options classes validated on start.
- **OpenAPI (ADR-008/017/018):** the document is generated at build time into `contracts/openapi/v1.json` (while `BuildTimeOpenApi.IsActive`, `Program.cs` runs in Development with a placeholder connection string and skips database work); summaries, response docs and request examples come from XML comments on static handler methods and DTOs; Scalar at `/scalar/v1` is the API test UI (not mapped in Production). Endpoint rules the contract tests enforce: `.WithName("<OperationId>")` (append new ids to `OpenApiContractTests.OperationIds`); every endpoint declares `.ProducesRateLimitedProblem()` plus a `<response code="429">` comment (the global limiter covers every route); a request body is described by `[Description]` on its parameter, not by `<param>` (the 10.0 XML generator copies every unmatched `<param>` onto the body; `SchedulerOpenApi.DescribeRequestBody` restores the attribute's text and fails generation without one); every response type is listed in `OpenApiContractTests.ResponseTypes`.
- **Reflection budget (ADR-016):** no assembly scanning or reflection-based discovery; endpoints are listed in `EndpointRegistry`, handlers and validators are registered explicitly; every HTTP DTO (and top-level `IReadOnlyList<T>`) is listed in `Common/Serialization/SchedulerJsonContext.cs` because reflection-based JSON is disabled; mappers are Mapperly-generated (`RequiredMappingStrategy.Target`); options are validated by `[OptionsValidator]`; logs go through `[LoggerMessage]` methods in `SchedulerLog`; the Request Delegate Generator is on, so an endpoint it cannot intercept fails the build. Residual reflection (EF Core, FluentValidation) is measured by `scripts/aot-readiness.sh`.
- **Frontend conventions** follow the shadcn dashboard template (Vite variant): Base UI primitives, `cn` from the `cn` package inside `components/ui`, `@/` alias, Tailwind v4 tokens in `src/index.css`. Vite proxies `/api`, `/openapi`, `/scalar` to the API (no CORS in dev). Aspire sets `PORT` and the API's address as `API_HTTP` (via `WithReference(api)`), which `vite.config.ts` uses as the proxy target.

## Working rules specific to this repo

- Keep `docs/SYSTEM_DESIGN.md` and the code in agreement; if a design decision changes, update the ADR table in the same commit.
- Test names describe behaviour (`Rejects_off_grid_start_422`); domain tests use `FakeTimeProvider` at `2026-10-12T08:00:00Z` and book on `2026-10-13`.
- The AppHost smoke test lives in `tests/Keyloop.ServiceScheduler.AspireTests`, not in the integration tests: Aspire.Hosting needs reflection-based JSON, which the integration test process disables to mirror the API (ADR-016). It supplies the database password and strips persistence, so it never touches the developer's user secrets or `keyloop-scheduler-pgdata`.
- Integration tests need Docker; the concurrency test runs five rounds and its assertions are not to be loosened — a failure is a design defect.
- `references/` holds provenance notes only; the reference clones live outside the repo and the AGPL one (MiroTalk) must never be copied.
- Commit messages: Conventional Commits, ending with the `Co-Authored-By`/`Claude-Session` trailers used in the existing history.
