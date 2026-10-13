using Keyloop.ServiceScheduler.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.Infrastructure.Notifications;

/// <summary>
/// Appointment snapshot stored as JSON in <c>notification_outbox.payload</c> for deferred email rendering without free-text PII.
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
