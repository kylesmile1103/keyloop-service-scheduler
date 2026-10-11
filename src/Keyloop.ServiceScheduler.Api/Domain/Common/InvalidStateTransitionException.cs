using Keyloop.ServiceScheduler.Api.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.Api.Domain.Common;

/// <summary>Maps to 409 invalid-state-transition.</summary>
public sealed class InvalidStateTransitionException(AppointmentStatus current, string attempted)
    : DomainException($"Cannot {attempted} an appointment in status {current}.")
{
    public AppointmentStatus Current { get; } = current;

    public string Attempted { get; } = attempted;
}
