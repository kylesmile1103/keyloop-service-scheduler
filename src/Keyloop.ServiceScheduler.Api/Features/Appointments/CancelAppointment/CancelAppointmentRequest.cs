namespace Keyloop.ServiceScheduler.Api.Features.Appointments.CancelAppointment;

/// <summary>The body of <c>POST /appointments/{appointmentId}/cancel</c>.</summary>
public sealed record CancelAppointmentRequest(string Reason)
{
    /// <summary>Reason for cancellation, 1 to 500 characters after trimming.</summary>
    /// <example>Customer called to reschedule.</example>
    public string Reason { get; init; } = Reason;
}
