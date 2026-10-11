using System.Text.Json.Serialization;
using Keyloop.ServiceScheduler.Api.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.Api.Common.Serialization;

/// <summary>
/// Source-generated JSON metadata for every type the API serialises (ADR-016, Addendum A §A2). Reflection-based serialisation is
/// disabled, so a type missing here fails fast.
/// </summary>
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
// Task 7+: every request, response and extension payload type, including top-level collections, e.g.
// [JsonSerializable(typeof(IReadOnlyList<DealershipResponse>))]
internal sealed partial class SchedulerJsonContext : JsonSerializerContext;
