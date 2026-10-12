using Keyloop.ServiceScheduler.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.Domain.Common;

/// <summary>
/// Maps to 409 invalid-state-transition. <see cref="Attempted"/> is the machine token (e.g. <c>mark-no-show</c>) that reaches
/// clients as the <c>attempted</c> extension; <see cref="Exception.Message"/> is the human-readable detail.
/// </summary>
public sealed class InvalidStateTransitionException(AppointmentStatus current, string attempted)
    : DomainException($"Cannot {Describe(attempted)} while it is {current}.")
{
    public AppointmentStatus Current { get; } = current;

    public string Attempted { get; } = attempted;

    private static string Describe(string attempted) => attempted switch
    {
        "cancel" => "cancel this appointment",
        "check-in" => "check in this appointment",
        "start" => "start work on this appointment",
        "complete" => "complete this appointment",
        "mark-no-show" => "mark this appointment as a no-show",
        _ => $"perform '{attempted}' on this appointment",
    };
}
