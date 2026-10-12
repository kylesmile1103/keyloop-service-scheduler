namespace Keyloop.ServiceScheduler.Api.Features.Appointments.CancelAppointment;

// The property is declared explicitly (initialised from the positional parameter) because the OpenAPI XML-comment generator copies a
// record's <param> descriptions onto its properties but not their examples: the <example> on the property itself is what reaches the
// schema, and Scalar's "Test request" body is built from it (Addendum B §B2; see BookAppointmentRequest).

/// <summary>The body of <c>POST /appointments/{appointmentId}/cancel</c>.</summary>
public sealed record CancelAppointmentRequest(string Reason)
{
    /// <summary>
    /// Why the appointment is cancelled, 1 to 500 characters after trimming. Stored on the appointment (returned as
    /// <c>cancellationReason</c>) and in its audit history; never written to logs.
    /// </summary>
    /// <example>Customer called to reschedule.</example>
    public string Reason { get; init; } = Reason;
}
