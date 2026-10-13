using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.Shared;

/// <summary>Queries a single appointment and its referenced entities as an <see cref="AppointmentResponse"/>.</summary>
public static class AppointmentResponseQuery
{
    /// <summary>Returns the <see cref="AppointmentResponse"/> for <paramref name="appointmentId"/>, or null if not found.</summary>
    public static async Task<AppointmentResponse?> FindAsync(SchedulerDbContext db, Guid appointmentId, CancellationToken ct, bool competence = false)
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

        if (row is null) { return null; }
        var zone = TimeZoneInfo.FindSystemTimeZoneById(row.TimeZoneId);
        var response = AppointmentResponseMapper.Map(row.Appointment, zone, row.ServiceType, row.Bay, row.Technician);
        return competence ? response with
        {
            CompetenceWarning = await AppointmentCompetenceReader.ReadAsync(db, row.Appointment, zone, row.ServiceType, row.Bay, row.Technician, ct),
        } : response;
    }
}
