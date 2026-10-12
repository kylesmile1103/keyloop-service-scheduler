using System.Text.Json;
using Keyloop.ServiceScheduler.Domain.Common;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Interceptors;
using Keyloop.ServiceScheduler.Infrastructure.Serialization;

namespace Keyloop.ServiceScheduler.Infrastructure.Persistence;

/// <summary>One row of the append-only audit trail (<c>appointment_history</c>, SYSTEM_DESIGN §5.6), written in the same transaction as the change.</summary>
public sealed class AppointmentHistoryEntry
{
    // EF Core materialisation.
    private AppointmentHistoryEntry()
    {
        EventType = string.Empty;
        Actor = string.Empty;
        Payload = string.Empty;
    }

    public Guid Id { get; private set; }

    public Guid AppointmentId { get; private set; }

    public string EventType { get; private set; }

    public DateTime OccurredAtUtc { get; private set; }

    /// <summary><c>system</c>, or <c>anonymous:&lt;ip&gt;</c> for an HTTP request (see <c>CurrentActor</c>).</summary>
    public string Actor { get; private set; }

    /// <summary>The event serialised as JSON (a <c>jsonb</c> column).</summary>
    public string Payload { get; private set; }

    /// <summary>Maps the event's fields explicitly; the payload goes through the source-generated <see cref="PersistenceJsonContext"/> (Addendum A §A7).</summary>
    public static AppointmentHistoryEntry From(IDomainEvent domainEvent, string actor)
    {
        ArgumentNullException.ThrowIfNull(domainEvent);
        ArgumentException.ThrowIfNullOrWhiteSpace(actor);
        return new AppointmentHistoryEntry
        {
            // Version 7 ids keyed on the event time sort the trail chronologically.
            Id = Guid.CreateVersion7(new DateTimeOffset(domainEvent.OccurredAtUtc, TimeSpan.Zero)),
            AppointmentId = domainEvent.AppointmentId,
            EventType = domainEvent.EventType,
            OccurredAtUtc = domainEvent.OccurredAtUtc,
            Actor = actor,
            Payload = SerializePayload(domainEvent),
        };
    }

    // The JsonTypeInfo is chosen by a switch on the concrete type: no GetType()-driven (reflection) serialisation.
    private static string SerializePayload(IDomainEvent domainEvent) => domainEvent switch
    {
        AppointmentBooked e => JsonSerializer.Serialize(e, PersistenceJsonContext.Default.AppointmentBooked),
        AppointmentCancelled e => JsonSerializer.Serialize(e, PersistenceJsonContext.Default.AppointmentCancelled),
        AppointmentCheckedIn e => JsonSerializer.Serialize(e, PersistenceJsonContext.Default.AppointmentCheckedIn),
        AppointmentStarted e => JsonSerializer.Serialize(e, PersistenceJsonContext.Default.AppointmentStarted),
        AppointmentCompleted e => JsonSerializer.Serialize(e, PersistenceJsonContext.Default.AppointmentCompleted),
        AppointmentNoShow e => JsonSerializer.Serialize(e, PersistenceJsonContext.Default.AppointmentNoShow),
        _ => throw new NotSupportedException(
            $"Domain event '{domainEvent.EventType}' has no JSON metadata; add it to {nameof(PersistenceJsonContext)} and to this switch."),
    };
}
