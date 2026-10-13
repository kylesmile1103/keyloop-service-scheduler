using System.Text.Json.Serialization;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Infrastructure.Notifications;

namespace Keyloop.ServiceScheduler.Infrastructure.Serialization;

/// <summary>Source-generated metadata for persisted audit events and notification snapshots (ADR-016).</summary>
[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    UseStringEnumConverter = true,
    WriteIndented = false)]
[JsonSerializable(typeof(RecordedRequirements))]
[JsonSerializable(typeof(ProfileProvenance))]
[JsonSerializable(typeof(AllocationDecision))]
[JsonSerializable(typeof(AppointmentBooked))]
[JsonSerializable(typeof(AppointmentCancelled))]
[JsonSerializable(typeof(AppointmentCheckedIn))]
[JsonSerializable(typeof(AppointmentStarted))]
[JsonSerializable(typeof(AppointmentCompleted))]
[JsonSerializable(typeof(AppointmentNoShow))]
[JsonSerializable(typeof(NotificationSnapshot))]
internal sealed partial class PersistenceJsonContext : JsonSerializerContext;
