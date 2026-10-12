using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.Shared;

/// <summary>
/// Reads one appointment as an <see cref="AppointmentResponse"/>: what <c>GetAppointment</c> serves and what <c>CancelAppointment</c>
/// answers with after its commit, so both show exactly what the database holds.
/// </summary>
public static class AppointmentResponseQuery
{
    /// <summary>
    /// The response for the appointment with <paramref name="appointmentId"/>, or null when there is none. One query: the appointment
    /// joined to its dealership's time zone (for <c>startLocal</c>/<c>endLocal</c>), its service type, bay and technician, which the
    /// aggregate references by id only. The foreign keys make the inner joins total. Untracked, outside any transaction.
    /// </summary>
    public static async Task<AppointmentResponse?> FindAsync(SchedulerDbContext db, Guid appointmentId, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(db);
        var row = await (
                from appointment in db.Appointments.AsNoTracking()
                where appointment.Id == appointmentId
                join dealership in db.Dealerships on appointment.DealershipId equals dealership.Id
                join serviceType in db.ServiceTypes on appointment.ServiceTypeId equals serviceType.Id
                join bay in db.ServiceBays on appointment.BayId equals bay.Id
                join technician in db.Technicians on appointment.TechnicianId equals technician.Id
                select new { Appointment = appointment, dealership.TimeZoneId, ServiceType = serviceType, Bay = bay, Technician = technician })
            .FirstOrDefaultAsync(ct);

        return row is null
            ? null
            : AppointmentResponseMapper.Map(row.Appointment, TimeZoneInfo.FindSystemTimeZoneById(row.TimeZoneId), row.ServiceType, row.Bay, row.Technician);
    }
}
