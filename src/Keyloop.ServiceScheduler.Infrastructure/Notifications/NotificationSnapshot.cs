using Keyloop.ServiceScheduler.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.Infrastructure.Notifications;

/// <summary>
/// What an outbox row keeps about its appointment, stored as source-generated JSON in <c>notification_outbox.payload</c>. It is built
/// from the aggregate alone while the booking or cancel is saved: no lookup, no rendering, nothing that can fail the change or add a
/// round trip to the booking's critical section (ADR-003, ADR-020). The email is rendered from it at dispatch. Only the last four VIN
/// characters are kept, and no free text: the cancellation reason and the customer's name never reach an email (ADR-010).
/// </summary>
internal sealed record NotificationSnapshot(
    Guid AppointmentId, Guid DealershipId, Guid ServiceTypeId, DateTime StartUtc, DateTime EndUtc, string Registration, string VinLastFour)
{
    public static NotificationSnapshot From(Appointment appointment)
    {
        ArgumentNullException.ThrowIfNull(appointment);
        var vin = appointment.Vehicle.Vin.Value;
        return new NotificationSnapshot(
            appointment.Id, appointment.DealershipId, appointment.ServiceTypeId, appointment.Slot.StartUtc, appointment.Slot.EndUtc,
            appointment.Vehicle.Registration, vin[Math.Max(0, vin.Length - 4)..]);
    }
}

/// <summary>The renderer's input: the snapshot joined at dispatch with the dealership's and service's names and the dealership's zone.</summary>
internal sealed record NotificationDetails(
    Guid AppointmentId, string Recipient, string DealershipName, string ServiceName, string TimeZoneId, DateTime StartUtc, DateTime EndUtc,
    string Registration, string VinLastFour);
