# Addendum A — Runtime reflection reduction and NativeAOT readiness

Applies to Tasks 6–12, 14 and 18 of `2026-10-11-keyloop-service-scheduler.md`. The design authority is `docs/SYSTEM_DESIGN.md` §9.1 and ADR-016. Each affected task's brief points at the numbered sections below; implementers apply only the sections their task names.

**Goal.** Remove runtime reflection and runtime code generation from the paths we own, prefer build-time source generation, and keep the API on the NativeAOT-compatible subset of the framework — *without* turning on `PublishAot` yet. The remaining reflection budget is explicit and measured (§A8).

**Non-goals / rulings.** No mediator library is introduced (there is none to replace; endpoints call handlers directly). The DI container stays `Microsoft.Extensions.DependencyInjection` (NativeAOT-compatible; its constructor discovery runs once at startup); assembly scanning of any kind is forbidden. FluentValidation stays because the brief mandates it, but validators are registered explicitly. EF Core compiled models are **not** generated in this iteration (silent-drift hazard, negligible gain for a 7-entity model) — the command and caveat are documented in the README.

---

## A1. Project-level switches (Task 7, API csproj)

Add to `src/Keyloop.ServiceScheduler.Api/Keyloop.ServiceScheduler.Api.csproj` `<PropertyGroup>`:

```xml
<EnableRequestDelegateGenerator>true</EnableRequestDelegateGenerator>
<EnableConfigurationBindingGenerator>true</EnableConfigurationBindingGenerator>
<JsonSerializerIsReflectionEnabledByDefault>false</JsonSerializerIsReflectionEnabledByDefault>
<InterceptorsNamespaces>$(InterceptorsNamespaces);Microsoft.AspNetCore.Http.Generated</InterceptorsNamespaces>
```

- The Request Delegate Generator (RDG) compiles every `MapGet/MapPost(...)` lambda or method group into a static request delegate at build time. If it cannot intercept a call it emits an `RDG0xx` diagnostic; with warnings-as-errors that is a build failure, which is intended: fix the endpoint shape (keep handlers as inline lambdas or method groups with concrete parameter types; avoid `Delegate`-typed variables).
- `JsonSerializerIsReflectionEnabledByDefault=false` makes any type missing from the JSON context fail fast (`NotSupportedException`) — the integration suite exercises every endpoint, so omissions surface in tests, not production.
- Add `Riok.Mapperly` to `Directory.Packages.props` (`<PackageVersion Include="Riok.Mapperly" Version="4.3.1" />`) and reference it from the API csproj with `PrivateAssets="all"` and `ExcludeAssets="runtime"` (it is a compile-time generator only).

## A2. JSON source generation (Task 6 creates, later tasks extend)

Create `Common/Serialization/SchedulerJsonContext.cs`:

```csharp
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Keyloop.ServiceScheduler.Api.Common.Serialization;

[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    UseStringEnumConverter = true,
    WriteIndented = false)]
// Task 6: audit payloads
[JsonSerializable(typeof(AppointmentBooked))]
[JsonSerializable(typeof(AppointmentCancelled))]
[JsonSerializable(typeof(AppointmentCheckedIn))]
[JsonSerializable(typeof(AppointmentStarted))]
[JsonSerializable(typeof(AppointmentCompleted))]
[JsonSerializable(typeof(AppointmentNoShow))]
// Task 7+: every request, response and extension payload type, including top-level collections, e.g.
// [JsonSerializable(typeof(IReadOnlyList<DealershipResponse>))]
internal sealed partial class SchedulerJsonContext : JsonSerializerContext;
```

Rules:
- Every DTO that crosses the HTTP boundary (requests, responses, top-level `IReadOnlyList<T>` responses, ProblemDetails extension objects such as the `operatingWindow` anonymous object — replace anonymous objects with small named records so they can be registered) is listed with `[JsonSerializable]`. Nested records are discovered automatically; top-level collection types are not.
- `Program.cs` registers the context first in the resolver chain: `builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.TypeInfoResolverChain.Insert(0, SchedulerJsonContext.Default));`. Do not add the reflection-based `JsonStringEnumConverter` — enum-as-string comes from `UseStringEnumConverter` (the generic, AOT-safe converter).
- Any explicit `JsonSerializer.Serialize/Deserialize` call in product code (idempotency bodies in Task 10, audit payloads in Task 6) uses the context overloads: `JsonSerializer.Serialize(value, SchedulerJsonContext.Default.AppointmentResponse)`.
- ASP.NET Core's own `ProblemDetails` context remains in the chain (added by `AddProblemDetails`); do not replace the chain, insert into it.

## A3. Endpoint registration without reflection (Task 7)

Replace reflection-based discovery with an explicit registry:

```csharp
public static class EndpointRegistry
{
    public static IEndpointRouteBuilder MapSchedulerEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/v1").WithGroupName("v1");
        GetDealershipsEndpoint.Map(group);
        GetServiceTypesEndpoint.Map(group);
        GetAvailabilityEndpoint.Map(group);
        BookAppointmentEndpoint.Map(group);
        GetAppointmentEndpoint.Map(group);
        CancelAppointmentEndpoint.Map(group);
        GetWorkshopScheduleEndpoint.Map(group);
        return app;
    }
}
```

`IEndpoint` with `static abstract void Map(...)` may remain as the shape contract; each slice task adds its own line to the registry (Tasks 8–12). Handlers and validators are registered explicitly in `Program.cs` (`AddScoped<BookAppointmentHandler>()`, `AddScoped<IValidator<BookAppointmentRequest>, BookAppointmentValidator>()`); `AddValidatorsFromAssemblyContaining` is **not** used.

## A4. Options: configuration-binding generator and source-generated validation (Task 7)

- With `EnableConfigurationBindingGenerator`, `BindConfiguration(...)`/`Get<T>()` calls are intercepted at build time; keep using them.
- Replace `ValidateDataAnnotations()` with source-generated validators:

```csharp
[OptionsValidator]
public sealed partial class SchedulingOptionsValidator : IValidateOptions<SchedulingOptions>;
```

and register `builder.Services.AddSingleton<IValidateOptions<SchedulingOptions>, SchedulingOptionsValidator>();` followed by `.ValidateOnStart()` on the options builder. Keep the `[Range]`/`[Required]` attributes on the options classes (the generator reads them). Do the same for `SecurityOptions` and `DatabaseOptions` (a validator with no attributes is still fine).

## A5. Logging (Tasks 6, 7, 10, 11)

All product-code log statements use `[LoggerMessage]` source-generated methods in a `static partial class` per area (`Common/Telemetry/SchedulerLog.cs`) with the stable event ids from the plan (1001 BookingConfirmed, 1002 BookingRejected, 1003 ConstraintBackstopFired, 1004 DeadlockDetected, 1010 AppointmentCancelled, 1100 MigrationsApplied, 1101 SeedCompleted). No interpolated `logger.LogInformation($"...")` calls.

## A6. Mapping with Mapperly (Tasks 8–12)

- One static partial mapper per feature family under `Features/<Family>/Mapping/` (e.g. `Features/Appointments/Mapping/AppointmentMapper.cs`), decorated `[Mapper(EnumMappingStrategy = EnumMappingStrategy.ByName, RequiredMappingStrategy = RequiredMappingStrategy.Target)]` so an unmapped target member is a build error.
- Value objects map through user-implemented methods inside the mapper (Mapperly picks them up by signature): `private static string MapVin(Vin vin) => vin.Value;`, `private static int MapDuration(ServiceDuration d) => d.Minutes;`, `private static string FormatTime(TimeOnly? t) => t?.ToString("HH:mm", CultureInfo.InvariantCulture) ?? ...`.
- Composite responses that need data from several aggregates use Mapperly's additional-parameter mappings (parameters are matched to target members by name), e.g.

```csharp
[Mapper(RequiredMappingStrategy = RequiredMappingStrategy.Target)]
public static partial class AppointmentMapper
{
    public static partial AppointmentResponse ToResponse(Appointment appointment, ServiceTypeSummary serviceType, ResourceSummary bay, ResourceSummary technician, string startLocal, string endLocal);
    [MapProperty(nameof(Appointment.Slot.StartUtc), nameof(AppointmentResponse.StartUtc))]
    [MapProperty(nameof(Appointment.Slot.EndUtc), nameof(AppointmentResponse.EndUtc))]
    private static partial AppointmentResponse Map(Appointment appointment); // helper if flattening is needed
    public static partial CustomerResponse ToResponse(CustomerDetails customer);
    public static partial VehicleResponse ToResponse(VehicleDetails vehicle);
    public static partial ServiceTypeSummary ToSummary(ServiceType serviceType);
    public static partial ResourceSummary ToSummary(ServiceBay bay);
    public static partial ResourceSummary ToSummary(Technician technician);
    private static string MapVin(Vin vin) => vin.Value;
    private static int MapDuration(ServiceDuration duration) => duration.Minutes;
}
```

  The thin `AppointmentResponseMapper.Map(appointment, zone, serviceType, bay, technician)` from the plan becomes a two-line wrapper that computes `startLocal`/`endLocal` with `LocalTimeConverter.FormatLocal` and calls `AppointmentMapper.ToResponse(...)`. Verify the exact attribute/feature names against the Mapperly 4.3 docs (Context7 `/websites/mapperly_riok_app`) before relying on them; if additional-parameter mapping is unavailable in 4.3.1, build the composite with an object initializer that calls the Mapperly part-mappers — never hand-copy nested members.
- Mapperly diagnostics (`RMG0xx`) are warnings → errors; resolve them by explicit `[MapperIgnoreTarget]`/`[MapperIgnoreSource]` with a comment, never by lowering severity.

## A7. Persistence specifics (Task 6)

- Value converters for the enum `text[]` columns are **public static methods** on a `Infrastructure/Persistence/Conversions/EnumArrayConversions.cs` class (e.g. `public static string[] ToStorage<TEnum>(IReadOnlySet<TEnum> set)`, `public static HashSet<TEnum> FromStorage<TEnum>(string[] values)`), referenced from the configurations via `new ValueConverter<IReadOnlySet<T>, string[]>(v => EnumArrayConversions.ToStorage(v), v => EnumArrayConversions.FromStorage<T>(v))`. This keeps the model compatible with `dotnet ef dbcontext optimize` (compiled models reference converter methods directly and require them to be public/internal) should compiled models be adopted later.
- The `DomainEventInterceptor` serialises event payloads with `SchedulerJsonContext` (A2), choosing the `JsonTypeInfo` by a `switch` on the concrete event type — no `GetType()`-driven serialisation.
- `AppointmentHistoryEntry.From(IDomainEvent e, string actor)` maps fields explicitly (no reflection over event properties).

## A8. Measuring what remains (Task 18)

- `scripts/aot-readiness.sh`: `dotnet build src/Keyloop.ServiceScheduler.Api -c Release -p:IsAotCompatible=true -p:TreatWarningsAsErrors=false -warnAsMessage:none 2>&1 | grep -E "IL[0-9]{4}" | sort | uniq -c | sort -rn` — prints the trim/AOT analyzer warnings grouped by code. Expected residue: EF Core (`UseNpgsql`, LINQ translation, `RequiresDynamicCode`) and FluentValidation expression compilation. CI runs it as a non-blocking step and uploads the output as the "AOT readiness" artefact; README §"Runtime reflection budget" lists the residue and the removal path (EF precompiled queries when they leave preview; replacing FluentValidation if the brief's mandate is lifted).
- README documents: what is source-generated (RDG, JSON, config binding, options validation, logging, regex, Mapperly), what is explicit (endpoint registry, DI registrations), what remains reflection-based and why, and the one-command compiled-model step with its drift caveat.
