# Agent hand-off - Keyloop Unified Service Scheduler

> **Fresh Claude session: read this file first, then `CLAUDE.md`, then the SDD ledger** (`.superpowers/sdd/2026-10-11-keyloop-service-scheduler/progress.md`, git-ignored). This document is self-contained so the project can continue even if the git-ignored workspace is lost. Last updated: 2026-10-11, after Task 10 closed (review clean).

---

## 1. Orientation in 60 seconds

- **What this is.** The Keyloop Principal Software Engineer take-home, **Scenario A - Unified Service Scheduler** (brief: `../docs/KeyloopCodingChallange.pdf`, outside the repo). A dealership workshop booking engine: an appointment needs a compatible **service bay** and a certified **technician** for the whole duration, with **zero double bookings under concurrency**. The **backend is the evaluated deliverable**; a React dispatch board is the demo harness.
- **Where.** Repo `/Users/khaipq5/Documents/research/keyloop/keyloop-service-scheduler`, branch **`feature/initial-implementation`** (31 commits ahead of `main` @ `e54bb1d`). Local only; **nothing has been pushed**. Reference clones live in `../references/` (MIT shadcn template - vendorable; carcareco - inspiration; **MiroTalk - AGPL, never copy code**).
- **State.** Backend Tasks **1–10 complete and reviewed** (Task 10, BookAppointment - the core - closed after one fix round; its scoped re-review was clean). Tasks 11–18 (plus 14b and 17b) remain. Tests at handoff: **unit 384/384, integration 150/150, build 0 warnings**.
- **Next action.** Start Task 11 using the process in §5, with the carry-overs in §6 (take `BASE` from the current `HEAD`, which is after the hand-off docs commits).

## 2. What the stakeholder asked for (binding intent)

The user (candidate) wants an **enterprise-grade, production-ready** submission. Their instructions, in order received:

1. **Original brief** (the `/init` prompt): .NET 10 + **Aspire** (AppHost, ServiceDefaults, OTel, dashboard), **Vertical Slice + DDD**, **EF Core + PostgreSQL** code-first, **React 19 + TS + Vite + Tailwind + shadcn** (template in `../references/shadcn-dashboard-landing-template/vite-version`), **TanStack Query**, **HeyAPI** generated client from OpenAPI. Deliverables: `docs/SYSTEM_DESIGN.md` (C4 Mermaid, trade-offs, observability, **GenAI co-design section**), backend slices, OpenAPI with RFC 7807/9457 problems, seed data, dispatch board UI, unit + integration tests, a **20–30-way adversarial concurrency test** (exactly one 201, rest 409, no orphans, no deadlocks), README with run/test instructions and an **AI Collaboration Narrative**, a 5–10 min **video walkthrough guide**. Split environments (dev/ST, UAT, prod), consider edge cases and security. **"Use Fable 5.1 for design/architecture/planning, implement using Opus or Sonnet."**
2. **Reflection reduction / NativeAOT readiness**: replace runtime reflection with source generation (Mapperly, STJ source-gen, minimal-API RDG, config binder / options-validator generators, `[LoggerMessage]`); be AOT-compatible "as much as possible" without targeting `PublishAot` yet. → ADR-016, Addendum A.
3. **OpenAPI and UI**: check whether OpenAPI can be source-generated (→ build-time generation + XML-comment generator, ADR-008/017); pick and install the best API test UI for modern .NET (→ **Scalar**, ADR-018); **validate the UI with Claude in Chrome**; the UI/UX must be **good and visually appealing**. → Addendum B, Task 17b.
4. **Aspire as the platform**: FE fully wired into Aspire (URL discovery, OTLP, dev-server start-up - everything bootstrapped by `dotnet run`); BE leverages Aspire building blocks (structured logging, tracing, **secret management**, etc.). → ADR-019, Addendum C, Task 14b.
5. **This hand-off.**

User preferences (also in Claude memory): Docker runs on **Colima**; prefers build-time source generation in .NET; validate UIs by driving them in Chrome; honest, evidence-backed reporting.

## 3. Documents and their roles

| Document | Role |
|----------|------|
| `docs/SYSTEM_DESIGN.md` | **Binding authority** (the spec). Domain model, availability algorithm (§6), concurrency (§7), C4/data model/API contract and problem catalogue (§8), technology (§9, reflection budget §9.1), environments (§10), security (§11), observability (§12), testing (§14), UI (§15), GenAI record (§16), risks (§17), **ADR-001…019** (§18). All 12 Mermaid diagrams validate with mermaid-cli. Implementers amend it (and the ADR table) in the same commit when behaviour changes. |
| `docs/superpowers/plans/2026-10-11-keyloop-service-scheduler.md` | The **implementation plan**: Global Constraints, Review Focus, locked file structure, Tasks 1–18 (+14b, 17b). Each task names the addendum sections it must apply. |
| `docs/superpowers/plans/2026-10-11-addendum-reflection-aot.md` | **Addendum A** - §A1 csproj switches, §A2 JSON source-gen, §A3 explicit endpoint/DI registry, §A4 options validation, §A5 logging, §A6 Mapperly, §A7 persistence specifics, §A8 AOT readiness measurement. |
| `docs/superpowers/plans/2026-10-11-addendum-openapi-ui.md` | **Addendum B** - §B1 build-time OpenAPI + guard, §B2 XML-doc conventions, §B3 Scalar, §B4 UI/UX quality bar (tokens, layout wireframe, states, a11y), §B5 visual QA in Chrome. |
| `docs/superpowers/plans/2026-10-11-addendum-aspire.md` | **Addendum C** - §C1 secret parameters, §C2 full AppHost, §C3 reseed endpoint + dashboard command, §C4 backend telemetry/logging, §C5 frontend on Aspire (discovery, `predev` codegen, browser OTel, nginx Dockerfile), §C6 Docker Compose publish + Demo env, §C7 whole-stack smoke test. |
| `CLAUDE.md` | Repo commands and the one-screen architecture summary. |
| `.superpowers/sdd/2026-10-11-keyloop-service-scheduler/` (git-ignored) | SDD workspace: `progress.md` **ledger**, `task-N-brief.md`, `task-N-report.md` (implementer reports with TDD evidence), `review-*.diff` packages, `global-constraints.md`. Rebuildable from git + this file if lost. |

## 4. Current state in detail

**Completed tasks** (each: implementer → task review → fix rounds as needed → scoped re-review → ledger "complete"):

| Task | What | Commits (range) | Notes |
|------|------|-----------------|-------|
| 1 | Solution, CPM, ServiceDefaults, API + test skeletons | `bc94974..c76fe9b` | xunit.v3 on **Microsoft.Testing.Platform** (`global.json` test runner) |
| 2 | Value objects, enums, primitives | `c76fe9b..e308e54` | VIN masked in `ToString` |
| 3 | Dealership, operating hours, DST-safe conversion, booking window policy | `e308e54..3d000bd` | DST values independently verified |
| 4 | Bays, technicians, catalogue, `Appointment` aggregate + state machine | `3d000bd..5eeccbe` (excl. controller `92cbdec`) | |
| 5 | Availability calculator, allocation policy | `2eb3826..9060222` | worked example hand-traced by reviewer |
| 6 | EF model, exclusion-constraint migration, audit interceptor, seeding, fixtures | `4e470ff..64d2cb6` | removing the exclusion SQL fails 4 overlap tests |
| 7 | Cross-cutting API (problems, validation, telemetry, options, security, rate limits, forwarded headers) | `64d2cb6..227f7a6` (excl. `19fd942`) | |
| 8 | GetDealerships, GetServiceTypes (pattern-setting slice) | `227f7a6..86e5d24` | **pattern files** - see §7 |
| 9 | GetAvailability | `86e5d24..2e178c5` | strict `yyyy-MM-dd` |
| 10 | **BookAppointment** (lock, allocation, idempotency, suggestions) | `2e178c5..c51ba9e` | lost-commit-ack duplicate fixed; re-review clean |

**Task 10 - how it closed.** Fix round 1 (`c51ba9e`) addressed: phantom second appointment after a lost COMMIT acknowledgement for unkeyed requests (id minted once outside the execution strategy + `verifySucceeded` + in-attempt id-existence check; either guard alone sufficient by mutation); ADR-003/§7.3/§7.5 amended (scoped exception for the idempotency-key row); expired keys never replayed; EF `SaveChangesFailed`/`CommandError` lowered to Information (`TransactionError` stays Error); `Stopwatch` for latency metrics; deadlock mapping unit-tested; §12.1 documents outcome `error`. The scoped Opus re-review confirmed all findings addressed (it verified that `verifySucceeded` runs on a fresh connection outside the failed transaction and can only see committed rows) and left one telemetry Minor, carried into Task 11 (§6). Remember: subagent ids do not survive sessions, so any future fix round on an old task needs a **fresh** implementer given the brief, the report file and the findings.

**Remaining:** Tasks 11, 12, 13, 14, 14b, 15, 16, 17, 17b, 18, then the final whole-branch review and branch finish (§6).

## 5. How to resume (process that has worked)

### 5.1 Environment check (run first)

```bash
colima status || colima start --cpu 4 --memory 6 --disk 40   # Docker for Testcontainers and Aspire
cd /Users/khaipq5/Documents/research/keyloop/keyloop-service-scheduler
git status && git branch --show-current                       # expect feature/initial-implementation, clean
dotnet tool restore                                           # dotnet-ef 10.0.12 pinned in .config/dotnet-tools.json
dotnet build -warnaserror                                     # expect 0 warnings
dotnet test --project tests/Keyloop.ServiceScheduler.UnitTests
dotnet test --project tests/Keyloop.ServiceScheduler.IntegrationTests   # needs Colima; postgres:17 image
```

`dotnet test` under Microsoft.Testing.Platform **rejects positional paths**; always use `--project`. Filters: `--filter "FullyQualifiedName~BookAppointmentTests"` (VSTest syntax works) or `--filter-class/--filter-method`. Coverage: `dotnet test --coverage` (not `--collect`).

### 5.2 Workflow: subagent-driven development (superpowers plugin)

The controller (you) never writes product code; it dispatches, reviews, rules, and keeps the ledger. Skill: `superpowers:subagent-driven-development`. Scripts:

```bash
SK=/Users/khaipq5/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1/skills/subagent-driven-development
PLAN=docs/superpowers/plans/2026-10-11-keyloop-service-scheduler.md
bash $SK/scripts/sdd-workspace $PLAN                 # prints the workspace dir
bash $SK/scripts/task-brief $PLAN 11                 # writes task-11-brief.md (regenerate after plan edits)
bash $SK/scripts/review-package $PLAN <BASE> <HEAD>  # writes review-<base>..<head>.diff
```

Per task:
1. Record `BASE=$(git rev-parse --short HEAD)` and append `Task N: dispatched (<model>, BASE …)` to the ledger.
2. Dispatch ONE implementer (never parallel implementers). Prompt = one-line context + **brief path** ("read this first; exact values verbatim") + the exact addendum sections to read + decisions/carry-overs the brief cannot know + pattern files + environment facts + attribution trailer + test commands + report-file path + the short reply contract. Tell it: TDD (RED then GREEN), full suites once before committing, no subagents, write the full report to `task-N-report.md`.
3. On report: build the review package for `BASE..HEAD`; dispatch the task reviewer (spec compliance + quality) with brief, report, package, global constraints, and the design sections that are authoritative. Ask it to verdict with file:line evidence and to be read-only (scratch copies outside the repo for probes).
4. Fix loop: Critical/Important → resume the same implementer (rounds 1–3) with findings verbatim; Minors that are cheap and in the same files can be folded in; otherwise ledger them as deferred or carry them into the **next task's first commit** (this has worked well). Then a **scoped re-review** of `FIX_BASE..HEAD` only. Cap 5 rounds.
5. Ledger `Task N: complete (commits …, review clean…)`.

Ledger line formats: `Ruling: <decision> - <why> - <cost if wrong>`; `Task N: minor (deferred → final review): …`; `Task N: fix round R/5 (X addressed, Y open; commits a..b)`.

### 5.3 Controller lessons (learned the hard way)

- **Do not commit while an implementer is active** - a controller docs commit inside a task's range pollutes the review package. If it happens, build the package manually from the implementer's commits only (`git diff A B` segments, or `review-package` with a base just after your commit).
- Exclude EF-generated `*.Designer.cs` / `*ModelSnapshot.cs` from review packages (`git diff A B -- . ':(exclude)**/*.Designer.cs' ':(exclude)**/*ModelSnapshot.cs'`).
- Large diffs (>150 KB): split into packages per commit and tell the reviewer to work in passes.
- Treat implementer reports as claims; reviewers verify; you verify anything surprising yourself (e.g. the controller verified `dotnet test` syntax under MTP before ruling).
- Re-trace the plan's algorithms before dispatching high-stakes tasks: the controller caught an **idempotency ordering defect** in the plan's Task 10 sketch before dispatch; the reviewer caught the **lost-commit-ack duplicate** that the sketch also contained.
- Model selection used: **Opus** for implementers and reviewers of anything with judgement (all slices from Task 8 on, persistence, concurrency, frontend); **Sonnet** for transcription-level tasks and small scoped re-reviews. The user asked for Fable to design/plan and Opus/Sonnet to implement; the **final whole-branch review should run on the most capable model (Fable)**. Always pass `model` explicitly.
- **Commit attribution:** use exactly the trailer lines your harness's system reminder specifies for the current model/session. In the last session they were:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01PcPKoNTdJPvHdVxgPZEvPV
  ```
  Earlier commits carry `Claude Fable 5.1`. Put the trailer in every dispatch prompt.
- Background waits: use bounded `sleep` stretches (≤ 5 min) via background Bash; check `git log`/`git status` and `ListAgents` between stretches; never poll the subagent transcript file.

### 5.4 Review checklists that found real defects

- **Spec:** every name/signature later tasks call; every problem slug/status/extension key (§8.7); every test listed by exact name; addendum sections actually applied.
- **Tests that cannot fail:** ask "would this test fail if the filter/guard/registration were removed?" - reviewers found untested `IsActive` halves twice.
- **Framework traps:** `IProblemDetailsService.WriteAsync` throws when `Accept` excludes JSON (use `TryWriteAsync`); forwarded headers trust must fail closed; reflection-free JSON needs every wire type registered (including `Guid?`, `DateOnly`, top-level `IReadOnlyList<T>`, problem-extension value types).
- **Concurrency (Task 10/13):** lock first inside READ COMMITTED; no second contended lock except the documented key-row exception; execution-strategy retries re-run the whole unit; lost-commit acknowledgement handled; nothing but 2xx memoised.

## 6. Remaining work with carry-overs

Regenerate each brief with `task-brief` before dispatch (the plan changed since some were staged). Carry-overs below are **binding rulings** not present in the brief text.

**Task 11 - GetAppointment, CancelAppointment** (Opus recommended; the xmin concurrency test matters).
- **First commit (carried from the Task 10 re-review):** in `BookAppointmentHandler.VerifyCommittedAsync`, resolve the in-doubt domain events ONLY when the appointment row is found - an inconclusive "not found" must not drop them, because the in-lock id check settles that case later; add a test for the in-doubt path; and filter `scheduler.booking.duration` by outcome in the lock-wait test.
- Reuse `AppointmentMapper`/`AppointmentResponseMapper` from Task 10; tag `Appointments`; `<example>` on `Reason`; register `CancelAppointmentRequest` in `SchedulerJsonContext`; explicit validator registration; log 1010 via `TelemetryDomainEventObserver` (already logs on commit - do not double-log).
- Cancel runs inside the execution strategy; `DbUpdateConcurrencyException` → 409 `concurrency-conflict`; `invalid-state-transition` carries `currentStatus` and machine `attempted` token.
- Tests per brief incl. **Review Focus #3** (cancelled slot re-bookable on the same bay/technician) and the **xmin stale-update** test (deferred from Task 6).
- `Location` from Task 10 now resolves - add a test following it.

**Task 12 - GetWorkshopSchedule** (Sonnet acceptable, Opus reviewer).
- Appointment-heavy read → **project** (use `DayScheduleReader`, overload taking a loaded `Dealership`); include non-cancelled appointments; bays/technicians include inactive ones (marked); strict `yyyy-MM-dd` like Task 9 (reuse the approach and the `DataType` schema transformer); `*Local` strings with offset.

**Task 13 - Adversarial concurrency test** (Opus).
- 30 simultaneous bookings, one bay + one technician (`TestData.ContentionDealershipAsync`), 5 rounds: exactly 1×201, 29×409 (`slot-unavailable`/`slot-conflict`), 0×5xx, no Error logs, no 1004, `deadlocks` = 0, `constraint_backstop` = 0, one active appointment, one history row, no orphan history/idempotency rows. **Do not loosen assertions; a failure is a design defect.**
- Reuse `Fixtures/MetricsCollector.cs`; capture logs with the existing `CapturingLogger`/`CapturingLoggerProvider` (add an optional logger parameter to `SchedulerApiFactory` if needed).
- Lock wait is measured with `Stopwatch` now: assert queued requests record `scheduler.booking.lock_wait` > 0, and a different dealership's lock wait stays small while one is hammered.
- Plus: 30 bookings for 30 distinct slots all succeed (serialisation without false rejections).

**Task 14 - Build-time OpenAPI, parity test, API Dockerfile, minimal AppHost** (Opus).
- Addendum B §B1: `Microsoft.Extensions.ApiDescription.Server` 10.0.12, `OpenApiGenerateDocumentsOnBuild`, output exactly `contracts/openapi/v1.json`; `BuildTimeOpenApi.IsActive` guard already exists in `Program.cs` (verify the generator runs green); document transformer clears `servers`; `/api/v1/__throw` already `.ExcludeFromDescription()`; contract test = runtime (SystemTest) == committed file + operationIds + string enums + problem schemas. `scripts/export-openapi.sh` = `dotnet build …Api -c Release && git status --short contracts/`.
- Dockerfile per plan; minimal AppHost (PostgreSQL + API) sufficient for a manual run; full Aspire work is 14b.

**Task 14b - Aspire platform** (Opus). Addendum C §C1 (secret generated persisted parameters), §C2 (persistent PG + pgweb, health-gated API, Scalar link, compose environment, guarded `AddViteApp`), §C3 (reseed endpoint, key-protected, `FixedTimeEquals`, 404 on wrong key, excluded from OpenAPI, `WithHttpCommand`), §C7 (smoke test postgres+api). **Verify every Aspire 13.6.1 API signature** before use and record deviations.

**Tasks 15–17 - Dispatch board** (Opus; implementers **load `frontend-design:frontend-design`** first).
- Addendum B §B4 quality bar (status tokens AA in both themes, KPI strip, timeline details, two-step booking dialog, conflict UX with suggested-slot chips, stress panel, states, a11y, responsive, dark mode); Addendum C §C5 (`API_HTTP` proxy discovery, Aspire `PORT`, `predev: openapi-ts`, browser OTel exporting to the dashboard **only in Development**, `ui.book_appointment`/`ui.stress_test` spans, nginx Dockerfile); remove the AppHost directory guard; extend the smoke test to `web`.
- Contract facts the UI relies on: JSON numbers are strict; `*Local` strings carry offsets; problem `type` slugs per §8.7; `Idempotency-Key` header; 201 `Location`; `Idempotent-Replayed`.
- Template conventions: Base UI primitives, `cn` from the `cn` package in `components/ui`, `@/` alias, Tailwind v4 tokens. Vendor only used components; no third-party logos (Keyloop as text wordmark only).

**Task 17b - Visual QA in Chrome (controller-run, not delegated).** Load the `claude-in-chrome` skill and the browser tools in one ToolSearch; new tab; 1440×900 and 1024×768, light and dark; walk every flow in Addendum B §B5; record `docs/media/booking-flow.gif`, `docs/media/stress-test.gif`; screenshots `board-light.png`, `board-dark.png`, `booking-dialog.png`, `conflict.png`, `stress-panel.png`, `scalar.png`; console and network must be clean (only intentional 409/400); score against §B4, ledger findings, ONE Opus fix dispatch, re-validate.

**Task 18 - CI, README, video guide, compose publish, AOT readiness** (Opus).
- CI: build `-warnaserror`; unit + integration with Docker; `dotnet test --coverage`; `dotnet list package --vulnerable --include-transitive`; `dotnet build` then `git diff --exit-code contracts/`; pnpm install/lint/typecheck/test/build + generated-client drift; `Category=Aspire` smoke step after `pnpm install`; `scripts/aot-readiness.sh` as a non-blocking artefact; Dependabot.
- Addendum C §C6: `appsettings.Demo.json` (UAT posture + migrate/seed; **forwarded headers enabled with `KnownNetworks` = the compose network range**, since nginx proxies `/api`); `ASPNETCORE_ENVIRONMENT=Demo` for the API only in publish mode; `aspire publish -o artifacts/compose`; bring up, curl through the web container, tear down.
- README: prerequisites (Colima note), one-command run, tests, curl examples, environments, observability tour, **Aspire tour**, runtime reflection budget, screenshots/GIFs, **AI Collaboration Narrative** (use §9 below - it must be honest and specific), licence/attribution. `docs/VIDEO_WALKTHROUGH.md` per plan. Refresh `CLAUDE.md`.
- UAT/Production: document that forwarded headers **fail closed** until the platform sets `Security:ForwardedHeaders:KnownProxies`/`KnownNetworks` (set every index; arrays merge by index).

**Final whole-branch review → finish.** Package `git merge-base main HEAD..HEAD` (exclude generated EF files; split by area if needed), dispatch on the **most capable model** with the deferred-minor list (§11 below), ONE fix dispatch for its findings, one scoped re-review, then `superpowers:finishing-a-development-branch`. Merge to `main` locally only if the user agrees; **never push or publish without explicit permission.** Before deleting the SDD workspace, report every `Ruling:` line to the user.

## 7. Codebase map and patterns

- **Pattern files for slices** (copy these): `src/Keyloop.ServiceScheduler.Api/Features/Catalog/GetServiceTypes/GetServiceTypesEndpoint.cs` (static method-group handler with XML docs, `[FromServices]` handler, `TypedResults`, `.WithName/.WithTags/.Produces*`), `Features/Catalog/Mapping/ServiceTypeMapper.cs` (Mapperly, additional parameters), `Features/Availability/GetAvailability/*` (`[AsParameters]` record with init-only nullable props + `ValidationFilter<T>`, telemetry), `Features/Appointments/BookAppointment/*` (transaction pattern).
- **Cross-cutting:** `Common/Endpoints/EndpointRegistry.cs` (add one line per endpoint), `Common/Serialization/SchedulerJsonContext.cs` (register every wire type), `Common/Problems/` (`ProblemTypes`, `ProblemResources`, `ApiExceptions`, `GlobalExceptionHandler`, probe endpoint), `Common/Telemetry/` (`SchedulerTelemetry`, `SchedulerLog` event ids 1001–1005, 1010, 1100–1104, 1200), `Common/Options/`, `Common/Http/` (security headers, rate limiting, forwarded headers, actor), `Common/OpenApi/SchedulerOpenApi.cs`.
- **Persistence:** `Infrastructure/Persistence/` (`SchedulerDbContext`, configurations applied explicitly, `DealershipLock`, `PostgresErrorClassifier`, `DomainEventInterceptor`, `DayScheduleReader`, `DatabaseInitializer`, seeding with `DeterministicGuid` ids - Reading `45fa64a1-baa9-8c61-b11a-ee9d7572ae3e`).
- **Test fixtures:** `tests/Keyloop.ServiceScheduler.IntegrationTests/Fixtures/` - `PostgresFixture` (assembly fixture, Testcontainers postgres:17, serial tests), `SchedulerApiFactory(connectionString, FakeTimeProvider)`, `TestData` (builders, `ContentionDealershipAsync`, `WorkshopAsync`), `HttpJson` (`ReadJsonAsync(JsonTypeInfo)`, `PostJsonAsync` with per-request headers, `ReadProblemAsync`), `MetricsCollector`, `CapturingLogger`, `ProblemAssertions`, `DatabaseProbe`. Clock **2026-10-12T08:00:00Z** (Monday); booking day **2026-10-13**.

## 8. Technical gotchas (do not rediscover)

- **xunit.v3 + MTP:** test projects are `OutputType Exe`; no `Microsoft.NET.Test.Sdk`/`xunit.runner.visualstudio`/coverlet; coverage via `Microsoft.Testing.Extensions.CodeCoverage`.
- **Reflection-free JSON** is on in the API **and** the integration test process (`JsonSerializerIsReflectionEnabledByDefault=false`): tests read JSON through `SchedulerJsonContext.Default.X` or `JsonDocument`; plain `ReadFromJsonAsync<T>()` throws. Our context is inserted into the HTTP resolver chain via `PostConfigure` (AddProblemDetails/AddOpenApi insert their own at index 0). JSON numbers are **strict** on HTTP.
- **RDG:** an `[AsParameters]` positional record with `string?` fails to compile - use init-only properties. A failed parse of a nullable parameter sets 400 without throwing; with `ValidationFilter<T>` it becomes a field-keyed `validation-error`.
- **XML docs → OpenAPI:** `<example>` on a record's `<param>` is dropped - use explicit documented properties; `<param>` docs on `[AsParameters]` handlers need `#pragma warning disable CS1572`.
- **EF Core 10:** cannot declare an index on complex-type properties → `(dealership_id, start_utc)` index is raw SQL in the migration; `xmin` via `IsRowVersion()` (no real column); enum sets as `text[]` with **public static** converters (compiled-model friendly); configurations applied one by one (no assembly scanning). EF's handled-conflict logs lowered to Information; `TransactionError` stays Error.
- **Execution strategy:** Aspire enables retries - every explicit transaction runs inside `CreateExecutionStrategy().ExecuteAsync(state, op, verifySucceeded)` with `ChangeTracker.Clear()` per attempt; ids minted outside the strategy.
- **Time:** `LocalTimeConverter.FormatLocal` formats via `DateTimeOffset` (`zzz` on `DateTime` prints the machine offset - a real bug that was fixed); business time from `TimeProvider`, latencies from `Stopwatch`.
- **Forwarded headers:** off by default; UAT/Production **fail closed** (enabled with empty trust lists → startup refuses until configured).
- **Startup:** options are validated (`IStartupValidator.Validate()`) **before** migrations; failures are logged at Critical (1103 validation / 1104 configuration, raw values stripped) then rethrown.
- **Mermaid validation** (if you edit diagrams): `npx puppeteer browsers install chrome@131.0.6778.204`, then `mmdc -p puppeteer.json -i d.mmd -o d.svg` with `puppeteer.json` = `{"executablePath": "<~/.cache/puppeteer/chrome/mac_arm-131.0.6778.204/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing>", "args": ["--no-sandbox"]}`. Avoid `;` inside sequence-diagram messages and notes; use `<br/>` not `\n` in flowchart labels.

## 9. Raw material for the README "AI Collaboration Narrative"

Strategy: design and plan first (Fable 5.1 as architect; brief PDF read; template conventions inventoried; package versions pinned from NuGet/npm; library APIs checked live via Context7), then subagent-driven implementation (Opus/Sonnet implementers, independent Opus/Sonnet reviewers per task, scoped re-reviews of every fix, a ledger of every ruling), TDD with RED evidence, mutation-style checks ("remove the guard → does a test fail?"), warnings-as-errors. Defects caught by the process (cite these honestly):

| Where | Defect | Caught by | Outcome |
|-------|--------|-----------|---------|
| Task 1 | xunit.v3 cannot run under VSTest on .NET 10; coverage collector silently dead | implementer + reviewer | moved to Microsoft.Testing.Platform, MTP-native coverage, docs fixed |
| Task 2 | record `ToString` leaked the full VIN (PII) | reviewer | masked `ToString` + test |
| Task 3 | design doc contradicted itself on DST ambiguity ("standard-offset-first" vs "earlier instant") | implementer | doc corrected; tests pin London/Berlin values (independently recomputed by reviewer) |
| Task 6 | observer exception after commit could 500 a committed booking (and re-run it under retries) | reviewer | isolated + logged (1005) |
| Task 7 | 429 became 500 for clients not accepting JSON | reviewer (reproduced) | `TryWriteAsync` + tests |
| Task 7 | no forwarded-header handling behind ingress (shared rate-limit budget, wrong audit actor) | reviewer | config-driven, then **fail-closed** after re-review found index-merge override hazard |
| Task 8 | "active technician" filter untested | reviewer | test proven RED by removal |
| Task 9/10 | local times without offset ambiguous on fall-back day; `zzz` on `DateTime` printed machine offset | implementer + controller ruling + reviewer | ISO-8601 with offset everywhere |
| Task 10 (plan) | idempotency checked only after availability → a retry would get 409 instead of its own 201 | **controller**, before dispatch | key looked up before availability and again under the lock |
| Task 10 | lost COMMIT acknowledgement + retrying strategy → phantom second appointment for unkeyed requests | reviewer probe in a scratch copy | id minted once + `verifySucceeded` + in-attempt id check; mutation-proven |
| Task 10 | REPEATABLE READ would read the pre-lock snapshot | implementer (demonstrated) | ADR-004 confirmed with a test |

Scope steering by the stakeholder (four mid-flight direction changes, each turned into an ADR + addendum, with recorded rejections: no generated DI container, no EF compiled models yet, no `PublishAot` yet) is also part of the story.

---

## 10. Rulings log (verbatim from the SDD ledger)

Every decision taken on the stakeholder's behalf, in order, with its cost if wrong. Report these to the user at the end of the project.

- Ruling: implement on branch `feature/initial-implementation` in this working directory (no separate worktree) - the directory is dedicated to this project and relative paths (`../references`, `../docs`) must keep working; merge into `main` at the end since the repo is local and unpushed (reversible with `git reset`) - cost if wrong: a merge the user must undo.
- Ruling: Task 2 defines `Domain/Dealerships/OperatingWindow.cs` so `TimeSlot.IsWithin` compiles; Task 3 keeps the type unchanged - cost if wrong: trivial file move.
- Ruling: Task 7 implements the SystemTest-only endpoint `/api/v1/__throw?kind=` with `kind ∈ {unhandled (default), conflict}`; Task 10's test uses `kind=conflict` - cost if wrong: one extra test endpoint branch.
- Ruling: Task 10 creates `tests/.../Fixtures/MetricsCollector.cs` (needed by its backstop test); Task 13 reuses it and adds `LogCollector` plus an optional `LogCollector? logs = null` parameter on `SchedulerApiFactory` - cost if wrong: small fixture refactor.
- Ruling: the Task 1 smoke tests (`1.ShouldBe(1)`) are placeholders and are deleted by Task 2 (unit) and Task 6 (integration) once real tests exist - cost if wrong: a leftover trivial test.
- Ruling: implementer models - Sonnet for Tasks 1, 2, 8, 11, 12; Opus for Tasks 3, 4, 5, 6, 7, 9, 10, 13, 14, 15, 16, 17, 18. Reviewers: Sonnet for Sonnet-tier tasks, Opus for the rest; final whole-branch review on Fable - the user asked for Fable to design/plan and Opus/Sonnet to implement; cost if wrong: review quality on cheap-tier tasks.
- Ruling (Task 1): accept `global.json` `"test": {"runner": "Microsoft.Testing.Platform"}` - xunit.v3 4.x on the .NET 10 SDK fails `dotnet test` under VSTest without it; test filter syntax for later tasks must follow MTP conventions (verified below) - cost if wrong: test commands in docs need adjusting.
- Ruling (Task 1): remove `Microsoft.NET.Test.Sdk`, `xunit.runner.visualstudio`, `coverlet.collector` (plan-mandated but obsolete under the accepted MTP runner) and add `Microsoft.Testing.Extensions.CodeCoverage` 18.12.0 - cost if wrong: coverage tooling needs re-plumbing in CI.
- Ruling (Task 1): controller verified `dotnet test` syntax under MTP (positional path rejected; `--project` + `--filter "VSTest syntax"` works); CLAUDE.md and the plan's test commands are updated to the `--project` form in the fix round - cost if wrong: doc commands only.
- Ruling (Task 1): `<OutputType>Exe</OutputType>` on both test projects is required by xunit.v3 without Test.Sdk - accepted. Plan Task 18 CI step must use `dotnet test --coverage` instead of `--collect:"XPlat Code Coverage"`; carry into the Task 18 dispatch - cost if wrong: CI coverage step tweak.
- Ruling (Task 2): fold five cheap minors (same files, zero design impact) into fix round 1 alongside the Important finding - pinned seed vector and value-object validation tests protect later tasks - cost if wrong: a slightly larger fix diff to re-review.
- Ruling (Task 2): the sole open finding is Minor and mechanical; close Task 2 and carry the rename completion into Task 3's dispatch (Task 3 edits Domain/ anyway; its reviewer verifies) instead of a dedicated round - cost if wrong: a mismatched file/class name lingers one task longer.
- Ruling (scope change 2026-10-11): user directed reflection reduction/AOT readiness; adopted RDG, STJ source-gen (reflection disabled), Mapperly 4.3.1, config-binding + options-validator generators, LoggerMessage, explicit endpoint/DI/validator registration; REJECTED replacing MEDI with Jab/Pure.DI (no official generator; MEDI AOT-compatible; container swap under ASP.NET hosting is high risk) and DEFERRED EF compiled models (silent-drift hazard, negligible gain) - cost if wrong: user may still want a generated container or compiled models; both are additive later.
- Ruling (Task 4): accept the domain `OperatingWindow` struct as the `operatingWindow` problem extension (serialises as {startUtc,endUtc}); Task 7 registers `OperatingWindow`, `BayCapability[]`, `Certification[]` in SchedulerJsonContext and drops the planned `OperatingWindowExtension` record - cost if wrong: error payload coupled to a domain struct's shape.
- Ruling (attribution): from 2026-10-11 the session runs on Opus 5.5; new commits use the `Co-Authored-By: Claude Opus 5.5` trailer; earlier commits keep the Fable trailer - cost if wrong: none functional.
- Ruling (scope change 2026-10-11, user): OpenAPI generated at build time (Microsoft.Extensions.ApiDescription.Server 10.0.12, GetDocument.Insider guard) + XML-comment source generator; contract-test export replaced by build output + runtime-parity test (ADR-008 rev., ADR-017) - cost if wrong: build-time generation fails on a startup path we missed; the guard is the mitigation.
- Ruling (scope change 2026-10-11, user): Scalar.AspNetCore 2.17.14 kept as the API test UI over Swagger UI/ReDoc/Scalar.Aspire (ADR-018) - cost if wrong: swapping UI is a two-line change.
- Ruling (scope change 2026-10-11, user): UI quality bar (Addendum B §B4) applied to Tasks 15–17; new controller-run Task 17b drives the app in Chrome, captures docs/media screenshots/GIFs, one fix dispatch - cost if wrong: extra iteration time on the harness.
- Ruling (Task 4 minors): carry into Task 5 dispatch - generic `no-qualified-resources` detail text (no staff names in 422 bodies), kebab-case `attempted` tokens (cancel, check-in, start, complete, mark-no-show), null-guard Theory for `Appointment.Book`; controller added catalogue rows for `no-show-before-slot-end` and optional extension keys (commit 2eb3826) - cost if wrong: small domain churn in Task 5.
- Ruling (scope change 2026-10-11, user: "FE wired in Aspire … BE leverage Aspire as much as possible"): Addendum C / ADR-019 - generated+persisted secret parameters, persistent PostgreSQL+pgweb, health-gated API, automatic pnpm install, API_HTTP discovery (replaces VITE_API_PROXY_TARGET), browser OTLP over HTTP with dev-only key exposure, reseed HTTP command (key-protected, excluded from OpenAPI), Aspire.Hosting.Testing smoke test, Docker Compose publish with a compose-only Demo environment; new Task 14b; Task 14 narrowed - cost if wrong: more Aspire surface to keep compatible with 13.6.1 APIs (implementers must verify signatures).
- Ruling (Task 5 minors): carry into Task 6 dispatch as a separate fix(domain)/test(domain) commit - deterministic reverse-ordered ids in AllocationPolicy name/id tie-break tests (mutant currently survives ~1/6–1/12 runs); `Compute` returns empty for a zero-length window (both open/close inside a DST gap) instead of throwing; human-readable InvalidStateTransitionException message while keeping machine `Attempted` tokens - cost if wrong: small domain churn in Task 6.
- Ruling (Task 6): accept reference-data seeding only when `Database:SeedDemoData` is true - matches SYSTEM_DESIGN §10 (Production none, SystemTest seeds its own fixtures, UAT reference data comes from DMS later) over the plan's wording - cost if wrong: UAT/Prod start with an empty catalogue (intended).
- Ruling (Task 6 minor #1, load-bearing for Task 10): observer exceptions after commit must not escape the interceptor (500 for a committed booking; possible re-run under the retrying execution strategy) - carry into Task 7: catch-and-log via SchedulerLog (new event id 1005 DomainEventObserverFailed), with a test that a throwing observer leaves SaveChanges/commit successful - cost if wrong: telemetry side effects silently dropped (they are logged).
- Ruling (Task 6 minor #6): carry into Task 7 - SystemTest logging override (Microsoft.EntityFrameworkCore → Warning) and a local tool manifest pinning dotnet-ef to the EF Core version - cost if wrong: none.
- Ruling (Task 6 minors #2/#3): carry into Task 9/10 dispatches - filter IsActive resources from DayScheduleReader results when computing availability/suggestions; explicit transactions on the DI context must run inside CreateExecutionStrategy (Task 10 test through the DI context) - cost if wrong: suggestions offering inactive resources.
- Ruling (Task 7 #2): fix forwarded headers now in Task 7's fix round (security scope) rather than Task 18 - config-driven KnownProxies/KnownNetworks, enabled in UAT/Production - cost if wrong: one more middleware to configure per deployment.
- Ruling (Task 7 minors): fold #1 CORS tests + reject "*", #2 SecurityOptions startup test, #3 errors:{} on binding 400, #4 validate options before DB init, #6 explicit tag order, #8 remove FluentValidation.DependencyInjectionExtensions into fix round 1 - cost if wrong: larger re-review diff.
- Ruling (Task 7 re-review minors, security posture): carry into Task 8 as a separate first fix(api) commit - UAT/Production ship forwarded headers Enabled with EMPTY KnownProxies/KnownNetworks so startup fails closed until the platform supplies the ingress addresses (index-merge makes partial env overrides unsafe; boot tests supply a value); early IStartupValidator failure logged at Critical via SchedulerLog then rethrown - cost if wrong: UAT/Prod deploys must set the ingress CIDR explicitly (intended).
- Ruling (model selection): Task 8 moves from Sonnet to Opus - first slice sets the Mapperly / XML-doc / JSON-context / test-helper patterns that Tasks 9–12 copy - cost if wrong: modest extra spend.
- Ruling (Task 8): accept strict HTTP JSON number handling - a contract-quality improvement for the generated TypeScript client; requests sending numbers as strings get 400 - cost if wrong: lenient clients break (none exist).
- Ruling (Task 8 → Task 18): Demo (compose) enables forwarded headers with KnownNetworks = the compose network range (web nginx proxies /api) - carry into Task 18 dispatch - cost if wrong: demo rate-limit partition per nginx container.
- Ruling (Task 8 minors): fold into fix round 1 - HttpJson null-safe content-type assertions; requirement-order test; log any early-validation exception (1103/1104); ProblemResources constants; PostJsonAsync per-request headers overload - cost if wrong: larger re-review diff.
- Ruling (Task 8 minor #3, projection): reference-data reads (dealerships, catalogue, resources) may load entities and map in memory; appointment-heavy reads must project (DayScheduleReader pattern) - carry into Tasks 9–12 dispatches - cost if wrong: minor over-fetch on small tables.
- Ruling (contract): every `*Local` string in the API is ISO-8601 local time WITH offset (`yyyy-MM-dd'T'HH:mmzzz`, e.g. 2026-10-25T01:30+01:00) - unambiguous on fall-back days; applied in Task 9's fix round if one happens, otherwise carried into Task 10 (changes LocalTimeConverter.FormatLocal and its tests) - cost if wrong: one string format change in a pre-release API.
- Ruling (Task 9 minors): carry into Task 10 first commit - *Local strings with offset (FormatLocal change + test updates); technician-side no-qualified-resources test; DayScheduleReader.ReadAsync(Dealership, …) overload used by availability and booking; correct the GlobalExceptionHandler ThrowOnBadRequest comment; document "service longer than the day's opening hours → empty slots, null reason" in XML docs and §8.7 - cost if wrong: small churn in Task 10.
- Ruling (Task 9 minor #4): accept reflection over DataTypeAttribute inside the OpenAPI schema transformer - runs only at document generation (build time / non-production), never on request paths - cost if wrong: one entry in the AOT readiness report.
- Ruling (Task 10 design correction found by controller): the plan's booking algorithm detects idempotency duplicates only via the insert's unique violation AFTER the availability re-check, so a sequential retry with the same key would see its own committed appointment and return 409 instead of replaying 201. Task 10 must look up the key BEFORE availability (fast path outside the tx, then again under the dealership lock), delete an expired key row in the same tx, and keep the unique-violation path as a backstop - cost if wrong: none (tests in Review Focus #5 pin it).
- Ruling (Task 10 concern 1): lower EF Core `CoreEventId.SaveChangesFailed` and `RelationalEventId.CommandError` to Information (handled 23P01/23505 are expected outcomes; unexpected failures still reach GlobalExceptionHandler → Error 1200) - goes into Task 10's fix round if one happens, else Task 11's first commit - cost if wrong: an unexpected DB error's EF-level line is Information (the API-level Error line remains).
- Ruling (Task 10 concern 2): latency/lock-wait instruments measure real elapsed time with `Stopwatch.GetTimestamp()`/`Stopwatch.GetElapsedTime`, business time stays on the injected TimeProvider; Task 13 then asserts lock wait is actually measured (> 0 for queued requests) - same carry rule - cost if wrong: none.
- Ruling (Task 10 #1): mint the appointment id once outside the strategy; use EF ExecuteInTransactionAsync verifySucceeded (id exists) or equivalent; in-attempt id-existence check after lock; probe-style tests for keyed and unkeyed - cost if wrong: none (this closes a real duplicate path).
- Ruling (Task 10 #2): amend ADR-003 with the scoped exception (key row contended only by the same key at another dealership; holder never waits on its own lock's waiters) in the same fix commit - cost if wrong: none.
- Ruling (Task 10 minor #3): malformed-JSON 400s are documented as visible via http.server.request.duration{status=400} instead of being counted as booking outcome - cost if wrong: one metric gap, documented.
- Ruling (Task 10): keep EF `TransactionError` (failed commit) at Error - a lost commit acknowledgement is a genuine infrastructure fault even when verified afterwards - cost if wrong: one Error line per lost ack.
- Ruling (Task 10): accept ExecuteAsync + verifySucceeded instead of ExecuteInTransactionAsync - refusal paths must roll back, which ExecuteInTransactionAsync would commit - cost if wrong: none.
- Ruling (Task 10 re-review minor): carry into Task 11's first commit - in `VerifyCommittedAsync` resolve the in-doubt domain events only when the row IS found (an inconclusive "not found" must not drop them; the in-lock id check settles it), with a test; filter `scheduler.booking.duration` by outcome in the lock-wait test - cost if wrong: a 1001 log line missing in a rare in-doubt case.
- Ruling (Task 10 re-review nits): controller fixed docs - CLAUDE.md ADR-003 wording with the key-row exception, §7.4 40P01 scope, §8.5 insert order (12 diagrams re-validated) - cost if wrong: none.

## 11. Deferred minors for the final whole-branch review (verbatim from the ledger)

The final reviewer triages which must be fixed before merge.

- Task 2: minor (deferred): `OperatingWindow` does not validate UTC Kind / Start<End (consider in Task 3); `default(ServiceDuration)` bypasses validation (inherent to the mandated struct; FromStart(default) still throws).
- **[resolved in Task 4]** Task 3: minor (deferred → carried into Task 4 dispatch): wrong Berlin comment in BookingWindowPolicyTests:109; add Kind==Utc guards in BookingWindowPolicy.EnsureBookable/EnsureAligned and LocalTimeConverter.ToLocalDate/FormatLocal; move Guard to Domain/Common; add a window-level ResolveOperatingWindow DST test (Sunday-open hours on 2026-03-29 and 2026-10-25) so the design's §14.1 claim holds.
- Task 3: minor (deferred → final review): `Days` mutable via cast (plan-mandated EF shape); no IANA-form enforcement on TimeZoneId; sub-minute operating times accepted; small untested guard paths.
- Task 4: minor (deferred → final review): enum sets mutable via cast to HashSet (plan-mandated EF shape); `Book` trusts caller-supplied window (another dealership's window could slip through; handler supplies it).
- Task 5: minor (deferred → final review): duplicate ResourceIds counted twice (callers never pass duplicates).
- Task 6: minor (deferred → final review): history FK ON DELETE CASCADE (append-only audit; production would deny DELETE to the app role; reseed is dev-only) ; redundant ix_appointments_dealership_id prefix index; Down() untested; demo seeder gives today 0–5 appointments on a real clock (past slots skipped by design); zero-length-window early return skips per-resource null validation; SeedCompleted count excludes hours rows; xmin stale-update test arrives in Task 11.
- **[partly resolved: framework problem types documented in §8.7 (`19fd942`); 64 KB/413, traceId over HTTP proven in Task 10; EF Error 20102 on first migration still open]** Task 7: minor (deferred → final review / docs): framework-generated 404/405/413/415 problem types keep RFC links (controller to document in §8.7); EF Error 20102 logged on a fresh database's first migration (Task 6 behaviour; investigate a log filter later); 64 KB body limit, HSTS, ValidationProblem traceId over HTTP to be proven in Task 10 on real Kestrel.
- Task 8: minor (deferred → final review): 1104 redaction relies on the binder's message wording; non-binder startup exception messages pass through unredacted.
- **[superseded: latencies now use `Stopwatch` (Task 10 fix round)]** Task 9: minor (deferred): duration metric value cannot fail a test under FakeTimeProvider (by design).
- Task 10: minor (deferred → final review): no `lock_timeout` on the booking transaction - after a dropped connection whose COMMIT never reached the server, retries queue behind the orphaned backend's advisory lock until PostgreSQL reaps it (latency, not correctness); decide whether to `SET LOCAL lock_timeout` and map 55P03.
- Note (process): controller docs commit 19fd942 (§8.7 framework problem types) landed inside Task 7 fix range; exclude it from the re-review package. Controller avoids committing while an implementer is active from here on.

## 12. Guardrails

- Never push, publish, or merge to `main` without the user's explicit agreement; the repo is local.
- Never copy code from `../references/mirotalkwebrtc` (AGPL).
- Never re-enable reflection-based JSON, add assembly scanning, or add a mediator (ADR-001/016).
- Never loosen the concurrency test's assertions; a failure is a design defect to investigate.
- Never put credentials in `appsettings*.json` or source; Aspire parameters own secrets (ADR-019).
- Keep `docs/SYSTEM_DESIGN.md` and its ADR table in agreement with the code in the same commit.
- Keep the README's AI narrative factual: only claim what the ledger and git history show.
