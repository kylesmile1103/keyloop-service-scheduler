using System.Text.Json.Serialization;
using Keyloop.ServiceScheduler.Api.Common.Problems;
using Keyloop.ServiceScheduler.Api.Domain.Dealerships;
using Keyloop.ServiceScheduler.Api.Domain.Resources;
using Keyloop.ServiceScheduler.Api.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.Api.Common.Serialization;

/// <summary>
/// Source-generated JSON metadata for every type the API serialises (ADR-016, Addendum A §A2). Reflection-based serialisation is
/// disabled, so a type missing here fails fast. It is first in the HTTP resolver chain; ASP.NET Core's ProblemDetails context follows.
/// </summary>
/// <remarks>
/// ProblemDetails extensions are <c>object</c>-typed and serialised by their <em>runtime</em> type, so each runtime type a throw
/// site stores there is listed (a <c>List&lt;T&gt;</c> is not covered by <c>T[]</c>; <c>GlobalExceptionHandler</c> copies
/// suggestions into arrays). Top-level collection response types are listed explicitly; nested types are discovered.
/// </remarks>
[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    UseStringEnumConverter = true,
    WriteIndented = false)]
// Task 6: audit payloads (appointment_history.payload)
[JsonSerializable(typeof(AppointmentBooked))]
[JsonSerializable(typeof(AppointmentCancelled))]
[JsonSerializable(typeof(AppointmentCheckedIn))]
[JsonSerializable(typeof(AppointmentStarted))]
[JsonSerializable(typeof(AppointmentCompleted))]
[JsonSerializable(typeof(AppointmentNoShow))]
// Task 7: problem extension values (SYSTEM_DESIGN §8.7), by runtime type
[JsonSerializable(typeof(OperatingWindow))] // operatingWindow
[JsonSerializable(typeof(DateTime))] // earliestStartUtc, latestStartUtc
[JsonSerializable(typeof(int))] // slotGranularityMinutes, retryAfterSeconds
[JsonSerializable(typeof(BayCapability[]))] // missingCapabilities
[JsonSerializable(typeof(Certification[]))] // missingCertifications
[JsonSerializable(typeof(SuggestedSlot))]
[JsonSerializable(typeof(SuggestedSlot[]))] // suggestedSlots
[JsonSerializable(typeof(IReadOnlyList<SuggestedSlot>))]
[JsonSerializable(typeof(AppointmentStatus))] // currentStatus
[JsonSerializable(typeof(string))] // attempted, resource, conflictingResource, traceId
[JsonSerializable(typeof(string[]))]
[JsonSerializable(typeof(Guid))] // id
// Tasks 8+: every request, response and extension payload type, including top-level collections, e.g.
// [JsonSerializable(typeof(IReadOnlyList<DealershipResponse>))]
internal sealed partial class SchedulerJsonContext : JsonSerializerContext;
