using Keyloop.ServiceScheduler.Api.Domain.Catalog;
using Keyloop.ServiceScheduler.Api.Domain.Dealerships;
using Keyloop.ServiceScheduler.Api.Domain.Resources;
using Keyloop.ServiceScheduler.Api.Domain.Scheduling;
using Keyloop.ServiceScheduler.Api.Features.Appointments.Mapping;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.Shared;

/// <summary>Builds an <see cref="AppointmentResponse"/> from the aggregate and the entities it references by id (Mapperly does the copying).</summary>
public static class AppointmentResponseMapper
{
    /// <summary>
    /// The response, with <c>startLocal</c>/<c>endLocal</c> in <paramref name="zone"/> (the dealership's). The service type, bay and
    /// technician must be the ones the appointment references.
    /// </summary>
    /// <exception cref="ArgumentException">A service type, bay or technician other than the appointment's (a programming error).</exception>
    public static AppointmentResponse Map(Appointment appointment, TimeZoneInfo zone, ServiceType serviceType, ServiceBay bay, Technician technician)
    {
        ArgumentNullException.ThrowIfNull(appointment);
        ArgumentNullException.ThrowIfNull(zone);
        ArgumentNullException.ThrowIfNull(serviceType);
        ArgumentNullException.ThrowIfNull(bay);
        ArgumentNullException.ThrowIfNull(technician);
        Same(appointment.ServiceTypeId, serviceType.Id, nameof(serviceType));
        Same(appointment.BayId, bay.Id, nameof(bay));
        Same(appointment.TechnicianId, technician.Id, nameof(technician));

        return AppointmentMapper.ToResponse(
            appointment,
            AppointmentMapper.ToSummary(serviceType),
            AppointmentMapper.ToSummary(bay),
            AppointmentMapper.ToSummary(technician),
            startLocal: LocalTimeConverter.FormatLocal(appointment.Slot.StartUtc, zone),
            endLocal: LocalTimeConverter.FormatLocal(appointment.Slot.EndUtc, zone));
    }

    private static void Same(Guid referenced, Guid given, string paramName)
    {
        if (referenced != given)
        {
            throw new ArgumentException($"The appointment references {paramName} {referenced}, not {given}.", paramName);
        }
    }
}
