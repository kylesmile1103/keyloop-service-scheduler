# Keyloop Unified Service Scheduler — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the production-grade vertical slice described in `docs/SYSTEM_DESIGN.md`: a .NET 10 + Aspire 13 + EF Core/PostgreSQL booking engine with zero double-booking guarantees, a React 19 dispatch-board harness generated from the OpenAPI contract, and a test suite that proves the concurrency claims.

**Architecture:** Vertical slices (`Features/<Capability>/<Slice>/`) over a persistence-ignorant DDD domain. The database holds the overlap invariant (two partial GiST exclusion constraints); a per-dealership `pg_advisory_xact_lock` serialises check-then-insert at `READ COMMITTED`; `xmin` guards state transitions. Aspire orchestrates PostgreSQL, the API, and the Vite app. HeyAPI generates the typed client + TanStack Query options from a committed OpenAPI document exported by a contract test.

**Tech Stack:** .NET SDK 10.0.100 · Aspire 13.6.1 · EF Core 10.0.12 · Npgsql.EntityFrameworkCore.PostgreSQL 10.0.3 · EFCore.NamingConventions 10.0.1 · FluentValidation 12.2.0 · Scalar.AspNetCore 2.17.14 · OpenTelemetry 1.19.x · xunit.v3 4.0.2 · Shouldly 4.3.0 · Testcontainers.PostgreSql 4.16.0 · Respawn 7.0.0 · Microsoft.Extensions.TimeProvider.Testing 10.10.0 · PostgreSQL 17 · React 19.3 · Vite 8.3 · TypeScript ~6.0 · Tailwind 4.3 · shadcn/ui (Base UI) · react-router-dom 7.18 · TanStack Query 5.104.1 · @hey-api/openapi-ts 0.99.0 · pnpm 12 · Node 22.

**Spec:** `docs/SYSTEM_DESIGN.md` (read §5–§8 before any backend task; §15 before any frontend task; §14 before any test task).

## Global Constraints

- Repository root is `keyloop-service-scheduler/` (already a git repo on `main`). Solution file `Keyloop.ServiceScheduler.sln` at the root. Projects exactly: `src/Keyloop.ServiceScheduler.AppHost`, `src/Keyloop.ServiceScheduler.ServiceDefaults`, `src/Keyloop.ServiceScheduler.Api`, `src/Keyloop.ServiceScheduler.Web`, `tests/Keyloop.ServiceScheduler.UnitTests`, `tests/Keyloop.ServiceScheduler.IntegrationTests`.
- `TargetFramework` `net10.0`; `Nullable` and `ImplicitUsings` enabled; **`TreatWarningsAsErrors=true`**; `AnalysisLevel=latest`; `EnforceCodeStyleInBuild=true`. The build must produce **zero warnings**.
- Central Package Management: every version lives in `Directory.Packages.props`; `.csproj` files carry `PackageReference` without `Version`.
- Root namespace `Keyloop.ServiceScheduler.Api`; folders `Domain/`, `Features/`, `Infrastructure/`, `Common/` as in spec §8.4. `Domain/` must not reference EF Core, ASP.NET Core, or `Common/`.
- No MediatR or other mediator. Endpoints call handlers directly (spec ADR-001).
- All instants are `DateTime` with `Kind == Utc`; database columns `timestamp with time zone`; JSON ISO-8601 with `Z`. Never call `DateTime.UtcNow`/`DateTime.Now` in product code — inject `TimeProvider`.
- Half-open intervals `[start, end)` everywhere; overlap test is `a.Start < b.End && b.Start < a.End`.
- Database naming: snake_case via `UseSnakeCaseNamingConvention()`; connection name `schedulerdb`.
- Problem types use base URI `https://api.keyloop.example/problems/` and the slug catalogue in spec §8.7; every ProblemDetails carries `traceId`.
- API route group prefix `/api/v1`; OpenAPI document name `v1`; every endpoint has `.WithName("<OperationId>")` using the exact ids listed in Task 7.
- Commit after every task with Conventional Commits, and end every commit message with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01PcPKoNTdJPvHdVxgPZEvPV
  ```
- Docker is provided by **Colima** on the author's machine (`colima status`; `colima start --cpu 4 --memory 6 --disk 40` if stopped). Integration tests and Aspire need it running.
- Frontend package manager is **pnpm**; Node 22. Follow the template conventions found in `../references/shadcn-dashboard-landing-template/vite-version` (Base UI primitives, `cn` from the `cn` package in `components/ui`, `@/` alias, Tailwind v4 CSS tokens).
- Never copy code from `../references/mirotalkwebrtc` (AGPL). Only the MIT shadcn template may be vendored.
- **OpenAPI, API test UI and UI quality (ADR-008/017/018, Addendum B `docs/superpowers/plans/2026-10-11-addendum-openapi-ui.md`):** the OpenAPI document is generated at build time into `contracts/openapi/v1.json`; descriptions and examples come from XML comments on static handler methods and DTOs; Scalar is the test UI; the dispatch board meets the §B4 quality bar and is validated in Chrome (Task 17b).
- **Reflection budget (ADR-016, Addendum A `docs/superpowers/plans/2026-10-11-addendum-reflection-aot.md`):** no assembly scanning, no reflection-based discovery, no runtime-compiled expressions in our code; JSON via `SchedulerJsonContext` with reflection disabled; mapping via Mapperly; options validated by `[OptionsValidator]`; logging via `[LoggerMessage]`; RDG enabled. Tasks 6–12, 14 and 18 name the addendum sections they must apply.

## Review Focus

1. **A booking that starts at `closesAt − duration` exactly** must succeed (half-open end), while one minute later must fail with `422 outside-operating-hours`. Test pinned to Task 3 (domain) and Task 10 (integration).
2. **Spring-forward day in Europe/London (2026-03-29)**: a dealership opening 08:00 local still yields 07:00Z start, and no slot is skipped or duplicated; **fall-back day (2026-10-25)**: the window is one hour longer in absolute terms, slots are unique. Test pinned to Task 3 and Task 5.
3. **Cancelled appointment on the same bay/technician/time** must not block a new booking (partial exclusion constraint) and the new booking must succeed through the real API. Test pinned to Task 11.
4. **A direct SQL insert that overlaps an active appointment** (bypassing the lock) must be rejected by PostgreSQL with `23P01`, and the API's classifier must map that to `409 slot-conflict`. Test pinned to Task 6 and Task 10.
5. **A client retry with the same `Idempotency-Key` and identical body after a successful booking** returns the original `201` body with `Idempotent-Replayed: true` and creates no second row; the same key with a different body returns `422 idempotency-key-reuse`. Test pinned to Task 10.

---

## File structure (locked)

```
Keyloop.ServiceScheduler.sln
global.json
Directory.Build.props
Directory.Packages.props
.editorconfig
contracts/openapi/v1.json                         # exported by the contract test (Task 14), consumed by HeyAPI (Task 15)
scripts/export-openapi.sh
src/Keyloop.ServiceScheduler.ServiceDefaults/     Extensions.cs, *.csproj
src/Keyloop.ServiceScheduler.AppHost/             AppHost.cs, appsettings*.json, Properties/launchSettings.json, *.csproj
src/Keyloop.ServiceScheduler.Api/
  Program.cs
  Domain/Common/         Entity.cs AggregateRoot.cs IDomainEvent.cs DomainException.cs DomainRuleViolationException.cs InvalidStateTransitionException.cs DeterministicGuid.cs
  Domain/Dealerships/    Dealership.cs OperatingHours.cs DayOperatingHours.cs OperatingWindow.cs LocalTimeConverter.cs
  Domain/Resources/      ServiceBay.cs BayCapability.cs Technician.cs Certification.cs
  Domain/Catalog/        ServiceType.cs ServiceDuration.cs
  Domain/Scheduling/     Appointment.cs AppointmentStatus.cs TimeSlot.cs Vin.cs CustomerDetails.cs VehicleDetails.cs AppointmentEvents.cs
                         AvailabilityCalculator.cs AllocationPolicy.cs BookingWindowPolicy.cs
  Infrastructure/Persistence/   SchedulerDbContext.cs SchedulerDbContextDesignTimeFactory.cs DealershipLock.cs PostgresErrorClassifier.cs
                                DatabaseInitializer.cs AppointmentHistoryEntry.cs IdempotencyKey.cs
  Infrastructure/Persistence/Configurations/  DealershipConfiguration.cs ServiceBayConfiguration.cs TechnicianConfiguration.cs ServiceTypeConfiguration.cs
                                               AppointmentConfiguration.cs AppointmentHistoryConfiguration.cs IdempotencyKeyConfiguration.cs
  Infrastructure/Persistence/Interceptors/    DomainEventInterceptor.cs IDomainEventObserver.cs
  Infrastructure/Persistence/Migrations/      (generated by dotnet ef + hand-added SQL)
  Infrastructure/Persistence/Seeding/         ReferenceDataSeed.cs DemoAppointmentSeeder.cs
  Infrastructure/Persistence/Queries/         DayScheduleReader.cs
  Common/Endpoints/      IEndpoint.cs EndpointExtensions.cs
  Common/Validation/     ValidationFilter.cs
  Common/Problems/       ProblemTypes.cs ApiExceptions.cs GlobalExceptionHandler.cs SuggestedSlot.cs
  Common/Telemetry/      SchedulerTelemetry.cs TelemetryDomainEventObserver.cs
  Common/Options/        SchedulingOptions.cs DatabaseOptions.cs SecurityOptions.cs
  Common/Http/           SecurityHeadersMiddleware.cs CurrentActor.cs CurrentActorMiddleware.cs
  Features/Dealerships/GetDealerships/      GetDealershipsEndpoint.cs GetDealershipsHandler.cs DealershipResponse.cs
  Features/Catalog/GetServiceTypes/         GetServiceTypesEndpoint.cs GetServiceTypesHandler.cs ServiceTypeResponse.cs
  Features/Availability/GetAvailability/    GetAvailabilityEndpoint.cs GetAvailabilityQuery.cs GetAvailabilityValidator.cs GetAvailabilityHandler.cs AvailabilityResponse.cs
  Features/Appointments/Shared/             AppointmentResponse.cs AppointmentResponseMapper.cs
  Features/Appointments/BookAppointment/    BookAppointmentEndpoint.cs BookAppointmentRequest.cs BookAppointmentValidator.cs BookAppointmentHandler.cs BookingAttempt.cs IdempotencyFingerprint.cs
  Features/Appointments/GetAppointment/     GetAppointmentEndpoint.cs GetAppointmentHandler.cs
  Features/Appointments/CancelAppointment/  CancelAppointmentEndpoint.cs CancelAppointmentRequest.cs CancelAppointmentValidator.cs CancelAppointmentHandler.cs
  Features/Schedule/GetWorkshopSchedule/    GetWorkshopScheduleEndpoint.cs GetWorkshopScheduleHandler.cs WorkshopScheduleResponse.cs
  appsettings.json appsettings.Development.json appsettings.SystemTest.json appsettings.UAT.json appsettings.Production.json
  Dockerfile
src/Keyloop.ServiceScheduler.Web/           (Task 15–17)
tests/Keyloop.ServiceScheduler.UnitTests/   Domain/*Tests.cs, Features/*ValidatorTests.cs
tests/Keyloop.ServiceScheduler.IntegrationTests/ Fixtures/PostgresFixture.cs Fixtures/SchedulerApiFactory.cs Fixtures/TestData.cs Fixtures/ProblemAssertions.cs
                                               Persistence/*, Api/*, Concurrency/*, Contract/*
.github/workflows/ci.yml
README.md  docs/VIDEO_WALKTHROUGH.md  CLAUDE.md
```

---

## Phase 0 — Solution scaffolding

### Task 1: Solution, shared build props, ServiceDefaults, API skeleton, test skeletons

**Files:**
- Create: `global.json`, `Directory.Build.props`, `Directory.Packages.props`, `.editorconfig`, `Keyloop.ServiceScheduler.sln`
- Create: `src/Keyloop.ServiceScheduler.ServiceDefaults/Keyloop.ServiceScheduler.ServiceDefaults.csproj`, `Extensions.cs`
- Create: `src/Keyloop.ServiceScheduler.Api/Keyloop.ServiceScheduler.Api.csproj`, `Program.cs`, `appsettings.json`, `Properties/launchSettings.json`
- Create: `tests/Keyloop.ServiceScheduler.UnitTests/Keyloop.ServiceScheduler.UnitTests.csproj`, `SmokeTests.cs`
- Create: `tests/Keyloop.ServiceScheduler.IntegrationTests/Keyloop.ServiceScheduler.IntegrationTests.csproj`, `SmokeTests.cs`

**Interfaces:**
- Produces: `public partial class Program { }` in `Program.cs` (needed by `WebApplicationFactory<Program>`); `AddServiceDefaults()`, `MapDefaultEndpoints()` from ServiceDefaults (maps `/health` and `/alive` in **every** environment).

- [ ] **Step 1: Create `global.json`, `Directory.Build.props`, `Directory.Packages.props`, `.editorconfig`**

`global.json`:
```json
{ "sdk": { "version": "10.0.100", "rollForward": "latestFeature" } }
```

`Directory.Build.props`:
```xml
<Project>
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <LangVersion>latest</LangVersion>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>
    <AnalysisLevel>latest</AnalysisLevel>
    <EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
    <Deterministic>true</Deterministic>
    <ContinuousIntegrationBuild Condition="'$(CI)' == 'true'">true</ContinuousIntegrationBuild>
    <InvariantGlobalization>false</InvariantGlobalization>
    <SatelliteResourceLanguages>en</SatelliteResourceLanguages>
  </PropertyGroup>
</Project>
```

`Directory.Packages.props`:
```xml
<Project>
  <PropertyGroup>
    <ManagePackageVersionsCentrally>true</ManagePackageVersionsCentrally>
    <CentralPackageTransitivePinningEnabled>false</CentralPackageTransitivePinningEnabled>
    <AspireVersion>13.6.1</AspireVersion>
    <AspNetCoreVersion>10.0.12</AspNetCoreVersion>
    <EfCoreVersion>10.0.12</EfCoreVersion>
    <OtelVersion>1.19.1</OtelVersion>
    <OtelInstrumentationVersion>1.19.0</OtelInstrumentationVersion>
    <ExtensionsVersion>10.10.0</ExtensionsVersion>
  </PropertyGroup>
  <ItemGroup>
    <PackageVersion Include="Aspire.Hosting.PostgreSQL" Version="$(AspireVersion)" />
    <PackageVersion Include="Aspire.Hosting.JavaScript" Version="$(AspireVersion)" />
    <PackageVersion Include="Aspire.Npgsql.EntityFrameworkCore.PostgreSQL" Version="$(AspireVersion)" />
    <PackageVersion Include="Microsoft.Extensions.Http.Resilience" Version="$(ExtensionsVersion)" />
    <PackageVersion Include="Microsoft.Extensions.ServiceDiscovery" Version="$(ExtensionsVersion)" />
    <PackageVersion Include="Microsoft.Extensions.TimeProvider.Testing" Version="$(ExtensionsVersion)" />
    <PackageVersion Include="OpenTelemetry.Exporter.OpenTelemetryProtocol" Version="$(OtelVersion)" />
    <PackageVersion Include="OpenTelemetry.Extensions.Hosting" Version="$(OtelVersion)" />
    <PackageVersion Include="OpenTelemetry.Instrumentation.AspNetCore" Version="$(OtelInstrumentationVersion)" />
    <PackageVersion Include="OpenTelemetry.Instrumentation.Http" Version="$(OtelInstrumentationVersion)" />
    <PackageVersion Include="OpenTelemetry.Instrumentation.Runtime" Version="$(OtelInstrumentationVersion)" />
    <PackageVersion Include="Microsoft.AspNetCore.OpenApi" Version="$(AspNetCoreVersion)" />
    <PackageVersion Include="Microsoft.EntityFrameworkCore.Design" Version="$(EfCoreVersion)" />
    <PackageVersion Include="Npgsql.EntityFrameworkCore.PostgreSQL" Version="10.0.3" />
    <PackageVersion Include="EFCore.NamingConventions" Version="10.0.1" />
    <PackageVersion Include="FluentValidation" Version="12.2.0" />
    <PackageVersion Include="FluentValidation.DependencyInjectionExtensions" Version="12.2.0" />
    <PackageVersion Include="Scalar.AspNetCore" Version="2.17.14" />
    <PackageVersion Include="xunit.v3" Version="4.0.2" />
    <PackageVersion Include="xunit.runner.visualstudio" Version="4.0.1" />
    <PackageVersion Include="Microsoft.NET.Test.Sdk" Version="18.10.1" />
    <PackageVersion Include="Shouldly" Version="4.3.0" />
    <PackageVersion Include="Microsoft.AspNetCore.Mvc.Testing" Version="$(AspNetCoreVersion)" />
    <PackageVersion Include="Testcontainers.PostgreSql" Version="4.16.0" />
    <PackageVersion Include="Respawn" Version="7.0.0" />
    <PackageVersion Include="coverlet.collector" Version="10.1.0" />
  </ItemGroup>
</Project>
```

`.editorconfig` (root): `root = true`; `[*] indent_style = space, indent_size = 4, end_of_line = lf, charset = utf-8, trim_trailing_whitespace = true, insert_final_newline = true`; `[*.{json,yml,yaml,md}] indent_size = 2`; `[*.cs] csharp_style_namespace_declarations = file_scoped:warning`, `dotnet_sort_system_directives_first = true`, `csharp_prefer_braces = true:warning`, `dotnet_diagnostic.CA1848.severity = none` (LoggerMessage delegates are used only where it matters), `dotnet_diagnostic.CA2007.severity = none`, `dotnet_diagnostic.CA1812.severity = none` (DI-instantiated classes), `dotnet_diagnostic.CA1062.severity = none`, `dotnet_diagnostic.CA1515.severity = none` (public types in tests).

- [ ] **Step 2: Create the solution and the ServiceDefaults project**

Run from the repo root:
```bash
dotnet new sln -n Keyloop.ServiceScheduler
dotnet new aspire-servicedefaults -n Keyloop.ServiceScheduler.ServiceDefaults -o src/Keyloop.ServiceScheduler.ServiceDefaults
```
Then edit the generated csproj to remove `Version=` attributes (CPM) and ensure it contains only `<IsAspireSharedProject>true</IsAspireSharedProject>`, the `Microsoft.AspNetCore.App` framework reference, and the seven package references listed in `Directory.Packages.props` (Resilience, ServiceDiscovery, five OpenTelemetry packages). Edit `Extensions.cs`: in `MapDefaultEndpoints`, **remove** the `if (app.Environment.IsDevelopment())` guard so `/health` and `/alive` are mapped in every environment, and keep the comment explaining that exposure is controlled at the ingress. Add to `ConfigureOpenTelemetry` tracing: `.AddSource("Keyloop.ServiceScheduler")` and metrics: `.AddMeter("Keyloop.ServiceScheduler")`.

- [ ] **Step 3: Create the API project**

```bash
dotnet new webapi -n Keyloop.ServiceScheduler.Api -o src/Keyloop.ServiceScheduler.Api --use-minimal-apis --no-openapi
```
Replace the csproj contents with:
```xml
<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup>
    <RootNamespace>Keyloop.ServiceScheduler.Api</RootNamespace>
    <UserSecretsId>keyloop-service-scheduler-api</UserSecretsId>
    <GenerateDocumentationFile>true</GenerateDocumentationFile>
    <NoWarn>$(NoWarn);CS1591</NoWarn>
  </PropertyGroup>
  <ItemGroup>
    <ProjectReference Include="..\Keyloop.ServiceScheduler.ServiceDefaults\Keyloop.ServiceScheduler.ServiceDefaults.csproj" />
  </ItemGroup>
  <ItemGroup>
    <PackageReference Include="Aspire.Npgsql.EntityFrameworkCore.PostgreSQL" />
    <PackageReference Include="Npgsql.EntityFrameworkCore.PostgreSQL" />
    <PackageReference Include="EFCore.NamingConventions" />
    <PackageReference Include="Microsoft.EntityFrameworkCore.Design">
      <PrivateAssets>all</PrivateAssets>
      <IncludeAssets>runtime; build; native; contentfiles; analyzers; buildtransitive</IncludeAssets>
    </PackageReference>
    <PackageReference Include="Microsoft.AspNetCore.OpenApi" />
    <PackageReference Include="Scalar.AspNetCore" />
    <PackageReference Include="FluentValidation" />
    <PackageReference Include="FluentValidation.DependencyInjectionExtensions" />
  </ItemGroup>
  <ItemGroup>
    <InternalsVisibleTo Include="Keyloop.ServiceScheduler.UnitTests" />
    <InternalsVisibleTo Include="Keyloop.ServiceScheduler.IntegrationTests" />
  </ItemGroup>
</Project>
```
Delete the template's weather-forecast code. `Program.cs` for this task (it grows in Task 7):
```csharp
using Scalar.AspNetCore;

var builder = WebApplication.CreateBuilder(args);
builder.AddServiceDefaults();
builder.Services.AddProblemDetails();
builder.Services.AddOpenApi("v1");

var app = builder.Build();
app.UseExceptionHandler();
app.UseStatusCodePages();
app.MapDefaultEndpoints();
if (!app.Environment.IsProduction())
{
    app.MapOpenApi();
    app.MapScalarApiReference();
}
app.MapGet("/api/v1/ping", () => TypedResults.Ok(new { status = "ok" })).WithName("Ping");

await app.RunAsync();

public partial class Program;
```
`Properties/launchSettings.json`: profiles `https` (`https://localhost:7180;http://localhost:5180`) and `http` (`http://localhost:5180`), `ASPNETCORE_ENVIRONMENT=Development`, `launchBrowser=false`.
`appsettings.json`: `Logging` defaults only (feature options are added in Task 7).

- [ ] **Step 4: Create both test projects**

```bash
dotnet new xunit -n Keyloop.ServiceScheduler.UnitTests -o tests/Keyloop.ServiceScheduler.UnitTests
dotnet new xunit -n Keyloop.ServiceScheduler.IntegrationTests -o tests/Keyloop.ServiceScheduler.IntegrationTests
```
Replace each csproj with CPM-compliant content. UnitTests:
```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup><IsPackable>false</IsPackable><IsTestProject>true</IsTestProject><NoWarn>$(NoWarn);CA1707</NoWarn></PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.NET.Test.Sdk" />
    <PackageReference Include="xunit.v3" />
    <PackageReference Include="xunit.runner.visualstudio" />
    <PackageReference Include="Shouldly" />
    <PackageReference Include="Microsoft.Extensions.TimeProvider.Testing" />
    <PackageReference Include="coverlet.collector" />
  </ItemGroup>
  <ItemGroup><ProjectReference Include="..\..\src\Keyloop.ServiceScheduler.Api\Keyloop.ServiceScheduler.Api.csproj" /></ItemGroup>
  <ItemGroup><Using Include="Xunit" /><Using Include="Shouldly" /></ItemGroup>
</Project>
```
IntegrationTests: same plus `Microsoft.AspNetCore.Mvc.Testing`, `Testcontainers.PostgreSql`, `Respawn`, `Npgsql.EntityFrameworkCore.PostgreSQL`. Each project gets a `SmokeTests.cs` with one test (`1.ShouldBe(1)`) so the pipeline is green from the start.

- [ ] **Step 5: Add projects to the solution, build, test**

```bash
dotnet sln add src/Keyloop.ServiceScheduler.ServiceDefaults src/Keyloop.ServiceScheduler.Api tests/Keyloop.ServiceScheduler.UnitTests tests/Keyloop.ServiceScheduler.IntegrationTests
dotnet build -warnaserror
dotnet test
```
Expected: build succeeds with 0 warnings; 2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "build: scaffold solution with central package management, service defaults, API and test projects"
```

---

## Phase 1 — Domain (pure, TDD; no database)

### Task 2: Domain primitives and value objects

**Files:**
- Create: `Domain/Common/Entity.cs`, `AggregateRoot.cs`, `IDomainEvent.cs`, `DomainException.cs`, `DomainRuleViolationException.cs`, `InvalidStateTransitionException.cs`, `DeterministicGuid.cs`
- Create: `Domain/Scheduling/TimeSlot.cs`, `Vin.cs`, `CustomerDetails.cs`, `VehicleDetails.cs`, `AppointmentStatus.cs`
- Create: `Domain/Catalog/ServiceDuration.cs`
- Create: `Domain/Resources/BayCapability.cs`, `Certification.cs`
- Test: `tests/Keyloop.ServiceScheduler.UnitTests/Domain/TimeSlotTests.cs`, `VinTests.cs`, `ServiceDurationTests.cs`, `DeterministicGuidTests.cs`

**Interfaces (produced):**
```csharp
namespace Keyloop.ServiceScheduler.Api.Domain.Common;
public abstract class Entity { public Guid Id { get; protected init; } }
public abstract class AggregateRoot : Entity
{
    private readonly List<IDomainEvent> _domainEvents = [];
    public IReadOnlyCollection<IDomainEvent> DomainEvents => _domainEvents.AsReadOnly();
    protected void Raise(IDomainEvent domainEvent) => _domainEvents.Add(domainEvent);
    public void ClearDomainEvents() => _domainEvents.Clear();
}
public interface IDomainEvent { Guid AppointmentId { get; } DateTime OccurredAtUtc { get; } string EventType { get; } }
public abstract class DomainException(string message) : Exception(message);
/// Maps to 422. RuleCode is the problem slug (e.g. "outside-operating-hours").
public sealed class DomainRuleViolationException(string ruleCode, string detail, IReadOnlyDictionary<string, object?>? extensions = null) : DomainException(detail)
{ public string RuleCode { get; } = ruleCode; public IReadOnlyDictionary<string, object?> Extensions { get; } = extensions ?? new Dictionary<string, object?>(); }
/// Maps to 409 invalid-state-transition.
public sealed class InvalidStateTransitionException(AppointmentStatus current, string attempted) : DomainException($"Cannot {attempted} an appointment in status {current}.")
{ public AppointmentStatus Current { get; } = current; public string Attempted { get; } = attempted; }
public static class DeterministicGuid { public static Guid Create(string name); } // SHA-256 of "keyloop-scheduler:" + name, first 16 bytes, version nibble forced to 8

namespace Keyloop.ServiceScheduler.Api.Domain.Scheduling;
public enum AppointmentStatus { Confirmed, CheckedIn, InProgress, Completed, Cancelled, NoShow }
public sealed record TimeSlot
{
    public DateTime StartUtc { get; } public DateTime EndUtc { get; }
    public TimeSpan Duration => EndUtc - StartUtc;
    public static TimeSlot Create(DateTime startUtc, DateTime endUtc);        // throws ArgumentException if Kind != Utc or end <= start
    public static TimeSlot FromStart(DateTime startUtc, ServiceDuration duration);
    public bool Overlaps(TimeSlot other) => StartUtc < other.EndUtc && other.StartUtc < EndUtc;
    public bool IsWithin(OperatingWindow window) => StartUtc >= window.StartUtc && EndUtc <= window.EndUtc;
}
public sealed record Vin
{
    public string Value { get; }
    public static bool TryCreate(string? raw, out Vin vin);   // trims + uppercases, regex ^[A-HJ-NPR-Z0-9]{17}$
    public static Vin Create(string raw);                      // throws ArgumentException("Invalid VIN")
    public string Masked => "***********" + Value[^6..];
}
public sealed record CustomerDetails(string Name, string Email, string Phone);   // Name 1..120, Email 3..254, Phone 3..40 (trimmed) else ArgumentException
public sealed record VehicleDetails(Vin Vin, string Registration, string Make, string Model); // Registration 1..16 upper, Make/Model 1..60

namespace Keyloop.ServiceScheduler.Api.Domain.Catalog;
public readonly record struct ServiceDuration
{
    public int Minutes { get; }
    public TimeSpan AsTimeSpan => TimeSpan.FromMinutes(Minutes);
    public static ServiceDuration Create(int minutes); // > 0, % 5 == 0, <= 480 else ArgumentOutOfRangeException
}

namespace Keyloop.ServiceScheduler.Api.Domain.Resources;
public enum BayCapability { StandardLift, HeavyDutyLift, EvHighVoltage, WheelAlignment, Diagnostics, MotTesting, AirConditioning }
public enum Certification { GeneralService, Brakes, HighVoltageElectrical, Diagnostics, MotTester, WheelAlignment, AirConditioning, HeavyVehicle }
```
`OperatingWindow` is defined in Task 3; declare `TimeSlot.IsWithin` in Task 3 if you prefer strict ordering — but both tasks ship before any consumer, so defining the stub now is acceptable.

- [ ] **Step 1: Write failing tests** — `TimeSlotTests`: `Create_rejects_end_before_start`, `Create_rejects_non_utc_kind`, `Overlaps_is_true_for_partial_overlap`, `Overlaps_is_false_for_adjacent_slots` (09:00–10:00 vs 10:00–11:00), `Overlaps_is_true_when_one_contains_the_other`, `FromStart_uses_duration`. `VinTests`: `Valid_vin_is_normalised_to_uppercase` (" wvwzzz1kzaw123456 " → "WVWZZZ1KZAW123456"), `Rejects_16_characters`, `Rejects_letters_I_O_Q` (Theory), `Masked_shows_last_six`. `ServiceDurationTests`: `Rejects_zero`, `Rejects_negative`, `Rejects_non_multiple_of_five` (7), `Rejects_over_eight_hours` (485), `Accepts_60`. `DeterministicGuidTests`: `Same_name_same_guid`, `Different_names_differ`.
- [ ] **Step 2: Run** `dotnet test --project tests/Keyloop.ServiceScheduler.UnitTests` → FAIL (types missing).
- [ ] **Step 3: Implement** the types exactly as the interface block above.
- [ ] **Step 4: Run tests** → PASS; `dotnet build -warnaserror` → 0 warnings.
- [ ] **Step 5: Commit** `feat(domain): add value objects, enums, and domain primitives`

### Task 3: Dealership, operating hours, time-zone conversion, booking window policy

**Files:**
- Create: `Domain/Dealerships/Dealership.cs`, `OperatingHours.cs`, `DayOperatingHours.cs`, `OperatingWindow.cs`, `LocalTimeConverter.cs`
- Create: `Domain/Scheduling/BookingWindowPolicy.cs`
- Test: `UnitTests/Domain/OperatingHoursTests.cs`, `LocalTimeConverterTests.cs`, `BookingWindowPolicyTests.cs`

**Interfaces (produced):**
```csharp
namespace Keyloop.ServiceScheduler.Api.Domain.Dealerships;
public sealed record DayOperatingHours(DayOfWeek Day, TimeOnly? OpensAt, TimeOnly? ClosesAt)
{ public bool IsClosed => OpensAt is null; /* ctor validation: both null or both set; ClosesAt > OpensAt */ }
public sealed class OperatingHours
{
    public IReadOnlyList<DayOperatingHours> Days { get; }     // exactly 7, one per DayOfWeek
    public static OperatingHours Create(IEnumerable<DayOperatingHours> days);
    public DayOperatingHours ForDay(DayOfWeek day);
    public static OperatingHours MondayToFriday(TimeOnly opens, TimeOnly closes, TimeOnly? saturdayCloses = null); // helper for seeds/tests
}
public readonly record struct OperatingWindow(DateTime StartUtc, DateTime EndUtc)
{ public bool Contains(TimeSlot slot) => slot.StartUtc >= StartUtc && slot.EndUtc <= EndUtc; }
public static class LocalTimeConverter
{
    /// Invalid (skipped) wall time advances to the first valid instant; ambiguous resolves to the earlier instant.
    public static DateTime ToUtc(DateOnly date, TimeOnly time, TimeZoneInfo zone);
    public static DateOnly ToLocalDate(DateTime utc, TimeZoneInfo zone);
    public static string FormatLocal(DateTime utc, TimeZoneInfo zone) => TimeZoneInfo.ConvertTimeFromUtc(utc, zone).ToString("yyyy-MM-dd'T'HH:mm", CultureInfo.InvariantCulture);
}
public sealed class Dealership : AggregateRoot
{
    public string Name { get; private set; } public string TimeZoneId { get; private set; } public OperatingHours Hours { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public static Dealership Create(Guid id, string name, string timeZoneId, OperatingHours hours, DateTime nowUtc); // validates TimeZoneInfo.FindSystemTimeZoneById
    public TimeZoneInfo TimeZone => TimeZoneInfo.FindSystemTimeZoneById(TimeZoneId);
    public OperatingWindow? ResolveOperatingWindow(DateOnly localDate);   // null when closed that weekday
}

namespace Keyloop.ServiceScheduler.Api.Domain.Scheduling;
public sealed class BookingWindowPolicy(TimeProvider clock, TimeSpan minimumLeadTime, TimeSpan bookingHorizon)
{
    public void EnsureBookable(DateTime startUtc); // throws DomainRuleViolationException("lead-time-not-met", ..., {earliestStartUtc}) or ("beyond-booking-horizon", ..., {latestStartUtc})
    public static void EnsureAligned(DateTime startUtc, OperatingWindow window, int granularityMinutes); // throws ("slot-not-aligned", ..., {slotGranularityMinutes})
}
```
EF Core needs a parameterless private constructor on `Dealership` and `OperatingHours` is persisted as an owned collection (`Days`) — keep `Days` a `List<DayOperatingHours>` internally with a private setter for EF.

- [ ] **Step 1: Write failing tests**
  - `OperatingHoursTests`: `Create_requires_all_seven_days`, `Closed_day_has_null_times`, `Rejects_closes_before_opens`, `ResolveOperatingWindow_returns_null_on_closed_day` (Sunday), `ResolveOperatingWindow_converts_london_bst` (2026-07-01 08:00–18:00 Europe/London → 07:00Z–17:00Z), `ResolveOperatingWindow_converts_london_gmt` (2026-01-15 → 08:00Z–18:00Z).
  - `LocalTimeConverterTests`: `Spring_forward_gap_advances_to_first_valid_instant` (Europe/London 2026-03-29 01:30 → 01:00Z, i.e. 02:00 BST), `Fall_back_ambiguous_resolves_to_earlier_instant` (2026-10-25 01:30 → 00:30Z), `Normal_time_round_trips`, `ToLocalDate_crosses_midnight` (23:30Z on 2026-07-01 in Europe/Berlin → 2026-07-02).
  - `BookingWindowPolicyTests` with `FakeTimeProvider` at 2026-10-12T08:00:00Z: `Rejects_start_in_the_past`, `Rejects_start_inside_lead_time` (lead 60 min, start +30 min → `lead-time-not-met` with `earliestStartUtc` = 09:00Z), `Accepts_start_at_exact_lead_time`, `Rejects_beyond_horizon` (90 days + 1 h), `EnsureAligned_rejects_off_grid` (window start 07:00Z, start 07:10Z, 15 → `slot-not-aligned`), `EnsureAligned_accepts_on_grid`.
- [ ] **Step 2: Run tests** → FAIL.
- [ ] **Step 3: Implement.** `LocalTimeConverter.ToUtc`:
```csharp
var local = date.ToDateTime(time, DateTimeKind.Unspecified);
if (zone.IsInvalidTime(local))
{
    var probe = local;
    for (var i = 0; i < 180 && zone.IsInvalidTime(probe); i++) probe = probe.AddMinutes(1);
    local = probe;
}
if (zone.IsAmbiguousTime(local))
{
    var earlierInstantOffset = zone.GetAmbiguousTimeOffsets(local).Max(); // first occurrence = larger offset (DST)
    return DateTime.SpecifyKind(local - earlierInstantOffset, DateTimeKind.Utc);
}
return TimeZoneInfo.ConvertTimeToUtc(local, zone);
```
`ResolveOperatingWindow`: `var d = Hours.ForDay(localDate.DayOfWeek); if (d.IsClosed) return null; return new OperatingWindow(LocalTimeConverter.ToUtc(localDate, d.OpensAt!.Value, TimeZone), LocalTimeConverter.ToUtc(localDate, d.ClosesAt!.Value, TimeZone));`
- [ ] **Step 4: Run tests** → PASS.
- [ ] **Step 5: Commit** `feat(domain): add dealership operating hours, DST-safe conversion, booking window policy`

### Task 4: Resources, catalogue, and the Appointment aggregate

**Files:**
- Create: `Domain/Resources/ServiceBay.cs`, `Technician.cs`; `Domain/Catalog/ServiceType.cs`; `Domain/Scheduling/Appointment.cs`, `AppointmentEvents.cs`
- Test: `UnitTests/Domain/ServiceBayTests.cs`, `TechnicianTests.cs`, `AppointmentTests.cs`

**Interfaces (produced):**
```csharp
public sealed class ServiceBay : Entity
{
    public Guid DealershipId { get; private set; } public string Name { get; private set; }
    public IReadOnlySet<BayCapability> Capabilities { get; private set; }   // backing HashSet
    public bool IsActive { get; private set; }
    public static ServiceBay Create(Guid id, Guid dealershipId, string name, IEnumerable<BayCapability> capabilities, bool isActive = true);
    public bool Supports(ServiceType serviceType) => serviceType.RequiredBayCapabilities.IsSubsetOf(Capabilities);
    public int SurplusCapabilitiesFor(ServiceType serviceType) => Capabilities.Count - serviceType.RequiredBayCapabilities.Count;
    public void Deactivate(); public void Activate();
}
public sealed class Technician : Entity
{
    public Guid DealershipId { get; private set; } public string Name { get; private set; } public string EmployeeNumber { get; private set; }
    public IReadOnlySet<Certification> Certifications { get; private set; } public bool IsActive { get; private set; }
    public static Technician Create(Guid id, Guid dealershipId, string name, string employeeNumber, IEnumerable<Certification> certifications, bool isActive = true);
    public bool IsCertifiedFor(ServiceType serviceType) => serviceType.RequiredCertifications.IsSubsetOf(Certifications);
    public int SurplusCertificationsFor(ServiceType serviceType) => Certifications.Count - serviceType.RequiredCertifications.Count;
}
public sealed class ServiceType : Entity
{
    public string Code { get; private set; } public string Name { get; private set; } public ServiceDuration Duration { get; private set; }
    public IReadOnlySet<BayCapability> RequiredBayCapabilities { get; private set; } public IReadOnlySet<Certification> RequiredCertifications { get; private set; }
    public static ServiceType Create(Guid id, string code, string name, ServiceDuration duration, IEnumerable<BayCapability> requiredBayCapabilities, IEnumerable<Certification> requiredCertifications);
    // code: 2..32 chars, upper-kebab e.g. "EV-BATTERY-CHECK"; at least one required capability and one certification
}
public sealed class Appointment : AggregateRoot
{
    public Guid DealershipId { get; private set; } public Guid ServiceTypeId { get; private set; } public Guid BayId { get; private set; } public Guid TechnicianId { get; private set; }
    public TimeSlot Slot { get; private set; } public CustomerDetails Customer { get; private set; } public VehicleDetails Vehicle { get; private set; }
    public AppointmentStatus Status { get; private set; } public string? Notes { get; private set; } public string? CancellationReason { get; private set; }
    public DateTime CreatedAtUtc { get; private set; } public DateTime UpdatedAtUtc { get; private set; }
    public uint RowVersion { get; private set; }   // mapped to xmin
    public static IReadOnlyList<AppointmentStatus> ActiveStatuses { get; } = [Confirmed, CheckedIn, InProgress];
    public bool IsActive => Status is AppointmentStatus.Confirmed or AppointmentStatus.CheckedIn or AppointmentStatus.InProgress;
    public static Appointment Book(Guid id, Dealership dealership, ServiceType serviceType, ServiceBay bay, Technician technician,
                                   TimeSlot slot, OperatingWindow window, CustomerDetails customer, VehicleDetails vehicle, string? notes, DateTime nowUtc);
    // Guards (throw DomainRuleViolationException with these rule codes):
    //   bay/technician not of this dealership or inactive        -> "no-qualified-resources"
    //   !bay.Supports(serviceType) / !technician.IsCertifiedFor  -> "no-qualified-resources"
    //   slot.Duration != serviceType.Duration.AsTimeSpan         -> ArgumentException (programming error)
    //   !window.Contains(slot)                                   -> "outside-operating-hours" (extensions: operatingWindow start/end)
    // Raises AppointmentBooked.
    public void Cancel(string reason, DateTime nowUtc);   // from Confirmed|CheckedIn; reason 1..500; raises AppointmentCancelled(previousStatus, reason)
    public void CheckIn(DateTime nowUtc);                 // Confirmed -> CheckedIn
    public void Start(DateTime nowUtc);                   // CheckedIn -> InProgress
    public void Complete(DateTime nowUtc);                // InProgress -> Completed
    public void MarkNoShow(DateTime nowUtc);              // Confirmed -> NoShow, only if nowUtc >= Slot.EndUtc else "no-show-before-slot-end"
}
// AppointmentEvents.cs
public sealed record AppointmentBooked(Guid AppointmentId, Guid DealershipId, Guid ServiceTypeId, Guid BayId, Guid TechnicianId, DateTime StartUtc, DateTime EndUtc, string MaskedVin, DateTime OccurredAtUtc) : IDomainEvent { public string EventType => "Booked"; }
public sealed record AppointmentCancelled(Guid AppointmentId, AppointmentStatus PreviousStatus, string Reason, DateTime OccurredAtUtc) : IDomainEvent { public string EventType => "Cancelled"; }
public sealed record AppointmentCheckedIn(Guid AppointmentId, DateTime OccurredAtUtc) : IDomainEvent { public string EventType => "CheckedIn"; }
public sealed record AppointmentStarted(Guid AppointmentId, DateTime OccurredAtUtc) : IDomainEvent { public string EventType => "Started"; }
public sealed record AppointmentCompleted(Guid AppointmentId, DateTime OccurredAtUtc) : IDomainEvent { public string EventType => "Completed"; }
public sealed record AppointmentNoShow(Guid AppointmentId, DateTime OccurredAtUtc) : IDomainEvent { public string EventType => "NoShow"; }
```
- [ ] **Step 1: Write failing tests** — `ServiceBayTests`: `Supports_when_capabilities_superset`, `Does_not_support_when_missing_capability`, `Surplus_counts_extra_capabilities`. `TechnicianTests`: mirror. `AppointmentTests` (build a Dealership Mon–Fri 08:00–18:00 Europe/London, a 60-min service requiring `StandardLift` + `GeneralService`): `Book_creates_confirmed_appointment_and_raises_event`, `Book_rejects_bay_from_other_dealership`, `Book_rejects_inactive_technician`, `Book_rejects_incompatible_bay`, `Book_rejects_uncertified_technician`, `Book_rejects_slot_outside_window` (17:30–18:30 local), `Book_accepts_slot_ending_exactly_at_close` (17:00–18:00), `Cancel_from_confirmed_sets_reason_and_raises_event`, `Cancel_twice_throws_invalid_state_transition`, `Cancel_requires_reason`, `Full_happy_lifecycle` (CheckIn→Start→Complete), `Start_from_confirmed_is_invalid`, `MarkNoShow_before_slot_end_is_rule_violation`, `Events_are_raised_once_and_cleared`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS, build 0 warnings.
- [ ] **Step 5: Commit** `feat(domain): add bays, technicians, service catalogue and the Appointment aggregate`

### Task 5: Availability calculator and allocation policy

**Files:**
- Create: `Domain/Scheduling/AvailabilityCalculator.cs`, `AllocationPolicy.cs`
- Test: `UnitTests/Domain/AvailabilityCalculatorTests.cs`, `AllocationPolicyTests.cs`

**Interfaces (produced):**
```csharp
namespace Keyloop.ServiceScheduler.Api.Domain.Scheduling;
public sealed record ResourceBusy(Guid ResourceId, IReadOnlyList<TimeSlot> Busy);
public sealed record AvailabilitySlot(DateTime StartUtc, DateTime EndUtc, int FreeBays, int FreeTechnicians);
public static class AvailabilityCalculator
{
    /// Feasible start times on the granularity grid where >=1 bay and >=1 technician are free for the whole duration.
    public static IReadOnlyList<AvailabilitySlot> Compute(OperatingWindow window, ServiceDuration duration, int granularityMinutes,
                                                          IReadOnlyList<ResourceBusy> bays, IReadOnlyList<ResourceBusy> technicians);
    /// Ids of resources with no busy slot overlapping `slot`.
    public static IReadOnlyList<Guid> FreeResourcesAt(TimeSlot slot, IReadOnlyList<ResourceBusy> resources);
    /// Closed intervals [a, b - duration] of feasible starts for one resource (internal for tests).
    internal static IReadOnlyList<(DateTime Start, DateTime End)> FeasibleStarts(OperatingWindow window, TimeSpan duration, IReadOnlyList<TimeSlot> busy);
    /// Nearest `count` slots to `requestedStartUtc` by absolute distance (ties: earlier first).
    public static IReadOnlyList<AvailabilitySlot> Nearest(IReadOnlyList<AvailabilitySlot> slots, DateTime requestedStartUtc, int count);
}
public static class AllocationPolicy
{
    public static ServiceBay? ChooseBay(IReadOnlyList<ServiceBay> freeCompatibleBays, ServiceType serviceType, IReadOnlyDictionary<Guid, int> loadToday, Guid? preferredBayId);
    public static Technician? ChooseTechnician(IReadOnlyList<Technician> freeCertifiedTechnicians, ServiceType serviceType, IReadOnlyDictionary<Guid, int> loadToday, Guid? preferredTechnicianId);
    // Order: preferred if present in the free list; else min Surplus*For(serviceType); then min loadToday (missing = 0); then Name (ordinal); then Id.
}
```
`FeasibleStarts` algorithm: sort busy by start, merge overlapping/adjacent, clip to window, compute free intervals as the complement within `[window.StartUtc, window.EndUtc)`, and for each free `[a, b)` with `b - a >= duration` emit `(a, b - duration)`. `Compute`: for each resource compute feasible intervals; for each candidate `t = window.StartUtc + k*granularity` while `t + duration <= window.EndUtc`: `freeBays = bays.Count(b => feasible[b].Any(iv => iv.Start <= t && t <= iv.End))`, same for technicians; include when both > 0.

- [ ] **Step 1: Write failing tests** (`AvailabilityCalculatorTests`, window 08:00Z–12:00Z, duration 60, granularity 15 unless stated):
  - `Empty_day_returns_every_grid_start` → 13 slots (08:00 … 11:00), each with FreeBays = bays.Count.
  - `Worked_example_from_spec` (Bay1 busy 09:00–10:00; Bay2 busy 08:00–09:30 & 10:30–11:00; TechA busy 08:30–09:00; TechB busy 10:00–12:00) → starts exactly `[08:00, 09:30, 10:00, 10:15, 10:30, 10:45, 11:00]`.
  - `Union_of_free_sets_is_not_used` → Bay1 busy 08:30–12:00, Bay2 busy 08:00–08:30, one free technician: 08:00 is **not** available (Bay1 can only fit 0 min, Bay2's feasible starts begin 08:30) and 08:30 **is**.
  - `Duration_longer_than_any_gap_yields_nothing` (one bay busy 08:30–11:30, duration 60 → starts ≤ 07:30 impossible → only 11:30? no: 11:30+60 > 12:00 → zero slots).
  - `Back_to_back_bookings_leave_adjacent_slot_free` (bay busy 09:00–10:00 → 08:00 and 10:00 available).
  - `Fully_booked_resource_class_yields_nothing` (all technicians busy all day).
  - `Per_slot_counts_are_correct` (2 bays, one busy 08:00–09:00 → 08:00 has FreeBays 1, 09:00 has 2).
  - `FreeResourcesAt_excludes_overlapping` and `Nearest_returns_closest_three_with_earlier_tie_break`.
  - `Spring_forward_window_has_no_duplicate_starts` using a window built via `LocalTimeConverter` for Europe/London 2026-03-29 08:00–18:00: all `StartUtc` values distinct and strictly increasing by 15 minutes.
  - `AllocationPolicyTests`: `Preferred_bay_wins_when_free`, `Preferred_bay_ignored_when_not_free`, `Prefers_fewest_surplus_capabilities` (standard service: Bay with {StandardLift} beats Bay with {StandardLift, EvHighVoltage}), `Ties_broken_by_lower_load_then_name`, `Returns_null_when_no_candidates`; mirror for technicians.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(domain): add availability calculator and allocation policy`

---

## Phase 2 — Persistence

### Task 6: DbContext, configurations, interceptor, migration with exclusion constraints, seeding, integration fixture

**Addendum A (reflection/AOT):** apply §A2 (create `Common/Serialization/SchedulerJsonContext.cs` with the six event types), §A5 (`Common/Telemetry/SchedulerLog.cs` with event ids 1100/1101 for migration/seed logs) and §A7 (public static enum-array conversion methods; interceptor serialises payloads through the context; explicit `AppointmentHistoryEntry.From`). Read `docs/superpowers/plans/2026-10-11-addendum-reflection-aot.md` first.

**Files:**
- Create: `Infrastructure/Persistence/SchedulerDbContext.cs`, `SchedulerDbContextDesignTimeFactory.cs`, `AppointmentHistoryEntry.cs`, `IdempotencyKey.cs`, `DealershipLock.cs`, `PostgresErrorClassifier.cs`, `DatabaseInitializer.cs`
- Create: `Infrastructure/Persistence/Configurations/*.cs` (7 files), `Interceptors/DomainEventInterceptor.cs`, `Interceptors/IDomainEventObserver.cs`
- Create: `Infrastructure/Persistence/Seeding/ReferenceDataSeed.cs`, `DemoAppointmentSeeder.cs`
- Create: `Infrastructure/Persistence/Queries/DayScheduleReader.cs`
- Create: `Common/Options/DatabaseOptions.cs`, `Common/Http/CurrentActor.cs`
- Create: `Infrastructure/Persistence/Migrations/<timestamp>_InitialCreate.cs` (generated, then edited)
- Modify: `Program.cs` (register DbContext, options, initializer)
- Create tests: `IntegrationTests/Fixtures/PostgresFixture.cs`, `SchedulerApiFactory.cs`, `TestData.cs`; `IntegrationTests/Persistence/MigrationTests.cs`, `SeedingTests.cs`, `ExclusionConstraintTests.cs`, `DomainEventInterceptorTests.cs`

**Interfaces (produced):**
```csharp
public sealed class SchedulerDbContext(DbContextOptions<SchedulerDbContext> options) : DbContext(options)
{
    public DbSet<Dealership> Dealerships => Set<Dealership>(); public DbSet<ServiceBay> ServiceBays => Set<ServiceBay>();
    public DbSet<Technician> Technicians => Set<Technician>(); public DbSet<ServiceType> ServiceTypes => Set<ServiceType>();
    public DbSet<Appointment> Appointments => Set<Appointment>(); public DbSet<AppointmentHistoryEntry> AppointmentHistory => Set<AppointmentHistoryEntry>();
    public DbSet<IdempotencyKey> IdempotencyKeys => Set<IdempotencyKey>();
    // OnModelCreating: modelBuilder.HasPostgresExtension("btree_gist"); ApplyConfigurationsFromAssembly
}
public sealed class AppointmentHistoryEntry { Guid Id; Guid AppointmentId; string EventType; DateTime OccurredAtUtc; string Actor; string Payload /* jsonb */; static AppointmentHistoryEntry From(IDomainEvent e, string actor) }
public sealed class IdempotencyKey { string Key; string RequestFingerprint; int ResponseStatus; string ResponseBody /* jsonb */; Guid? ResourceId; DateTime CreatedAtUtc; DateTime ExpiresAtUtc; }
public static class DealershipLock
{
    public static long KeyFor(Guid dealershipId) => BitConverter.ToInt64(dealershipId.ToByteArray(), 0);
    public static Task AcquireAsync(DbContext db, Guid dealershipId, CancellationToken ct)
        => db.Database.ExecuteSqlAsync($"SELECT pg_advisory_xact_lock({KeyFor(dealershipId)})", ct);   // interpolated => parameterised
}
public enum PostgresFailure { None, BayOverlap, TechnicianOverlap, IdempotencyKeyDuplicate, Deadlock, CheckViolation, Other }
public static class PostgresErrorClassifier
{
    public const string BayConstraint = "ex_appointments_bay_no_overlap"; public const string TechnicianConstraint = "ex_appointments_technician_no_overlap";
    public static PostgresFailure Classify(Exception ex); // walks InnerException chain for PostgresException: 23P01 + ConstraintName -> Bay/TechnicianOverlap; 23505 on "pk_idempotency_keys" -> IdempotencyKeyDuplicate; 40P01 -> Deadlock; 23514 -> CheckViolation
}
public interface IDomainEventObserver { Task OnCommittedAsync(IReadOnlyList<IDomainEvent> events, CancellationToken ct); }
public sealed class DomainEventInterceptor(CurrentActor actor, IEnumerable<IDomainEventObserver> observers) : SaveChangesInterceptor
{ /* SavingChangesAsync: materialise history rows + stash; SavedChangesAsync: notify observers; SaveChangesFailedAsync: discard stash */ }
public sealed class CurrentActor { public string Name { get; set; } = "system"; }   // scoped; middleware sets "anonymous:<ip>" (Task 7)
public sealed class DatabaseOptions { public const string SectionName = "Database"; public bool MigrateOnStartup { get; set; } public bool SeedDemoData { get; set; } }
public static class DatabaseInitializer { public static Task InitializeAsync(IServiceProvider services, CancellationToken ct); } // migrate if MigrateOnStartup; ReferenceDataSeed.EnsureSeededAsync; DemoAppointmentSeeder.EnsureUpcomingWeekAsync if SeedDemoData
public static class ReferenceDataSeed
{
    public static readonly Guid ReadingDealershipId = DeterministicGuid.Create("dealership:reading");
    public static readonly Guid MunichDealershipId  = DeterministicGuid.Create("dealership:munich");
    public static Task EnsureSeededAsync(SchedulerDbContext db, TimeProvider clock, CancellationToken ct); // idempotent: skips when Dealerships.Any()
}
public sealed class DayScheduleReader(SchedulerDbContext db)
{
    public sealed record DaySnapshot(Dealership Dealership, IReadOnlyList<ServiceBay> Bays, IReadOnlyList<Technician> Technicians, IReadOnlyList<AppointmentRow> Appointments);
    public sealed record AppointmentRow(Guid Id, Guid BayId, Guid TechnicianId, Guid ServiceTypeId, TimeSlot Slot, AppointmentStatus Status, string Vin, string Registration, string CustomerName);
    public Task<DaySnapshot?> ReadAsync(Guid dealershipId, OperatingWindow window, bool activeOnly, CancellationToken ct); // AsNoTracking; appointments overlapping window
    public Task<Dictionary<Guid, int>> LoadCountsAsync(Guid dealershipId, OperatingWindow window, CancellationToken ct);  // active appointments per bay and per technician ids merged into one dictionary
}
```

Entity configuration essentials (`AppointmentConfiguration`):
```csharp
b.ToTable("appointments", t =>
{
    t.HasCheckConstraint("ck_appointments_end_after_start", "end_utc > start_utc");
    t.HasCheckConstraint("ck_appointments_vin_format", "vehicle_vin ~ '^[A-HJ-NPR-Z0-9]{17}$'");
});
b.HasKey(a => a.Id);
b.ComplexProperty(a => a.Slot, s => { s.Property(x => x.StartUtc).HasColumnName("start_utc"); s.Property(x => x.EndUtc).HasColumnName("end_utc"); });
b.ComplexProperty(a => a.Customer, c => { c.Property(x => x.Name).HasColumnName("customer_name").HasMaxLength(120); /* email 254, phone 40 */ });
b.ComplexProperty(a => a.Vehicle, v => { v.Property(x => x.Vin).HasColumnName("vehicle_vin").HasMaxLength(17).HasConversion(x => x.Value, s => Vin.Create(s)); /* registration 16, make 60, model 60 */ });
b.Property(a => a.Status).HasConversion<string>().HasMaxLength(20);
b.Property<NpgsqlRange<DateTime>>("TimeRange").HasColumnName("time_range").HasComputedColumnSql("tstzrange(start_utc, end_utc, '[)')", stored: true);
b.Property(a => a.RowVersion).HasColumnName("xmin").HasColumnType("xid").ValueGeneratedOnAddOrUpdate().IsConcurrencyToken();
b.HasIndex(a => new { a.DealershipId, a.Slot.StartUtc })... // if complex-property indexing is unsupported, index via shadow: b.HasIndex("DealershipId", "start_utc") after mapping names — verify with `dotnet ef migrations add`
b.HasOne<Dealership>().WithMany().HasForeignKey(a => a.DealershipId); // same for ServiceType, ServiceBay, Technician (no navigation properties)
b.Ignore(a => a.DomainEvents);
```
If EF Core 10 rejects `ComplexProperty` for the `sealed record` value objects in any way (e.g. `Vin` conversion inside a complex type), fall back to `OwnsOne` with the same column names; either is acceptable, but `Slot.StartUtc`/`EndUtc` must be queryable in LINQ.
`ServiceBay`/`Technician`/`ServiceType` arrays: `b.Property(x => x.Capabilities).HasColumnName("capabilities").HasColumnType("text[]").HasConversion(v => v.Select(c => c.ToString()).OrderBy(s => s).ToArray(), v => v.Select(Enum.Parse<BayCapability>).ToHashSet(), new ValueComparer<IReadOnlySet<BayCapability>>((a, b) => a!.SetEquals(b!), v => v.Aggregate(0, (h, c) => HashCode.Combine(h, c)), v => v.ToHashSet()))` and `b.HasIndex(x => x.Capabilities).HasMethod("gin")`. Technician `employee_number` unique per dealership. ServiceType `code` unique. Dealership `OwnsMany(d => d.Hours.Days)` → table `dealership_operating_hours` keyed by `(dealership_id, day)` — if owning through `OperatingHours` proves awkward, map `OperatingHours` as an owned type with `OwnsMany(h => h.Days)`; both are fine as long as the table shape in spec §8.8 results.

Migration: run `dotnet ef migrations add InitialCreate -o Infrastructure/Persistence/Migrations` (needs `SchedulerDbContextDesignTimeFactory` returning `UseNpgsql("Host=localhost;Database=design").UseSnakeCaseNamingConvention()`), then **edit** the generated `Up()` to append after the table creation:
```csharp
migrationBuilder.Sql("""
    ALTER TABLE appointments ADD CONSTRAINT ex_appointments_bay_no_overlap
        EXCLUDE USING gist (bay_id WITH =, time_range WITH &&)
        WHERE (status IN ('Confirmed', 'CheckedIn', 'InProgress'));
    ALTER TABLE appointments ADD CONSTRAINT ex_appointments_technician_no_overlap
        EXCLUDE USING gist (technician_id WITH =, time_range WITH &&)
        WHERE (status IN ('Confirmed', 'CheckedIn', 'InProgress'));
    """);
```
and the matching `DROP CONSTRAINT` statements in `Down()`. Confirm the migration also contains the `btree_gist` extension annotation and the stored generated column. The `idempotency_keys` primary key constraint must be named `pk_idempotency_keys` (snake-case convention default) — assert in `MigrationTests`.

Seed data (`ReferenceDataSeed`), deterministic ids via `DeterministicGuid.Create("<kind>:<slug>")`:
- Dealerships: **Keyloop Motors Reading** (`Europe/London`, Mon–Fri 08:00–18:00, Sat 08:00–13:00, Sun closed); **Keyloop Autohaus München** (`Europe/Berlin`, Mon–Fri 07:30–18:30, Sat closed, Sun closed).
- Reading bays: `Bay 1 — Standard` {StandardLift}; `Bay 2 — Alignment` {StandardLift, WheelAlignment}; `Bay 3 — Heavy duty` {HeavyDutyLift, StandardLift}; `Bay 4 — EV` {EvHighVoltage, StandardLift}; `Bay 5 — Diagnostics` {StandardLift, Diagnostics, AirConditioning}; `Bay 6 — MOT` {StandardLift, MotTesting}.
- Reading technicians: Amelia Clarke `T-1001` {GeneralService, Brakes, MotTester}; Ben Okafor `T-1002` {GeneralService, HighVoltageElectrical, Diagnostics}; Chloe Nguyen `T-1003` {GeneralService, WheelAlignment, Brakes}; Daniel Moss `T-1004` {GeneralService, HeavyVehicle, Brakes}; Eva Lindqvist `T-1005` {GeneralService, AirConditioning, Diagnostics}; Farid Haddad `T-1006` {GeneralService, MotTester, Diagnostics}.
- Munich: 3 bays (`Halle 1` {StandardLift}, `Halle 2` {StandardLift, EvHighVoltage}, `Halle 3` {HeavyDutyLift, StandardLift}) and 3 technicians (Greta Vogel `M-2001` {GeneralService, Brakes}; Hans Richter `M-2002` {GeneralService, HighVoltageElectrical}; Ingrid Bauer `M-2003` {GeneralService, HeavyVehicle, Diagnostics}).
- Service types (code, name, minutes, bay caps, certs): `INTERIM-SERVICE` Interim Service 60 {StandardLift} {GeneralService}; `FULL-SERVICE` Full Service 120 {StandardLift} {GeneralService}; `MOT-TEST` MOT Test 45 {MotTesting} {MotTester}; `BRAKES-PADS-DISCS` Brake Pads & Discs 90 {StandardLift} {Brakes}; `EV-BATTERY-CHECK` EV Battery Health Check 60 {EvHighVoltage} {HighVoltageElectrical}; `EV-CHARGING-FAULT` EV Charging Fault Diagnosis 90 {EvHighVoltage, Diagnostics}? — Reading has no bay with both; use {EvHighVoltage} {HighVoltageElectrical, Diagnostics}; `WHEEL-ALIGNMENT` Four-Wheel Alignment 45 {WheelAlignment} {WheelAlignment}; `HEAVY-VAN-SERVICE` Heavy Van Service 180 {HeavyDutyLift} {HeavyVehicle}; `AIRCON-REGAS` Air-Con Regas 60 {AirConditioning} {AirConditioning}; `DIAG-FAULT-FINDING` Diagnostic Fault Finding 60 {Diagnostics} {Diagnostics}.
`DemoAppointmentSeeder.EnsureUpcomingWeekAsync`: for each of the next 7 local dates at Reading on which the dealership is open, if no non-cancelled appointment exists on that date, create 4–6 appointments by walking a fixed pattern of (service code, local start) pairs — `INTERIM-SERVICE 08:00`, `EV-BATTERY-CHECK 09:00`, `BRAKES-PADS-DISCS 10:30`, `MOT-TEST 11:00`, `FULL-SERVICE 13:00`, `WHEEL-ALIGNMENT 15:00` — allocating through `AvailabilityCalculator.FreeResourcesAt` + `AllocationPolicy` and skipping any that are infeasible; ids `DeterministicGuid.Create($"appointment:{date:yyyy-MM-dd}:{code}")`; customers/vehicles from a fixed table of 8 realistic entries with valid VINs (e.g. `WVWZZZ1KZAW123456`, `SB1KZ3JE60E123457`, `WBA3A5C58DF123458`, `VF1RFB00X59123459`, `JTDKN3DU0A0123460`, `WF0XXXGCDXDA12346`, `TMBJF9NE9N0123462`, `KMHD35LE2EU123463`).

- [ ] **Step 1: Write the integration fixture**
```csharp
// Fixtures/PostgresFixture.cs
[assembly: AssemblyFixture(typeof(PostgresFixture))]
public sealed class PostgresFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:17").WithDatabase("schedulerdb").WithUsername("scheduler").WithPassword("scheduler-test").Build();
    public string ConnectionString => _container.GetConnectionString();
    public async ValueTask InitializeAsync() => await _container.StartAsync();
    public async ValueTask DisposeAsync() => await _container.DisposeAsync();
}
// Fixtures/SchedulerApiFactory.cs
public sealed class SchedulerApiFactory(string connectionString, FakeTimeProvider clock) : WebApplicationFactory<Program>
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("SystemTest");
        builder.UseSetting("ConnectionStrings:schedulerdb", connectionString);
        builder.UseSetting("Database:MigrateOnStartup", "true");
        builder.UseSetting("Database:SeedDemoData", "false");
        builder.ConfigureTestServices(s => s.AddSingleton<TimeProvider>(clock));
    }
    public async Task ResetAsync()  // Respawn: all tables in public except __EFMigrationsHistory
    public async Task<T> WithDbAsync<T>(Func<SchedulerDbContext, Task<T>> work)
}
```
The default `FakeTimeProvider` instant for tests is **2026-10-12T08:00:00Z (Monday)**; the standard booking day is **2026-10-13 (Tuesday)**. `TestData` exposes builders: `NewDealership(name, tz, hours)`, `NewBay(dealershipId, name, caps)`, `NewTechnician(...)`, `NewServiceType(code, minutes, caps, certs)`, `Vehicle(vin)`, `Customer(n)`, and `ContentionDealershipAsync(db)` = one bay {EvHighVoltage} + one technician {HighVoltageElectrical} + `EV-BATTERY-CHECK` 60 min, Mon–Sat 08:00–18:00 Europe/London.
- [ ] **Step 2: Write failing tests** — `MigrationTests`: `Migrations_apply_from_empty_database` (no pending migrations after `MigrateAsync`), `Exclusion_constraints_and_extension_exist` (query `pg_constraint` for both names with `contype = 'x'`; `pg_extension` has `btree_gist`), `Generated_time_range_matches_start_end` (insert via EF, read `time_range::text`). `ExclusionConstraintTests`: `Direct_sql_overlapping_bay_insert_is_rejected_with_23P01` (insert appointment via EF, then `ExecuteSqlRawAsync` a second row same bay overlapping → `PostgresException.SqlState == "23P01"` and `PostgresErrorClassifier.Classify(ex) == BayOverlap`), `Technician_overlap_rejected`, `Cancelled_row_does_not_block` (status Cancelled → second insert succeeds), `Adjacent_rows_do_not_conflict`. `SeedingTests`: `Reference_seed_is_idempotent` (run twice → counts unchanged; 2 dealerships, 9 bays, 9 technicians, 10 service types), `Demo_seeder_populates_upcoming_week_without_overlaps` (no two active rows overlap per bay/technician — assert by LINQ), `Demo_seeder_is_idempotent`. `DomainEventInterceptorTests`: `Booking_writes_history_row_in_same_transaction` (one `Booked` row, actor = "system" when no HTTP context), `Failed_save_writes_no_history` (force 23P01 → zero history rows for that id).
- [ ] **Step 3: Run** → FAIL. **Step 4: Implement** everything in Files. Register in `Program.cs`:
```csharp
builder.Services.AddOptions<DatabaseOptions>().BindConfiguration(DatabaseOptions.SectionName);
builder.Services.AddScoped<CurrentActor>();
builder.Services.AddScoped<DomainEventInterceptor>();
builder.Services.AddScoped<DayScheduleReader>();
var connectionString = builder.Configuration.GetConnectionString("schedulerdb") ?? throw new InvalidOperationException("Connection string 'schedulerdb' is missing.");
builder.Services.AddDbContext<SchedulerDbContext>((sp, o) => o.UseNpgsql(connectionString).UseSnakeCaseNamingConvention().AddInterceptors(sp.GetRequiredService<DomainEventInterceptor>()));
builder.EnrichNpgsqlDbContext<SchedulerDbContext>();
builder.Services.AddSingleton(TimeProvider.System);
// after Build():
await DatabaseInitializer.InitializeAsync(app.Services, CancellationToken.None);
```
`appsettings.Development.json`: `"Database": { "MigrateOnStartup": true, "SeedDemoData": true }`; `appsettings.json` defaults both `false`.
- [ ] **Step 5: Run** `dotnet test --project tests/Keyloop.ServiceScheduler.IntegrationTests` (Colima running) → PASS. `dotnet ef migrations list --project src/Keyloop.ServiceScheduler.Api` shows one migration.
- [ ] **Step 6: Commit** `feat(persistence): add EF Core model, exclusion-constraint migration, domain-event audit interceptor and seed data`

---

## Phase 3 — API cross-cutting and slices

### Task 7: Cross-cutting API infrastructure (endpoints, validation, problems, telemetry, options, security)

**Addendum B (OpenAPI/UI):** apply §B1 guard (`BuildTimeOpenApi.IsActive`, placeholder connection string, skip `DatabaseInitializer`; `__throw` endpoint `.ExcludeFromDescription()`), §B2 conventions (static handler methods, XML comments, fixed tags, document transformer for info/tags, clear `servers`), §B3 Scalar configuration. Register the domain `OperatingWindow`, `BayCapability[]` and `Certification[]` in `SchedulerJsonContext` (Task 4 uses `OperatingWindow` as the `operatingWindow` problem extension, so the planned `OperatingWindowExtension` record is not needed).

**Addendum A (reflection/AOT):** apply §A1 (csproj switches, Mapperly package), §A2 (register `SchedulerJsonContext` first in the resolver chain, register ProblemDetails extension records, no `JsonStringEnumConverter`), §A3 (`EndpointRegistry`, explicit validator/handler registration — `AddValidatorsFromAssemblyContaining` is forbidden), §A4 (`[OptionsValidator]` validators replacing `ValidateDataAnnotations()`), §A5 (all log calls through `SchedulerLog`). Replace the anonymous `operatingWindow` extension object with a named record `OperatingWindowExtension(DateTime StartUtc, DateTime EndUtc)` registered in the context. Read the addendum first.

**Files:**
- Create: `Common/Endpoints/IEndpoint.cs`, `EndpointExtensions.cs`; `Common/Validation/ValidationFilter.cs`; `Common/Problems/ProblemTypes.cs`, `ApiExceptions.cs`, `GlobalExceptionHandler.cs`, `SuggestedSlot.cs`; `Common/Telemetry/SchedulerTelemetry.cs`, `TelemetryDomainEventObserver.cs`; `Common/Options/SchedulingOptions.cs`, `SecurityOptions.cs`; `Common/Http/SecurityHeadersMiddleware.cs`, `CurrentActorMiddleware.cs`
- Modify: `Program.cs`; `appsettings*.json` (all five)
- Test: `UnitTests/Common/PostgresErrorClassifierTests.cs`, `IntegrationTests/Api/ProblemDetailsTests.cs`

**Interfaces (produced):**
```csharp
public interface IEndpoint { static abstract void Map(IEndpointRouteBuilder app); }
public static class EndpointExtensions { public static IEndpointRouteBuilder MapSchedulerEndpoints(this WebApplication app); } // RouteGroup "/api/v1" .WithOpenApi? no — .WithGroupName("v1"); reflects over assembly for IEndpoint implementers and calls Map(group)
public sealed class ValidationFilter<T> : IEndpointFilter where T : class { /* resolves IValidator<T>; on failure returns Problems.Validation(errors) */ }
public static class ProblemTypes
{
    public const string Base = "https://api.keyloop.example/problems/";
    public const string ValidationError = Base + "validation-error", NotFound = Base + "not-found", OutsideOperatingHours = Base + "outside-operating-hours",
        LeadTimeNotMet = Base + "lead-time-not-met", BeyondBookingHorizon = Base + "beyond-booking-horizon", SlotNotAligned = Base + "slot-not-aligned",
        NoQualifiedResources = Base + "no-qualified-resources", IdempotencyKeyReuse = Base + "idempotency-key-reuse", SlotUnavailable = Base + "slot-unavailable",
        SlotConflict = Base + "slot-conflict", InvalidStateTransition = Base + "invalid-state-transition", ConcurrencyConflict = Base + "concurrency-conflict",
        RateLimited = Base + "rate-limited", InternalError = Base + "internal-error";
    public static string ForRule(string ruleCode) => Base + ruleCode;
}
public sealed record SuggestedSlot(DateTime StartUtc, DateTime EndUtc, string StartLocal);
// ApiExceptions.cs (application-level, thrown by handlers, mapped by GlobalExceptionHandler)
public sealed class NotFoundException(string resource, Guid id) : Exception($"{resource} '{id}' was not found.") { public string Resource {get;} public Guid Id {get;} }
public sealed class SlotUnavailableException(IReadOnlyList<SuggestedSlot> suggestions) : Exception("No compatible bay and certified technician are free at the requested time.") { public IReadOnlyList<SuggestedSlot> Suggestions {get;} }
public sealed class SlotConflictException(string conflictingResource, IReadOnlyList<SuggestedSlot> suggestions) : Exception("The slot was taken by a concurrent booking.") { ... }
public sealed class IdempotencyKeyReuseException() : Exception("The Idempotency-Key was already used with a different request.");
public sealed class GlobalExceptionHandler(IProblemDetailsService problems, ILogger<GlobalExceptionHandler> logger) : IExceptionHandler
{ /* DomainRuleViolationException -> 422 type ForRule(RuleCode) + Extensions; InvalidStateTransitionException -> 409 {currentStatus, attempted};
     NotFoundException -> 404 {resource, id}; SlotUnavailableException -> 409 {suggestedSlots}; SlotConflictException -> 409 {suggestedSlots, conflictingResource};
     IdempotencyKeyReuseException -> 422; DbUpdateConcurrencyException -> 409 concurrency-conflict; OperationCanceledException -> 499 (no body);
     else -> 500 internal-error (log Error with exception; detail "An unexpected error occurred."). Every response: title from catalogue, instance = request path, traceId. */ }
public static class SchedulerTelemetry
{
    public const string Name = "Keyloop.ServiceScheduler";
    public static readonly ActivitySource Source = new(Name);
    public static readonly Meter Meter = new(Name);
    public static readonly Counter<long> BookingRequests = Meter.CreateCounter<long>("scheduler.booking.requests", "{request}");
    public static readonly Histogram<double> BookingDuration = Meter.CreateHistogram<double>("scheduler.booking.duration", "ms");
    public static readonly Histogram<double> LockWait = Meter.CreateHistogram<double>("scheduler.booking.lock_wait", "ms");
    public static readonly Counter<long> ConstraintBackstop = Meter.CreateCounter<long>("scheduler.booking.constraint_backstop", "{event}");
    public static readonly Counter<long> Deadlocks = Meter.CreateCounter<long>("scheduler.booking.deadlocks", "{event}");
    public static readonly Histogram<double> AvailabilityDuration = Meter.CreateHistogram<double>("scheduler.availability.duration", "ms");
    public static readonly Histogram<long> AvailabilitySlotsReturned = Meter.CreateHistogram<long>("scheduler.availability.slots_returned", "{slot}");
    public static readonly Counter<long> Cancellations = Meter.CreateCounter<long>("scheduler.appointments.cancellations", "{appointment}");
}
public sealed class TelemetryDomainEventObserver(ILogger<TelemetryDomainEventObserver> logger) : IDomainEventObserver { /* logs event ids 1001 BookingConfirmed (AppointmentId, DealershipId, BayId, TechnicianId, StartUtc, MaskedVin), 1010 AppointmentCancelled; increments Cancellations */ }
public sealed class SchedulingOptions { public const string SectionName = "Scheduling"; [Range(5, 60)] public int SlotGranularityMinutes { get; set; } = 15; public TimeSpan MinimumLeadTime { get; set; } = TimeSpan.Zero; [Range(1, 365)] public int BookingHorizonDays { get; set; } = 90; [Range(0, 10)] public int SuggestedSlotCount { get; set; } = 3; }
public sealed class SecurityOptions { public const string SectionName = "Security"; public string[] AllowedOrigins { get; set; } = []; public RateLimitingOptions RateLimiting { get; set; } = new(); public sealed class RateLimitingOptions { public bool Enabled { get; set; } = true; public int GlobalPermitsPerMinute { get; set; } = 300; public int BookingPermitsPerMinute { get; set; } = 30; } }
```
`Program.cs` final composition order (keep this order):
```csharp
var builder = WebApplication.CreateBuilder(args);
builder.AddServiceDefaults();
builder.Services.AddOptions<SchedulingOptions>().BindConfiguration(SchedulingOptions.SectionName).ValidateDataAnnotations().ValidateOnStart();
builder.Services.AddOptions<DatabaseOptions>().BindConfiguration(DatabaseOptions.SectionName);
builder.Services.AddOptions<SecurityOptions>().BindConfiguration(SecurityOptions.SectionName).ValidateOnStart();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton(sp => { var o = sp.GetRequiredService<IOptions<SchedulingOptions>>().Value; return new BookingWindowPolicy(sp.GetRequiredService<TimeProvider>(), o.MinimumLeadTime, TimeSpan.FromDays(o.BookingHorizonDays)); });
builder.Services.AddScoped<CurrentActor>(); builder.Services.AddScoped<DomainEventInterceptor>(); builder.Services.AddScoped<IDomainEventObserver, TelemetryDomainEventObserver>(); builder.Services.AddScoped<DayScheduleReader>();
/* DbContext as in Task 6 */
builder.Services.AddValidatorsFromAssemblyContaining<Program>(includeInternalTypes: true);
builder.Services.AddScoped<GetDealershipsHandler>(); /* ...one AddScoped per handler, added by the slice tasks */
builder.Services.ConfigureHttpJsonOptions(o => { o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()); o.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.Never; });
builder.Services.AddProblemDetails(o => o.CustomizeProblemDetails = ctx => { ctx.ProblemDetails.Extensions.TryAdd("traceId", Activity.Current?.Id ?? ctx.HttpContext.TraceIdentifier); });
builder.Services.AddExceptionHandler<GlobalExceptionHandler>();
builder.Services.AddOpenApi("v1", o => o.AddDocumentTransformer((doc, _, _) => { doc.Info = new() { Title = "Keyloop Unified Service Scheduler API", Version = "v1", Description = "Multi-resource workshop appointment booking." }; return Task.CompletedTask; }));
builder.Services.AddCors(o => o.AddDefaultPolicy(p => { var origins = builder.Configuration.GetSection("Security:AllowedOrigins").Get<string[]>() ?? []; if (origins.Length > 0) p.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod().WithExposedHeaders("Location", "Idempotent-Replayed"); }));
builder.Services.AddRateLimiter(o => { /* global + "booking" sliding-window per RemoteIpAddress; when Security:RateLimiting:Enabled is false use RateLimitPartition.GetNoLimiter; OnRejected writes ProblemDetails 429 rate-limited with retryAfterSeconds */ });
builder.WebHost.ConfigureKestrel(k => k.Limits.MaxRequestBodySize = 64 * 1024);
var app = builder.Build();
app.UseExceptionHandler(); app.UseStatusCodePages();
if (!app.Environment.IsDevelopment() && !app.Environment.IsEnvironment("SystemTest")) { app.UseHsts(); app.UseHttpsRedirection(); }
app.UseMiddleware<SecurityHeadersMiddleware>(); app.UseCors(); app.UseRateLimiter(); app.UseMiddleware<CurrentActorMiddleware>();
app.MapDefaultEndpoints();
if (!app.Environment.IsProduction()) { app.MapOpenApi(); app.MapScalarApiReference(o => o.WithTitle("Keyloop Service Scheduler")); }
app.MapSchedulerEndpoints();
await DatabaseInitializer.InitializeAsync(app.Services, CancellationToken.None);
await app.RunAsync();
public partial class Program;
```
`appsettings.json`: `Scheduling` defaults (15 / "01:00:00" / 90 / 3), `Database` false/false, `Security.RateLimiting` enabled 300/30. `appsettings.Development.json`: `MinimumLeadTime "00:00:00"`, `Database` true/true, `RateLimiting.BookingPermitsPerMinute 120`. `appsettings.SystemTest.json`: `MinimumLeadTime "00:00:00"`, `RateLimiting.Enabled false`. `appsettings.UAT.json` and `appsettings.Production.json`: `MinimumLeadTime "01:00:00"`, `Database` false/false, `Security.AllowedOrigins []`, production rate limits. Scalar is mapped by the `!IsProduction()` check.
`SecurityHeadersMiddleware`: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`, `Cache-Control: no-store` for `/api/*`, `X-Frame-Options: DENY`.
`CurrentActorMiddleware`: `actor.Name = $"anonymous:{ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown"}"`.

- [ ] **Step 1: Write failing tests** — `PostgresErrorClassifierTests` (construct `PostgresException` instances with `SqlState`/`ConstraintName` via the public ctor: `23P01` + bay constraint → `BayOverlap`; technician → `TechnicianOverlap`; `23505` + `pk_idempotency_keys` → `IdempotencyKeyDuplicate`; `40P01` → `Deadlock`; wrapped in `DbUpdateException` → same; unrelated → `Other`). `ProblemDetailsTests` (WAF): `Unknown_route_returns_404_problem_with_traceId`, `Unhandled_exception_returns_500_problem_without_details` (add a `SystemTest`-only endpoint `/api/v1/__throw` mapped when `app.Environment.IsEnvironment("SystemTest")`), `Security_headers_present_on_api_responses`, `Enums_serialise_as_strings` (via `/openapi/v1.json` schema for `AppointmentStatus` shows `enum: [...]` strings).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; build 0 warnings.
- [ ] **Step 5: Commit** `feat(api): add endpoint discovery, validation filter, problem catalogue, telemetry, options and security middleware`

### Task 8: GetDealerships and GetServiceTypes slices

**Addendum B (OpenAPI/UI):** apply §B2 (static handler methods with XML docs and `<response>` codes; tags `Dealerships`, `Catalog`; `<summary>` on response properties).

**Addendum A (reflection/AOT):** apply §A6 (`Features/Dealerships/Mapping/DealershipMapper.cs`, `Features/Catalog/Mapping/ServiceTypeMapper.cs` with Mapperly), §A2 (register `DealershipResponse`, `DayOperatingHoursResponse`, `ServiceTypeResponse` and the top-level `IReadOnlyList<...>` types in `SchedulerJsonContext`), §A3 (add both endpoints to `EndpointRegistry`).

**Files:** `Features/Dealerships/GetDealerships/{GetDealershipsEndpoint,GetDealershipsHandler,DealershipResponse}.cs`; `Features/Catalog/GetServiceTypes/{GetServiceTypesEndpoint,GetServiceTypesHandler,ServiceTypeResponse}.cs`; tests `IntegrationTests/Api/DealershipsEndpointTests.cs`, `ServiceTypesEndpointTests.cs`; modify `Program.cs` (register handlers).

**Interfaces (produced):**
```csharp
public sealed record DayOperatingHoursResponse(DayOfWeek Day, string? OpensAt, string? ClosesAt); // "08:00"
public sealed record DealershipResponse(Guid Id, string Name, string TimeZoneId, IReadOnlyList<DayOperatingHoursResponse> OperatingHours);
public sealed record ServiceTypeResponse(Guid Id, string Code, string Name, int DurationMinutes, IReadOnlyList<BayCapability> RequiredBayCapabilities, IReadOnlyList<Certification> RequiredCertifications, bool Bookable);
// Endpoints: GET /dealerships  -> WithName("GetDealerships")  Produces<IReadOnlyList<DealershipResponse>>(200)
//            GET /dealerships/{dealershipId:guid}/service-types -> WithName("GetServiceTypes") Produces<IReadOnlyList<ServiceTypeResponse>>(200), ProducesProblem(404)
// Bookable = dealership has >=1 active bay with Supports(st) && >=1 active technician IsCertifiedFor(st). Ordered by Name.
```
- [ ] **Step 1: Failing tests**: `GetDealerships_returns_seeded_dealerships_ordered_by_name` (seed reference data in the test via `ReferenceDataSeed.EnsureSeededAsync`), `GetServiceTypes_marks_ev_service_not_bookable_when_no_ev_bay` (custom dealership without EV bay), `GetServiceTypes_unknown_dealership_404_problem`.
- [ ] **Step 2–4:** Run → FAIL; implement; run → PASS.
- [ ] **Step 5: Commit** `feat(api): add dealerships and service catalogue slices`

### Task 9: GetAvailability slice

**Addendum B (OpenAPI/UI):** apply §B2 (tag `Availability`; `<param>` docs with `example` attributes for `serviceTypeId` and `date`).

**Addendum A (reflection/AOT):** apply §A6 (`Features/Availability/Mapping/AvailabilityMapper.cs` for `AvailabilitySlot`→`AvailabilitySlotResponse` with the local string as an additional parameter), §A2 (register `AvailabilityResponse`, `AvailabilitySlotResponse`, `OperatingWindowResponse`), §A3 (registry line), explicit `AddScoped<IValidator<GetAvailabilityQuery>, GetAvailabilityValidator>()`.

**Files:** `Features/Availability/GetAvailability/{GetAvailabilityEndpoint,GetAvailabilityQuery,GetAvailabilityValidator,GetAvailabilityHandler,AvailabilityResponse}.cs`; test `IntegrationTests/Api/AvailabilityEndpointTests.cs`, `UnitTests/Features/GetAvailabilityValidatorTests.cs`.

**Interfaces (produced):**
```csharp
public sealed record GetAvailabilityQuery(Guid DealershipId, Guid ServiceTypeId, DateOnly Date);
public sealed record OperatingWindowResponse(DateTime StartUtc, DateTime EndUtc, string OpensAtLocal, string ClosesAtLocal);
public sealed record AvailabilitySlotResponse(DateTime StartUtc, DateTime EndUtc, string StartLocal, int FreeBays, int FreeTechnicians);
public sealed record AvailabilityResponse(DateOnly Date, string TimeZoneId, OperatingWindowResponse? OperatingWindow, int DurationMinutes, int SlotGranularityMinutes, IReadOnlyList<AvailabilitySlotResponse> Slots, string? UnavailableReason);
// UnavailableReason: "closed" | "no-qualified-resources" | null
// GET /dealerships/{dealershipId:guid}/availability?serviceTypeId=&date=   WithName("GetAvailability") Produces 200, ProducesValidationProblem 400, ProducesProblem 404
// Validator: ServiceTypeId != Guid.Empty; Date within [today-1, today+BookingHorizonDays+1] in UTC terms (loose; the policy is exact on booking)
public sealed class GetAvailabilityHandler(DayScheduleReader reader, IOptions<SchedulingOptions> options)
{ public Task<AvailabilityResponse> HandleAsync(GetAvailabilityQuery q, CancellationToken ct); }
// Handler: dealership/service type -> 404; window null -> Slots [] reason "closed"; compatible/certified sets empty -> reason "no-qualified-resources";
// else reader.ReadAsync(activeOnly:true) -> ResourceBusy per candidate resource -> AvailabilityCalculator.Compute; records AvailabilityDuration + AvailabilitySlotsReturned; span "scheduler.compute_availability".
```
- [ ] **Step 1: Failing tests**: `Availability_on_closed_day_returns_empty_with_reason`, `Availability_matches_domain_calculator_for_seeded_day` (seed one dealership + 2 bays + 2 technicians + 3 appointments via DbContext; compute expected with `AvailabilityCalculator` in the test; compare StartUtc lists), `Availability_reports_no_qualified_resources`, `Availability_invalid_service_type_id_400`, `Availability_unknown_dealership_404`, `Availability_slot_local_strings_use_dealership_zone` (Europe/Berlin dealership: 07:30 local → "2026-10-13T07:30").
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(api): add availability slice backed by the domain calculator`

### Task 10: BookAppointment slice (lock, allocation, idempotency, suggestions)

**Addendum B (OpenAPI/UI):** apply §B2 (tag `Appointments`; `<example>` on every `BookAppointmentRequest`/`CustomerRequest`/`VehicleRequest` property so Scalar's test request is a valid booking; `<response>` for 201/400/404/409/422/429 and the `Idempotency-Key` header documented).

**Addendum A (reflection/AOT):** apply §A6 (`Features/Appointments/Mapping/AppointmentMapper.cs`; `AppointmentResponseMapper` becomes a thin wrapper), §A2 (register `BookAppointmentRequest`, `CustomerRequest`, `VehicleRequest`, `AppointmentResponse` and its nested records, `SuggestedSlot`, `IReadOnlyList<SuggestedSlot>`; serialise/deserialise idempotency bodies with `SchedulerJsonContext.Default.AppointmentResponse`), §A3 (registry line, explicit validator registration), §A5 (events 1001–1004 via `SchedulerLog`).

**Files:** `Features/Appointments/Shared/{AppointmentResponse,AppointmentResponseMapper}.cs`; `Features/Appointments/BookAppointment/{BookAppointmentEndpoint,BookAppointmentRequest,BookAppointmentValidator,BookAppointmentHandler,BookingAttempt,IdempotencyFingerprint}.cs`; `IntegrationTests/Api/BookAppointmentTests.cs`, `IdempotencyTests.cs`, `Fixtures/ProblemAssertions.cs`; `UnitTests/Features/BookAppointmentValidatorTests.cs`.

**Interfaces (produced):**
```csharp
public sealed record CustomerRequest(string Name, string Email, string Phone);
public sealed record VehicleRequest(string Vin, string Registration, string Make, string Model);
public sealed record BookAppointmentRequest(Guid ServiceTypeId, DateTime StartUtc, CustomerRequest Customer, VehicleRequest Vehicle, Guid? PreferredBayId, Guid? PreferredTechnicianId, string? Notes);
public sealed record BookAppointmentCommand(Guid DealershipId, BookAppointmentRequest Request, string? IdempotencyKey);
public sealed record ResourceSummary(Guid Id, string Name);
public sealed record ServiceTypeSummary(Guid Id, string Code, string Name, int DurationMinutes);
public sealed record CustomerResponse(string Name, string Email, string Phone);
public sealed record VehicleResponse(string Vin, string Registration, string Make, string Model);
public sealed record AppointmentResponse(Guid Id, Guid DealershipId, ServiceTypeSummary ServiceType, ResourceSummary Bay, ResourceSummary Technician, DateTime StartUtc, DateTime EndUtc, string StartLocal, string EndLocal, AppointmentStatus Status, CustomerResponse Customer, VehicleResponse Vehicle, string? Notes, string? CancellationReason, DateTime CreatedAtUtc, DateTime UpdatedAtUtc);
public static class AppointmentResponseMapper { public static AppointmentResponse Map(Appointment a, TimeZoneInfo zone, ServiceType st, ServiceBay bay, Technician tech); }
public sealed record BookAppointmentResult(AppointmentResponse Appointment, bool Replayed);
public abstract record BookingAttempt { public sealed record Confirmed(Appointment Appointment, ServiceBay Bay, Technician Technician) : BookingAttempt; public sealed record Unavailable : BookingAttempt; public sealed record Conflict(string Resource) : BookingAttempt; public sealed record DuplicateKey : BookingAttempt; }
public static class IdempotencyFingerprint { public static string Compute(Guid dealershipId, BookAppointmentRequest request); } // SHA-256 hex of dealershipId + "\n" + JSON(request) with the app's JsonSerializerOptions
// POST /dealerships/{dealershipId:guid}/appointments  WithName("BookAppointment")  AddEndpointFilter<ValidationFilter<BookAppointmentRequest>>()  RequireRateLimiting("booking")
//   Produces<AppointmentResponse>(201) ProducesValidationProblem(400) ProducesProblem(404) ProducesProblem(409) ProducesProblem(422) ProducesProblem(429)
//   Header "Idempotency-Key" optional, 1..64 chars [A-Za-z0-9_-]; invalid -> 400 validation-error (errors: {"Idempotency-Key": [...]})
//   Success: 201 Created, Location /api/v1/appointments/{id}; when Replayed also header "Idempotent-Replayed: true"
```
Validator rules: `ServiceTypeId` not empty; `StartUtc.Kind == Utc` (minimal API binds `Z` strings as Utc; reject `Unspecified`) and seconds/milliseconds = 0; `Customer.Name` 1–120, `Email` valid email ≤ 254, `Phone` 3–40 matching `^[+0-9 ()-]+$`; `Vehicle.Vin` → `Vin.TryCreate`; `Registration` 1–16; `Make`/`Model` 1–60; `Notes` ≤ 1000.

Handler algorithm (`HandleAsync(BookAppointmentCommand cmd, CancellationToken ct)` → `BookAppointmentResult`):
```csharp
using var activity = SchedulerTelemetry.Source.StartActivity("scheduler.book_appointment");
activity?.SetTag("dealership.id", cmd.DealershipId);
var started = clock.GetTimestamp(); var outcome = "error";
try
{
    var dealership = await db.Dealerships.AsNoTracking().FirstOrDefaultAsync(d => d.Id == cmd.DealershipId, ct) ?? throw new NotFoundException("dealership", cmd.DealershipId);
    var serviceType = await db.ServiceTypes.AsNoTracking().FirstOrDefaultAsync(s => s.Id == cmd.Request.ServiceTypeId, ct) ?? throw new NotFoundException("service-type", cmd.Request.ServiceTypeId);
    activity?.SetTag("service_type.code", serviceType.Code);
    var zone = dealership.TimeZone; var localDate = LocalTimeConverter.ToLocalDate(cmd.Request.StartUtc, zone);
    var window = dealership.ResolveOperatingWindow(localDate) ?? throw new DomainRuleViolationException("outside-operating-hours", $"{dealership.Name} is closed on {localDate.DayOfWeek}.", new Dictionary<string, object?> { ["localDate"] = localDate });
    var slot = TimeSlot.FromStart(cmd.Request.StartUtc, serviceType.Duration);
    if (!window.Contains(slot)) throw new DomainRuleViolationException("outside-operating-hours", "The requested slot is outside the dealership's operating window.", new Dictionary<string, object?> { ["operatingWindow"] = new { window.StartUtc, window.EndUtc } });
    windowPolicy.EnsureBookable(slot.StartUtc); BookingWindowPolicy.EnsureAligned(slot.StartUtc, window, options.Value.SlotGranularityMinutes);
    var bays = await db.ServiceBays.AsNoTracking().Where(b => b.DealershipId == dealership.Id && b.IsActive).ToListAsync(ct);
    var technicians = await db.Technicians.AsNoTracking().Where(t => t.DealershipId == dealership.Id && t.IsActive).ToListAsync(ct);
    var compatibleBays = bays.Where(b => b.Supports(serviceType)).ToList(); var certified = technicians.Where(t => t.IsCertifiedFor(serviceType)).ToList();
    if (compatibleBays.Count == 0 || certified.Count == 0) throw new DomainRuleViolationException("no-qualified-resources", "...", new Dictionary<string, object?> { ["missingCapabilities"] = serviceType.RequiredBayCapabilities.Except(bays.SelectMany(b => b.Capabilities)).ToArray(), ["missingCertifications"] = serviceType.RequiredCertifications.Except(technicians.SelectMany(t => t.Certifications)).ToArray() });

    var strategy = db.Database.CreateExecutionStrategy();
    var attempt = await strategy.ExecuteAsync(async ct2 =>
    {
        db.ChangeTracker.Clear();
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct2);
        var lockStarted = clock.GetTimestamp();
        using (SchedulerTelemetry.Source.StartActivity("scheduler.acquire_dealership_lock")) { await DealershipLock.AcquireAsync(db, dealership.Id, ct2); }
        SchedulerTelemetry.LockWait.Record(clock.GetElapsedTime(lockStarted).TotalMilliseconds, new KeyValuePair<string, object?>("dealership.id", dealership.Id));
        var busy = await db.Appointments.AsNoTracking()
            .Where(a => a.DealershipId == dealership.Id && Appointment.ActiveStatuses.Contains(a.Status) && a.Slot.StartUtc < slot.EndUtc && a.Slot.EndUtc > slot.StartUtc)
            .Select(a => new { a.BayId, a.TechnicianId }).ToListAsync(ct2);
        var busyBays = busy.Select(x => x.BayId).ToHashSet(); var busyTechs = busy.Select(x => x.TechnicianId).ToHashSet();
        var freeBays = compatibleBays.Where(b => !busyBays.Contains(b.Id)).ToList(); var freeTechs = certified.Where(t => !busyTechs.Contains(t.Id)).ToList();
        if (freeBays.Count == 0 || freeTechs.Count == 0) { await tx.RollbackAsync(ct2); return (BookingAttempt)new BookingAttempt.Unavailable(); }
        var load = await reader.LoadCountsAsync(dealership.Id, window, ct2);
        var bay = AllocationPolicy.ChooseBay(freeBays, serviceType, load, cmd.Request.PreferredBayId)!; var tech = AllocationPolicy.ChooseTechnician(freeTechs, serviceType, load, cmd.Request.PreferredTechnicianId)!;
        var appointment = Appointment.Book(Guid.CreateVersion7(), dealership, serviceType, bay, tech, slot, window, ToCustomer(cmd.Request.Customer), ToVehicle(cmd.Request.Vehicle), cmd.Request.Notes, clock.GetUtcNow().UtcDateTime);
        db.Appointments.Add(appointment);
        if (cmd.IdempotencyKey is not null)
        {
            var response = AppointmentResponseMapper.Map(appointment, zone, serviceType, bay, tech);
            db.IdempotencyKeys.Add(new IdempotencyKey { Key = cmd.IdempotencyKey, RequestFingerprint = IdempotencyFingerprint.Compute(dealership.Id, cmd.Request), ResponseStatus = 201, ResponseBody = JsonSerializer.Serialize(response, jsonOptions), ResourceId = appointment.Id, CreatedAtUtc = now, ExpiresAtUtc = now.AddHours(24) });
        }
        try { await db.SaveChangesAsync(ct2); }
        catch (DbUpdateException ex)
        {
            await tx.RollbackAsync(ct2);
            return PostgresErrorClassifier.Classify(ex) switch
            {
                PostgresFailure.BayOverlap => new BookingAttempt.Conflict("bay"),
                PostgresFailure.TechnicianOverlap => new BookingAttempt.Conflict("technician"),
                PostgresFailure.IdempotencyKeyDuplicate => new BookingAttempt.DuplicateKey(),
                PostgresFailure.Deadlock => RecordDeadlockAndConflict(),   // Deadlocks.Add(1); logger 1004; return Conflict("unknown")
                _ => throw,
            };
        }
        await tx.CommitAsync(ct2);
        return new BookingAttempt.Confirmed(appointment, bay, tech);
    }, ct);

    switch (attempt)
    {
        case BookingAttempt.Confirmed c: outcome = "confirmed"; return new(AppointmentResponseMapper.Map(c.Appointment, zone, serviceType, c.Bay, c.Technician), Replayed: false);
        case BookingAttempt.Unavailable: outcome = "slot_unavailable"; throw new SlotUnavailableException(await SuggestAsync(dealership, serviceType, window, slot, ct));
        case BookingAttempt.Conflict k: outcome = "slot_conflict"; SchedulerTelemetry.ConstraintBackstop.Add(1, new("constraint", k.Resource)); throw new SlotConflictException(k.Resource, await SuggestAsync(...));
        case BookingAttempt.DuplicateKey:
            var existing = await db.IdempotencyKeys.AsNoTracking().FirstAsync(k => k.Key == cmd.IdempotencyKey, ct);
            if (existing.RequestFingerprint != IdempotencyFingerprint.Compute(dealership.Id, cmd.Request)) { outcome = "idempotency_reuse"; throw new IdempotencyKeyReuseException(); }
            outcome = "replayed"; return new(JsonSerializer.Deserialize<AppointmentResponse>(existing.ResponseBody, jsonOptions)!, Replayed: true);
    }
}
catch (DomainRuleViolationException) { outcome = "rule_violation"; throw; }
catch (NotFoundException) { outcome = "not_found"; throw; }
finally
{
    activity?.SetTag("booking.outcome", outcome);
    SchedulerTelemetry.BookingRequests.Add(1, new("outcome", outcome), new("dealership.id", cmd.DealershipId));
    SchedulerTelemetry.BookingDuration.Record(clock.GetElapsedTime(started).TotalMilliseconds, new("outcome", outcome));
}
```
`SuggestAsync` = `reader.ReadAsync(activeOnly:true)` → `AvailabilityCalculator.Compute` → `Nearest(slots, slot.StartUtc, options.SuggestedSlotCount)` → map to `SuggestedSlot` with `LocalTimeConverter.FormatLocal`. Validation of the header happens in the endpoint before calling the handler.

- [ ] **Step 1: Failing tests** (`BookAppointmentTests`, using a dealership built by `TestData` with 2 compatible bays and 2 certified technicians unless stated):
  - `Books_and_returns_201_with_location_and_allocation` (status Confirmed; `Location` ends with the id; history row exists).
  - `Honours_preferred_bay_when_free`; `Ignores_preferred_bay_when_busy` (second booking same time picks the other bay).
  - `Prefers_bay_with_fewest_surplus_capabilities` (standard service → not the EV bay).
  - `Rejects_outside_operating_hours_422` (17:30Z on a 08:00–18:00 London day in October → 422 type outside-operating-hours, extension operatingWindow).
  - `Accepts_slot_ending_exactly_at_close` (17:00Z) **[Review Focus 1]**; `Rejects_one_minute_after_close_boundary` is covered by the 422 test with 17:15Z.
  - `Rejects_closed_day_422` (Sunday).
  - `Rejects_lead_time_422` (set `Scheduling:MinimumLeadTime` to `01:00:00` via `UseSetting` in a dedicated factory; start = now + 30 min).
  - `Rejects_beyond_horizon_422`; `Rejects_off_grid_start_422` (10:10Z).
  - `Rejects_no_qualified_resources_422_with_missing_lists` (EV service at a dealership without EV bay).
  - `Returns_409_slot_unavailable_with_suggestions_when_all_busy` (book both bays at 10:00, third request → 409, `suggestedSlots` non-empty and none overlapping 10:00–11:00).
  - `Returns_400_validation_for_bad_vin_and_email` (errors dictionary has `Vehicle.Vin` and `Customer.Email`).
  - `Returns_404_for_unknown_dealership_and_service_type`.
  - `Constraint_backstop_maps_to_409_slot_conflict_for_out_of_band_row` **[Review Focus 4]**: the handler's pre-check only inspects rows whose `dealership_id` equals the route dealership, so an out-of-band writer that references the same bay and technician under a *different* dealership id is invisible to the pre-check but still covered by the exclusion constraints. Create dealership B (any hours), then insert by raw SQL an active row with `dealership_id = B`, `bay_id = X`, `technician_id = Y` (X and Y belong to dealership A), `start_utc/end_utc` = 10:00Z–11:00Z, status `Confirmed`, plus required columns. Call the API for dealership A at 10:00Z with `PreferredBayId = X`. Expect `409` with `type == slot-conflict`, `conflictingResource` present, `suggestedSlots` present, `scheduler.booking.constraint_backstop` metric incremented by 1 (use `MetricsCollector` from Task 13 — move it into `Fixtures/` in this task), exactly zero new rows in `appointments` for dealership A, and zero orphaned history rows.
  - `Slot_conflict_exception_maps_to_409_problem`: the `SystemTest`-only endpoint `/api/v1/__throw?kind=conflict` throws `SlotConflictException("bay", [])` → `409` with the catalogue title and `traceId`.
  - `IdempotencyTests` **[Review Focus 5]**: `Same_key_same_body_replays_201_without_second_row` (two sequential POSTs; second has header `Idempotent-Replayed: true`, bodies equal, `Appointments.Count == 1`), `Same_key_different_body_422_idempotency_key_reuse`, `Invalid_key_format_400`, `Failed_booking_does_not_store_key` (409 then a different valid request with the same key succeeds).
  - `BookAppointmentValidatorTests` (unit): one `Theory` per rule.
- [ ] **Step 2–4:** FAIL → implement → PASS. Confirm with `dotnet build -warnaserror`.
- [ ] **Step 5: Commit** `feat(api): add BookAppointment slice with dealership lock, allocation, idempotency and suggestions`

### Task 11: GetAppointment and CancelAppointment slices

**Addendum B (OpenAPI/UI):** apply §B2 (tag `Appointments`; `<example>` on `Reason`).

**Addendum A (reflection/AOT):** apply §A2 (register `CancelAppointmentRequest`), §A3 (registry lines, explicit validator registration), §A5 (event 1010), reuse `AppointmentMapper` from Task 10.

**Files:** `Features/Appointments/GetAppointment/{GetAppointmentEndpoint,GetAppointmentHandler}.cs`; `Features/Appointments/CancelAppointment/{CancelAppointmentEndpoint,CancelAppointmentRequest,CancelAppointmentValidator,CancelAppointmentHandler}.cs`; tests `IntegrationTests/Api/AppointmentLifecycleTests.cs`.

**Interfaces (produced):**
```csharp
// GET  /appointments/{appointmentId:guid}          WithName("GetAppointment")    Produces<AppointmentResponse>(200) ProducesProblem(404)
// POST /appointments/{appointmentId:guid}/cancel   WithName("CancelAppointment") body CancelAppointmentRequest(string Reason /*1..500*/) Produces<AppointmentResponse>(200) 400 404 409
public sealed class CancelAppointmentHandler(SchedulerDbContext db, TimeProvider clock) { public Task<AppointmentResponse> HandleAsync(Guid appointmentId, string reason, CancellationToken ct); }
// Loads tracked appointment (404), dealership/service type/bay/technician for mapping, calls appointment.Cancel(reason, now), SaveChanges (DbUpdateConcurrencyException propagates -> 409 concurrency-conflict), returns mapped response.
```
- [ ] **Step 1: Failing tests**: `Get_returns_booked_appointment`, `Get_unknown_404`, `Cancel_sets_status_and_reason_and_writes_history`, `Cancel_twice_409_invalid_state_transition` (extensions `currentStatus: "Cancelled"`), `Cancelled_slot_can_be_rebooked_on_same_bay_and_technician` **[Review Focus 3]** (single-bay single-technician dealership: book → cancel → book same time → 201 and the DB now has one Cancelled + one Confirmed row), `Concurrent_cancel_second_writer_gets_409_concurrency_conflict` (two DbContext instances load the same row; first cancels via DbContext, second via API → 409 type concurrency-conflict), `Cancel_empty_reason_400`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** `feat(api): add GetAppointment and CancelAppointment slices with optimistic concurrency`

### Task 12: GetWorkshopSchedule slice

**Addendum B (OpenAPI/UI):** apply §B2 (tag `Schedule`).

**Addendum A (reflection/AOT):** apply §A6 (`Features/Schedule/Mapping/ScheduleMapper.cs` for bays, technicians and scheduled appointments), §A2 (register `WorkshopScheduleResponse` and nested records), §A3 (registry line).

**Files:** `Features/Schedule/GetWorkshopSchedule/{GetWorkshopScheduleEndpoint,GetWorkshopScheduleHandler,WorkshopScheduleResponse}.cs`; test `IntegrationTests/Api/ScheduleEndpointTests.cs`.

**Interfaces (produced):**
```csharp
public sealed record DealershipSummary(Guid Id, string Name, string TimeZoneId);
public sealed record ScheduledAppointmentResponse(Guid Id, DateTime StartUtc, DateTime EndUtc, string StartLocal, string EndLocal, AppointmentStatus Status, ServiceTypeSummary ServiceType, ResourceSummary Technician, string Vin, string Registration, string CustomerName);
public sealed record BayScheduleResponse(Guid Id, string Name, IReadOnlyList<BayCapability> Capabilities, bool IsActive, IReadOnlyList<ScheduledAppointmentResponse> Appointments);
public sealed record TechnicianResponse(Guid Id, string Name, string EmployeeNumber, IReadOnlyList<Certification> Certifications, bool IsActive);
public sealed record WorkshopScheduleResponse(DealershipSummary Dealership, DateOnly Date, OperatingWindowResponse? OperatingWindow, int SlotGranularityMinutes, IReadOnlyList<BayScheduleResponse> Bays, IReadOnlyList<TechnicianResponse> Technicians);
// GET /dealerships/{dealershipId:guid}/schedule?date=  WithName("GetWorkshopSchedule") 200 400 404; includes all non-Cancelled appointments overlapping the window (activeOnly:false minus Cancelled); bays ordered by Name; appointments by StartUtc; closed day -> OperatingWindow null and empty appointment lists.
```
- [ ] **Step 1: Failing tests**: `Schedule_groups_appointments_by_bay_with_technician_and_vehicle`, `Schedule_excludes_cancelled_but_includes_completed`, `Schedule_closed_day_has_null_window`, `Schedule_invalid_date_400`.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat(api): add workshop schedule read model`

### Task 13: Adversarial concurrency test

**Files:** `IntegrationTests/Concurrency/ConcurrentBookingTests.cs`, `IntegrationTests/Fixtures/MetricsCollector.cs`, `IntegrationTests/Fixtures/LogCollector.cs`.

**Interfaces (produced):** `MetricsCollector : IDisposable` wraps a `MeterListener` subscribed to `SchedulerTelemetry.Meter` and exposes `long Sum(string instrument, Func<KeyValuePair<string, object?>[], bool>? tagFilter = null)`. `LogCollector` is an `ILoggerProvider` registered via `ConfigureLogging` capturing `(EventId, Level, Message)`.

- [ ] **Step 1: Write the test**
```csharp
public sealed class ConcurrentBookingTests(PostgresFixture pg) : IAsyncLifetime
{
    private const int Contenders = 30;
    private SchedulerApiFactory _factory = null!; private MetricsCollector _metrics = null!; private LogCollector _logs = null!;
    public async ValueTask InitializeAsync() { _logs = new(); _metrics = new(); _factory = new SchedulerApiFactory(pg.ConnectionString, TestData.Clock(), _logs); await _factory.ResetAsync(); }
    public async ValueTask DisposeAsync() { _metrics.Dispose(); await _factory.DisposeAsync(); }

    [Theory, InlineData(1), InlineData(2), InlineData(3), InlineData(4), InlineData(5)]
    public async Task Exactly_one_of_thirty_simultaneous_bookings_succeeds(int round)
    {
        await _factory.ResetAsync();
        var (dealershipId, serviceTypeId, bayId, technicianId) = await _factory.WithDbAsync(TestData.ContentionDealershipAsync);
        var start = new DateTime(2026, 10, 13, 10, 0, 0, DateTimeKind.Utc);
        var gate = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var client = _factory.CreateClient();
        var requests = Enumerable.Range(0, Contenders).Select(async i =>
        {
            var body = TestData.BookingRequest(serviceTypeId, start, customerIndex: i);  // distinct customers + VINs
            await gate.Task;
            var response = await client.PostAsJsonAsync($"/api/v1/dealerships/{dealershipId}/appointments", body);
            return (Status: response.StatusCode, Problem: response.IsSuccessStatusCode ? null : await response.Content.ReadFromJsonAsync<ProblemDetails>(), Body: response.IsSuccessStatusCode ? await response.Content.ReadFromJsonAsync<AppointmentResponse>() : null);
        }).ToArray();
        gate.SetResult();
        var results = await Task.WhenAll(requests);

        results.Count(r => r.Status == HttpStatusCode.Created).ShouldBe(1, $"round {round}");
        results.Count(r => r.Status == HttpStatusCode.Conflict).ShouldBe(Contenders - 1);
        results.Count(r => (int)r.Status >= 500).ShouldBe(0);
        results.Where(r => r.Problem is not null).ShouldAllBe(r => r.Problem!.Type == ProblemTypes.SlotUnavailable || r.Problem.Type == ProblemTypes.SlotConflict);
        results.Where(r => r.Problem is not null).ShouldAllBe(r => r.Problem!.Extensions.ContainsKey("traceId") && r.Problem.Extensions.ContainsKey("suggestedSlots"));
        var winner = results.Single(r => r.Body is not null).Body!; winner.Bay.Id.ShouldBe(bayId); winner.Technician.Id.ShouldBe(technicianId);

        _metrics.Sum("scheduler.booking.deadlocks").ShouldBe(0);
        _metrics.Sum("scheduler.booking.constraint_backstop").ShouldBe(0);   // the lock makes the constraint a pure backstop
        _logs.Entries.ShouldNotContain(e => e.Level >= LogLevel.Error);
        _logs.Entries.ShouldNotContain(e => e.EventId.Id == 1004);

        await _factory.WithDbAsync(async db =>
        {
            var active = await db.Appointments.Where(a => a.DealershipId == dealershipId && Appointment.ActiveStatuses.Contains(a.Status)).ToListAsync();
            active.Count.ShouldBe(1); active[0].Id.ShouldBe(winner.Id);
            (await db.AppointmentHistory.CountAsync(h => h.AppointmentId == winner.Id)).ShouldBe(1);
            (await db.AppointmentHistory.Where(h => !db.Appointments.Any(a => a.Id == h.AppointmentId)).CountAsync()).ShouldBe(0);
            (await db.IdempotencyKeys.Where(k => k.ResourceId != null && !db.Appointments.Any(a => a.Id == k.ResourceId)).CountAsync()).ShouldBe(0);
            return 0;
        });
    }
}
```
Plus `Thirty_bookings_for_different_slots_all_succeed` (30 requests, each at a distinct start on a dealership with one bay/technician and a 15-minute service → 30 × 201, proving the lock serialises without rejecting legitimate work) and `Two_dealerships_do_not_contend` (lock wait histogram for dealership B stays below 50 ms while A is hammered — assert via `MetricsCollector` max with tag filter).
- [ ] **Step 2: Run** `dotnet test --project tests/Keyloop.ServiceScheduler.IntegrationTests --filter "FullyQualifiedName~Concurrency"` → PASS (5 rounds). If any round fails, this is a real design defect: do not loosen the assertion — investigate with the `scheduler.booking.lock_wait` histogram and PostgreSQL logs.
- [ ] **Step 3: Commit** `test: add adversarial 30-way concurrent booking proof with orphan and deadlock assertions`

### Task 14: OpenAPI contract export, AppHost orchestration, Dockerfile

**Addendum B (OpenAPI/UI):** apply §B1 wiring — build-time generation replaces the `UPDATE_CONTRACT` export described below; `scripts/export-openapi.sh` runs `dotnet build`; the contract test becomes the parity test described in §B1; the AppHost link opens `/scalar/v1`.

**Addendum A (reflection/AOT):** the contract test also asserts that `/openapi/v1.json` renders every enum as string values and every response schema is present (a type missing from `SchedulerJsonContext` surfaces here as a failing request). No other change.

**Files:** `IntegrationTests/Contract/OpenApiContractTests.cs`; `contracts/openapi/v1.json`; `scripts/export-openapi.sh`; `src/Keyloop.ServiceScheduler.AppHost/*` (`AppHost.cs`, csproj, `appsettings.json`, `Properties/launchSettings.json`); `src/Keyloop.ServiceScheduler.Api/Dockerfile`; modify `Keyloop.ServiceScheduler.sln`.

- [ ] **Step 1: Contract test**
```csharp
[Trait("Category", "Contract")]
public sealed class OpenApiContractTests(PostgresFixture pg)
{
    private static readonly string ContractPath = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../../contracts/openapi/v1.json"));
    [Fact]
    public async Task Served_document_matches_committed_contract()
    {
        await using var factory = new SchedulerApiFactory(pg.ConnectionString, TestData.Clock());
        var json = await factory.CreateClient().GetStringAsync("/openapi/v1.json");
        var normalised = JsonNode.Parse(json)!; normalised["servers"] = null;  // host-specific
        var pretty = normalised.ToJsonString(new JsonSerializerOptions { WriteIndented = true }) + "\n";
        if (Environment.GetEnvironmentVariable("UPDATE_CONTRACT") == "1") { await File.WriteAllTextAsync(ContractPath, pretty); }
        (await File.ReadAllTextAsync(ContractPath)).ShouldBe(pretty, "contract drift: run scripts/export-openapi.sh and commit contracts/openapi/v1.json");
        foreach (var op in new[] { "GetDealerships", "GetServiceTypes", "GetAvailability", "BookAppointment", "GetAppointment", "CancelAppointment", "GetWorkshopSchedule" })
            json.ShouldContain($"\"operationId\": \"{op}\"");
    }
}
```
`scripts/export-openapi.sh`: `UPDATE_CONTRACT=1 dotnet test --project tests/Keyloop.ServiceScheduler.IntegrationTests --filter "Category=Contract"` then `git status --short contracts/`. Run it once to create the file; verify the document contains `components.schemas.ProblemDetails`, every `409`/`422` response referencing it, and `AppointmentStatus` as a string enum.
- [ ] **Step 2: AppHost**
```bash
dotnet new aspire-apphost -n Keyloop.ServiceScheduler.AppHost -o src/Keyloop.ServiceScheduler.AppHost
dotnet sln add src/Keyloop.ServiceScheduler.AppHost
```
csproj: `<Project Sdk="Aspire.AppHost.Sdk/13.6.1">`, `OutputType Exe`, `UserSecretsId`, references to `Aspire.Hosting.PostgreSQL` and `Aspire.Hosting.JavaScript` (no versions), `ProjectReference` to the Api with `AspireProjectMetadataTypeName="Keyloop_ServiceScheduler_Api"` default. `AppHost.cs`:
```csharp
var builder = DistributedApplication.CreateBuilder(args);

var postgres = builder.AddPostgres("postgres")
    .WithImageTag("17")
    .WithDataVolume("keyloop-scheduler-pgdata")
    .WithLifetime(ContainerLifetime.Persistent);
if (builder.ExecutionContext.IsRunMode)
{
    postgres.WithPgWeb();
}
var db = postgres.AddDatabase("schedulerdb");

var api = builder.AddProject<Projects.Keyloop_ServiceScheduler_Api>("api")
    .WithReference(db)
    .WaitFor(db)
    .WithHttpHealthCheck("/health")
    .WithUrlForEndpoint("https", url => { url.DisplayText = "Scalar API reference"; url.Url += "/scalar/v1"; });

builder.AddViteApp("web", "../Keyloop.ServiceScheduler.Web")
    .WithPnpm()
    .WithReference(api)
    .WaitFor(api)
    .WithEnvironment("VITE_API_PROXY_TARGET", api.GetEndpoint("http"))
    .WithExternalHttpEndpoints();

builder.Build().Run();
```
If `WithUrlForEndpoint` has a different shape in 13.6.1, use `WithUrls(ctx => ctx.Urls.Add(new() { Url = ..., DisplayText = "Scalar" }))` — check `aspire` docs; the goal is a dashboard link to Scalar. Until Task 15 creates the Web project, guard the `AddViteApp` block with `if (Directory.Exists(Path.Combine(builder.AppHostDirectory, "../Keyloop.ServiceScheduler.Web")))` and remove the guard in Task 15.
- [ ] **Step 3: Dockerfile** (API): multi-stage `mcr.microsoft.com/dotnet/sdk:10.0` build with `dotnet publish -c Release -o /app`, runtime `mcr.microsoft.com/dotnet/aspnet:10.0`, `USER app`, `ENV ASPNETCORE_HTTP_PORTS=8080`, `EXPOSE 8080`, `HEALTHCHECK CMD curl -f http://localhost:8080/alive || exit 1` (install curl or use `dotnet` based check), `ENTRYPOINT ["dotnet", "Keyloop.ServiceScheduler.Api.dll"]`. Verify `docker build -f src/Keyloop.ServiceScheduler.Api/Dockerfile .` succeeds.
- [ ] **Step 4: Run the stack** `dotnet run --project src/Keyloop.ServiceScheduler.AppHost` (Colima running) in the background; wait until the dashboard reports `postgres` and `api` healthy; `curl -k https://localhost:<api-port>/api/v1/dealerships` returns two dealerships; `curl .../schedule?date=<tomorrow>` shows seeded appointments. Stop the AppHost.
- [ ] **Step 5: Commit** `feat(aspire): add AppHost orchestration, API Dockerfile and exported OpenAPI contract`

---

## Phase 4 — Dispatch board (UI harness)

### Task 15: Web project scaffold from the template, HeyAPI contract sync, app shell

**Addendum B (OpenAPI/UI):** load the `frontend-design:frontend-design` skill first; apply §B4 (status tokens in `src/index.css` for both themes, typography, shell with sidebar footer "API reference" link to `/scalar/v1`, Keyloop wordmark as text only — no third-party logos).

**Files:** `src/Keyloop.ServiceScheduler.Web/{package.json,pnpm-lock.yaml,vite.config.ts,tsconfig*.json,components.json,eslint.config.js,index.html,openapi-ts.config.ts,vitest.config.ts,.gitignore}`; `src/{main.tsx,App.tsx,index.css,vite-env.d.ts}`; `src/api/{client.gen.ts,sdk.gen.ts,types.gen.ts,@tanstack/react-query.gen.ts}` (generated), `src/api/runtime.ts`; `src/lib/{utils.ts,query-client.ts}`; vendored `src/components/ui/*` (only those used: button, badge, card, dialog, sheet, select, input, label, field, textarea, tooltip, skeleton, toast, separator, scroll-area, sidebar, avatar, alert, tabs, kbd, dropdown-menu, loading-spinner, popover, calendar), `src/components/{app-sidebar,site-header,logo,mode-toggle,theme-provider,nav-main,nav-user}.tsx`, `src/components/layouts/base-layout.tsx`, `src/components/router/root-layout.tsx`, `src/hooks/use-mobile.ts`, `src/config/routes.tsx`, `src/app/dispatch/page.tsx` (placeholder page reading `GET /dealerships`); modify AppHost (remove the directory guard).

- [ ] **Step 1: Scaffold** — copy from `../references/shadcn-dashboard-landing-template/vite-version`: `package.json` (rename to `keyloop-service-scheduler-web`, keep dependency versions, **remove** `@dnd-kit/*`, `@tanstack/react-table`, `recharts`, `react-day-picker` if unused, `cmdk`, `react-resizable-panels`; **add** `@tanstack/react-query@^5.104.1`; devDependencies add `@hey-api/openapi-ts@^0.99.0`, `vitest@^5.0.3`, `jsdom@^26`, `@testing-library/react@^16.3.3`, `@testing-library/jest-dom@^6`), `vite.config.ts`, `tsconfig*.json`, `components.json`, `eslint.config.js`, `.prettierrc`, `index.html`, `src/index.css` (keep the theme tokens), `src/lib/utils.ts`, `src/hooks/use-mobile.ts`, the ui components listed above, the shell components, `router/root-layout.tsx`. Remove theme-customizer, landing, auth, mail, chat, tasks, users, pricing, faqs, dashboard pages and the `upgrade-to-pro-button`, GTM analytics and `sidebar-notification`. `app-sidebar.tsx` nav: group "Workshop" → `Dispatch Board` (`/dispatch`, icon `CalendarRange`), `Appointments` (`/appointments`, icon `ClipboardList`, placeholder page). Brand block: "Keyloop" / "Service Scheduler".
- [ ] **Step 2: Vite config**
```ts
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const apiTarget = process.env.VITE_API_PROXY_TARGET ?? "http://localhost:5180"
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  server: {
    host: true,
    port: Number(process.env.PORT) || 5173,
    strictPort: !!process.env.PORT,
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true },
      "/openapi": { target: apiTarget, changeOrigin: true },
      "/scalar": { target: apiTarget, changeOrigin: true },
    },
  },
  test: { environment: "jsdom", globals: true, setupFiles: ["./src/test-setup.ts"] },
})
```
- [ ] **Step 3: HeyAPI** — `openapi-ts.config.ts`:
```ts
import { defineConfig } from "@hey-api/openapi-ts"
export default defineConfig({
  input: "../../contracts/openapi/v1.json",
  output: { path: "src/api", lint: false, format: false },
  plugins: [
    "@hey-api/typescript",
    "@hey-api/sdk",
    { name: "@hey-api/client-fetch", runtimeConfigPath: "./src/api/runtime.ts" },
    { name: "@tanstack/react-query", queryOptions: true, mutationOptions: true, queryKeys: true },
  ],
})
```
Confirm the exact plugin option names against the HeyAPI 0.99 docs (Context7 `/websites/heyapi_dev`) before running; adjust if the schema differs. `src/api/runtime.ts`:
```ts
import type { CreateClientConfig } from "./client.gen"
export const createClientConfig: CreateClientConfig = (config) => ({
  ...config,
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? "",
  headers: { "X-Request-Id": crypto.randomUUID() },
})
```
`package.json` scripts: `"generate:api": "openapi-ts"`, `"dev": "vite"`, `"build": "pnpm generate:api && tsc -b && vite build"`, `"lint": "eslint ."`, `"typecheck": "tsc -b --noEmit"`, `"test": "vitest run"`, `"preview": "vite preview"`. Run `pnpm install && pnpm generate:api` and confirm `src/api/@tanstack/react-query.gen.ts` exports `getDealershipsOptions`, `getWorkshopScheduleOptions`, `getAvailabilityOptions`, `bookAppointmentMutation`, `cancelAppointmentMutation` (names derive from the operationIds; record the real names in the task notes for Tasks 16–17).
- [ ] **Step 4: App shell** — `App.tsx` wraps `QueryClientProvider` (from `lib/query-client.ts`: `defaultOptions.queries.staleTime = 2000, retry = 1; mutations.retry = 0`) + `ThemeProvider` + `Toaster` + router; routes `/` → `/dispatch`, `/dispatch`, `/appointments`. `app/dispatch/page.tsx` renders `BaseLayout` title "Dispatch Board" and a dealership `Select` fed by `useQuery(getDealershipsOptions())`.
- [ ] **Step 5: Verify** `pnpm lint && pnpm typecheck && pnpm build` pass; `dotnet run --project src/Keyloop.ServiceScheduler.AppHost` shows `web` healthy and the page lists both dealerships through the proxy. Remove the directory guard in `AppHost.cs`.
- [ ] **Step 6: Commit** `feat(web): scaffold dispatch board shell from template with HeyAPI contract sync`

### Task 16: Timeline board, appointment blocks, technician lanes, details sheet with cancel

**Addendum B (OpenAPI/UI):** load the `frontend-design:frontend-design` skill first; apply §B4 (KPI strip, timeline grid details, block design, legend, loading/empty/error states, accessibility, responsiveness).

**Files:** `src/app/dispatch/{page.tsx}`; `src/app/dispatch/components/{dispatch-toolbar,timeline-grid,appointment-block,appointment-sheet,capability-badges,status-legend}.tsx`; `src/app/dispatch/lib/{time-grid.ts,status.ts}`; `src/lib/problem-details.ts`; tests `src/app/dispatch/lib/time-grid.test.ts`, `src/lib/problem-details.test.ts`.

**Interfaces (produced):**
```ts
// time-grid.ts
export interface GridSpec { startUtc: Date; endUtc: Date; granularityMinutes: number; columns: number }
export function buildGrid(window: { startUtc: string; endUtc: string }, granularityMinutes: number): GridSpec
export function columnFor(instantUtc: string, grid: GridSpec): number            // 1-based grid column index, clamped to [1, columns+1]
export function spanFor(startUtc: string, endUtc: string, grid: GridSpec): { start: number; end: number }
export function formatLocalTime(iso: string, timeZone: string): string             // Intl.DateTimeFormat HH:mm in dealership zone
// problem-details.ts
export interface ProblemDetails { type?: string; title?: string; status?: number; detail?: string; instance?: string; traceId?: string; errors?: Record<string, string[]>; suggestedSlots?: Array<{ startUtc: string; endUtc: string; startLocal: string }>; [k: string]: unknown }
export function parseProblem(error: unknown): ProblemDetails | null             // HeyAPI errors carry `error` bodies; returns null for non-problem shapes
export function problemSlug(p: ProblemDetails): string                            // last path segment of type
export function fieldErrors(p: ProblemDetails): Record<string, string>            // "Vehicle.Vin" -> "vehicle.vin"
```
- [ ] **Step 1: Failing vitest tests** — `time-grid.test.ts`: `buildGrid_for_10h_window_at_15m_has_40_columns`, `columnFor_start_is_1`, `spanFor_09_00_10_00_in_08_00_window_is_5_to_9`, `clamps_instants_outside_window`, `formatLocalTime_uses_zone` (`2026-10-13T09:00:00Z` in `Europe/London` → `10:00`), `fall_back_day_window_has_44_columns` (2026-10-25 07:00Z–17:00Z is 10h... use a real 11-hour UTC window). `problem-details.test.ts`: `parses_hey_api_error_shape`, `slug_from_type`, `fieldErrors_lowercases_paths`.
- [ ] **Step 2: Run** `pnpm test` → FAIL. **Step 3: Implement** the libs, then the components:
  - `DispatchToolbar`: dealership `Select`, date `Popover`+`Calendar` (default today in dealership zone), `Book appointment` button (opens dialog, Task 17), auto-refresh `Switch` (5 s `refetchInterval` when on), lane toggle (`Bays` / `Technicians`) using `Tabs`.
  - `TimelineGrid`: CSS grid `grid-template-columns: 220px repeat(${columns}, minmax(28px, 1fr))`; header row of local times (every 4th column labelled); one row per bay (sticky first cell with name + `CapabilityBadges`, inactive bays muted); appointment blocks positioned with `gridColumn: start / end`, `gridRow` = row index; a "now" vertical marker when the date is today; closed day → empty state card.
  - `AppointmentBlock`: status-coloured (Confirmed `bg-primary/15 border-primary`, CheckedIn `info`, InProgress `warning`, Completed `success/20 muted`, NoShow `destructive/15`), shows service name, mono VIN, technician `Avatar` initials + name badge; `Tooltip` with full details; `onClick` opens `AppointmentSheet`.
  - `AppointmentSheet` (Sheet): all fields, history-free (history is server-side only), `Cancel appointment` form (reason `Textarea`) → `useMutation(cancelAppointmentMutation())`; on success `toast.success` and invalidate the schedule query; on 409 shows the problem title/detail + `traceId` in an `Alert`.
  - Technician lane mode reuses `TimelineGrid` with rows = technicians and blocks filtered by `technician.id`.
  - Query: `useQuery({ ...getWorkshopScheduleOptions({ path: { dealershipId }, query: { date } }), refetchInterval: autoRefresh ? 5000 : false, refetchOnWindowFocus: true })`.
- [ ] **Step 4: Run** `pnpm test && pnpm lint && pnpm typecheck && pnpm build` → PASS; manual check in the AppHost run: seeded appointments render in the correct columns; cancelling one removes it on the next refetch.
- [ ] **Step 5: Commit** `feat(web): add workshop timeline board with bay and technician lanes and cancellation sheet`

### Task 17: Booking dialog with availability chips, conflict surfacing, and stress panel

**Addendum B (OpenAPI/UI):** load the `frontend-design:frontend-design` skill first; apply §B4 (two-step dialog with stepper, grouped slot chips with capacity, success toast with *View on board*, conflict/422/400 UX, stress panel tiles/bar/latency table).

**Files:** `src/app/dispatch/components/{booking-dialog,availability-chips,stress-panel}.tsx`; `src/app/dispatch/lib/{booking-schema.ts,stress.ts}`; tests `src/app/dispatch/lib/stress.test.ts`, `src/app/dispatch/lib/booking-schema.test.ts`.

**Interfaces (produced):**
```ts
// booking-schema.ts (zod 4)
export const bookingSchema = z.object({ serviceTypeId: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), startUtc: z.string().min(1, "Pick a start time"),
  customer: z.object({ name: z.string().trim().min(1).max(120), email: z.string().trim().email().max(254), phone: z.string().trim().min(3).max(40).regex(/^[+0-9 ()-]+$/) }),
  vehicle: z.object({ vin: z.string().trim().toUpperCase().regex(/^[A-HJ-NPR-Z0-9]{17}$/, "VIN must be 17 characters (no I, O, Q)"), registration: z.string().trim().min(1).max(16), make: z.string().trim().min(1).max(60), model: z.string().trim().min(1).max(60) }),
  preferredBayId: z.string().uuid().optional(), preferredTechnicianId: z.string().uuid().optional(), notes: z.string().max(1000).optional() })
export type BookingForm = z.infer<typeof bookingSchema>
// stress.ts
export type StressOutcome = { index: number; status: number; slug: string | null; traceId: string | null; durationMs: number }
export function tally(outcomes: StressOutcome[]): Array<{ label: string; count: number }>   // e.g. "201 Created" 1, "409 slot-unavailable" 29, "5xx" 0 (always present)
export async function fireParallelBookings(n: number, build: (i: number) => BookingForm, dealershipId: string): Promise<StressOutcome[]>  // uses the generated sdk `bookAppointment` directly, Promise.all, distinct VIN/customer per i
```
- [ ] **Step 1: Failing tests** — `stress.test.ts`: `tally_counts_by_status_and_slug`, `tally_always_includes_5xx_row`. `booking-schema.test.ts`: `rejects_vin_with_I`, `uppercases_vin`, `requires_start`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**:
  - `BookingDialog` (Dialog, `react-hook-form` + `zodResolver(bookingSchema)`): step 1 service `Select` (shows duration, required capabilities/certifications as badges, disabled when `bookable=false` with reason); date picker; `AvailabilityChips` = `useQuery(getAvailabilityOptions({ path: { dealershipId }, query: { serviceTypeId, date } }))` rendering a chip per slot (`startLocal` + "N bays · M techs"), empty state uses `unavailableReason`; step 2 customer + vehicle fields using `Field`/`Input`; optional preferred bay/technician selects from the schedule's resources; submit → `useMutation(bookAppointmentMutation())`.
  - Success: close dialog, `toast.success("Booked Bay 4 · Ben Okafor at 10:00")`, invalidate schedule + availability, pass the new id to the board which pulses the block (`animate-pulse` for 3 s).
  - `409`: `Alert` with title/detail/`traceId`; `suggestedSlots` rendered as chips that set `startUtc` and re-submit on click. `422`: `Alert` with title/detail (+ `missingCapabilities` list when present). `400`: `fieldErrors` mapped via `form.setError`. Network/5xx: generic destructive toast with status.
  - `StressPanel` (Card): N input (default 30), slot picker (reuses `AvailabilityChips`), "Fire N parallel bookings" button → `fireParallelBookings`; live tally table from `tally`, a results list with status, slug, duration and `traceId` (copy button); after completion invalidates the schedule so the single winner appears on the board.
- [ ] **Step 4: Verify** `pnpm test && pnpm lint && pnpm typecheck && pnpm build`; in the running AppHost: book through the dialog (allocation shown), provoke a 409 by booking the only EV bay twice, run the stress panel with 30 → tally shows 1 × 201 and 29 × 409.
- [ ] **Step 5: Commit** `feat(web): add booking dialog with availability chips, conflict surfacing and concurrency stress panel`

---

### Task 17b: Visual QA in Chrome (controller-run)

Apply Addendum B §B5 exactly: the controller drives the running app with the `claude-in-chrome` tools, captures the screenshots and GIFs into `docs/media/`, checks console and network logs, scores every screen against §B4, records findings in the ledger, dispatches ONE implementer (Opus, `frontend-design` skill) for Blocker/Major findings, and re-validates the changed screens. Commit `docs/media/*` with `docs: add dispatch board screenshots and demo recordings`.

## Phase 5 — CI, documentation, final verification

### Task 18: CI workflow, README, video guide, CLAUDE.md, final gate

**Addendum B (OpenAPI/UI):** CI runs `dotnet build` and then `git diff --exit-code contracts/`; README embeds `docs/media/*` screenshots and GIFs and documents Scalar (`/scalar/v1`, prefilled test requests).

**Addendum A (reflection/AOT):** apply §A8 (`scripts/aot-readiness.sh`, non-blocking CI step uploading its output, README section "Runtime reflection budget" listing generated vs explicit vs residual items and the compiled-model command with its drift caveat). CI coverage uses `dotnet test --coverage` (Microsoft.Testing.Platform), not `--collect:"XPlat Code Coverage"`.

**Files:** `.github/workflows/ci.yml`; `README.md`; `docs/VIDEO_WALKTHROUGH.md`; `CLAUDE.md` (update); `.github/dependabot.yml`.

- [ ] **Step 1: CI** — `ci.yml` with jobs `backend` (ubuntu-latest: `actions/setup-dotnet@v4` 10.0.x, `dotnet restore`, `dotnet build -c Release -warnaserror --no-restore`, `dotnet test -c Release --no-build --collect:"XPlat Code Coverage"` with Docker available for Testcontainers, `dotnet list package --vulnerable --include-transitive` failing on findings) and `frontend` (`pnpm/action-setup@v4` + `actions/setup-node@v4` 22, `pnpm install --frozen-lockfile`, `pnpm generate:api`, `git diff --exit-code src/Keyloop.ServiceScheduler.Web/src/api`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`). Upload `TestResults/**` as artefacts. `dependabot.yml` for nuget, npm and github-actions weekly.
- [ ] **Step 2: README.md** sections, in this order: title + one-paragraph pitch; **Prerequisites** (.NET SDK 10.0.100, Docker runtime — note Colima on macOS: `colima start`, Node 22 + pnpm 12, Aspire workload none required / `aspire` CLI optional); **Run everything** (`dotnet run --project src/Keyloop.ServiceScheduler.AppHost` → dashboard URL, web URL, Scalar link; what the seed contains; environments table pointer); **Run the tests** (unit: `dotnet test --project tests/Keyloop.ServiceScheduler.UnitTests`; integration: `dotnet test --project tests/Keyloop.ServiceScheduler.IntegrationTests`; concurrency only: `--filter "FullyQualifiedName~Concurrency"`; contract export script; frontend `pnpm test`); **Try it with curl** (book, book again → 409 with suggestions, cancel, availability); **Project layout**; **Design** (link to `docs/SYSTEM_DESIGN.md`, 10-line summary of the concurrency model); **Environments & configuration** (table from spec §10); **Observability** (what to open in the dashboard); **AI Collaboration Narrative** — written by the author from the session record: strategy (design-first with Fable 5.1, implementation by Opus subagents from a written plan, review by Fable), prompts used (link to `docs/superpowers/plans/...`), verification (tests, mermaid validation, warnings-as-errors, manual AppHost run), defects caught during review (fill with the real list gathered during execution), what was rejected and why; **Video** (link to `docs/VIDEO_WALKTHROUGH.md`); **Licence/attribution** (template MIT).
- [ ] **Step 3: `docs/VIDEO_WALKTHROUGH.md`** — 5–10 minute outline with timings: 0:00 intro + scenario (0:45); 0:45 architecture (C4 container, slices, DB invariant) (2:00); 2:45 implementation highlights (exclusion constraint migration, lock transaction, availability calculator, problem catalogue) (2:00); 4:45 live demo (board, book, 409 with suggestions, cancel + rebook, stress panel 30-way, dashboard trace + metrics) (2:30); 7:15 adversarial test run in terminal (0:45); 8:00 AI collaboration story (1:30); 9:30 lessons + challenges (0:30). Include the exact commands and clicks per segment and a pre-flight checklist (Colima up, AppHost warm, data seeded for today, dashboard open).
- [ ] **Step 4: CLAUDE.md** — update the commands and architecture summary to match what shipped (keep it short; link to the design and plan).
- [ ] **Step 5: Final gate** — from a clean clone (`git clone` into a temp dir): `dotnet build -warnaserror` (0 warnings), `dotnet test` (all green, concurrency 5/5), `pnpm install --frozen-lockfile && pnpm generate:api && git diff --exit-code && pnpm lint && pnpm typecheck && pnpm test && pnpm build`, `dotnet run --project src/Keyloop.ServiceScheduler.AppHost` reaches healthy and the board renders. Record the real numbers (test counts, durations) in the README.
- [ ] **Step 6: Commit** `docs: add README with AI collaboration narrative, video guide, CI workflow`

---

## Self-review (completed by the plan author)

- **Spec coverage:** §5 domain → Tasks 2–5; §6 availability/allocation → Task 5, 9, 10; §7 concurrency (constraints, lock, READ COMMITTED, classifier, idempotency, xmin) → Tasks 6, 10, 11, 13; §8 architecture/API/data model → Tasks 6–12, 14; §9 technology → Task 1; §10 environments → Task 7 appsettings + Task 14 AppHost + README; §11 security → Task 7; §12 observability → Tasks 7, 10, 13; §13 reliability → execution strategy in Task 10, Dockerfile Task 14; §14 testing → every task + Task 13/14; §15 UI → Tasks 15–17; §16/README narrative → Task 18. Gap check: the "lock-disabled informational variant" from spec §14.4 is intentionally **not** planned as a gating test (it would require a test-only switch in product code); the README documents the design reasoning instead.
- **Placeholder scan:** no TBD/TODO; every code step has code or exact signatures.
- **Type consistency:** `TimeSlot`, `OperatingWindow`, `ResourceBusy`, `AvailabilitySlot`, `BookingAttempt`, `AppointmentResponse`, `ProblemTypes`, `SchedulerTelemetry` names are identical across tasks; operationIds match between Task 7 list, Task 14 contract test and Task 15 generated hooks.
- **Review Focus:** each of the five items names its owning task and test.
