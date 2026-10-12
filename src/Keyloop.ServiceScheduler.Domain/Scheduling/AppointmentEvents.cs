using Keyloop.ServiceScheduler.Domain.Common;

namespace Keyloop.ServiceScheduler.Domain.Scheduling;

// Persisted to appointment_history (ARCHITECTURE §5.6). Events carry no customer PII and only the masked VIN.

public sealed record AppointmentBooked(
    Guid AppointmentId,
    Guid DealershipId,
    Guid ServiceTypeId,
    Guid BayId,
    Guid TechnicianId,
    DateTime StartUtc,
    DateTime EndUtc,
    string MaskedVin,
    DateTime OccurredAtUtc, VehicleProfile? VehicleProfile = null, AllocationDecision? Allocation = null) : IDomainEvent
{
    public string EventType => "Booked";
}

public sealed record AppointmentCancelled(Guid AppointmentId, AppointmentStatus PreviousStatus, string Reason, DateTime OccurredAtUtc) : IDomainEvent
{
    public string EventType => "Cancelled";
}

public sealed record AppointmentCheckedIn(Guid AppointmentId, DateTime OccurredAtUtc) : IDomainEvent
{
    public string EventType => "CheckedIn";
}

public sealed record AppointmentStarted(Guid AppointmentId, DateTime OccurredAtUtc) : IDomainEvent
{
    public string EventType => "Started";
}

public sealed record AppointmentCompleted(Guid AppointmentId, DateTime OccurredAtUtc) : IDomainEvent
{
    public string EventType => "Completed";
}

public sealed record AppointmentNoShow(Guid AppointmentId, DateTime OccurredAtUtc) : IDomainEvent
{
    public string EventType => "NoShow";
}
