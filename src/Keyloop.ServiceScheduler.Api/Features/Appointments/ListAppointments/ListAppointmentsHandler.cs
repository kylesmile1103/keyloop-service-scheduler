using System.Security.Claims;
using Keyloop.ServiceScheduler.Api.Common.Problems;
using Keyloop.ServiceScheduler.Domain.Catalog;
using Keyloop.ServiceScheduler.Domain.Dealerships;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.ListAppointments;

/// <summary>Queries appointments starting within an inclusive dealership-local date range.</summary>
public sealed class ListAppointmentsHandler(SchedulerDbContext db)
{
    public async Task<IReadOnlyList<AppointmentListItemResponse>> HandleAsync(ListAppointmentsQuery query, ClaimsPrincipal caller, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);
        ArgumentNullException.ThrowIfNull(caller);
        var from = query.LocalFrom ?? throw new ArgumentException("The query has no yyyy-MM-dd from date; validate it first.", nameof(query));
        var to = query.LocalTo ?? throw new ArgumentException("The query has no yyyy-MM-dd to date; validate it first.", nameof(query));
        var zoneId = await db.Dealerships.AsNoTracking().Where(d => d.Id == query.DealershipId).Select(d => d.TimeZoneId).SingleOrDefaultAsync(ct)
            ?? throw new NotFoundException(ProblemResources.Dealership, query.DealershipId);
        var zone = TimeZoneInfo.FindSystemTimeZoneById(zoneId);
        var startUtc = LocalTimeConverter.ToUtc(from, TimeOnly.MinValue, zone);
        DateTime? endUtc = to == DateOnly.MaxValue ? null : LocalTimeConverter.ToUtc(to.AddDays(1), TimeOnly.MinValue, zone);
        var rows = await RangeQuery(query, startUtc, endUtc).ToListAsync(ct);
        return rows.Select(row => ListAppointmentsResponseMapper.Map(row, zone, caller)).ToList();
    }

    internal IQueryable<AppointmentListRow> RangeQuery(ListAppointmentsQuery query, DateTime startUtc, DateTime? endUtc)
    {
        var appointments = db.Appointments.AsNoTracking()
            .Where(a => a.DealershipId == query.DealershipId && a.Slot.StartUtc >= startUtc);
        if (endUtc is { } end)
        {
            appointments = appointments.Where(a => a.Slot.StartUtc < end);
        }
        if (query.Status.Length > 0)
        {
            var statuses = query.Status.Select(Enum.Parse<AppointmentStatus>).Distinct().ToArray();
            appointments = appointments.Where(a => statuses.Contains(a.Status));
        }

        return from appointment in appointments
            join serviceType in db.ServiceTypes on appointment.ServiceTypeId equals serviceType.Id
            join bay in db.ServiceBays on appointment.BayId equals bay.Id
            join technician in db.Technicians on appointment.TechnicianId equals technician.Id
            orderby appointment.Slot.StartUtc, appointment.Id
            select new AppointmentListRow(appointment.Id, appointment.Status, appointment.Slot.StartUtc, appointment.Slot.EndUtc,
                serviceType.Id, serviceType.Code, serviceType.Name, serviceType.Duration, bay.Id, bay.Name, technician.Id, technician.Name,
                appointment.Customer.Name, appointment.Vehicle.Vin, appointment.Vehicle.Registration);
    }
}

/// <summary>Projected appointment row for date-range queries.</summary>
internal sealed record AppointmentListRow(
    Guid Id, AppointmentStatus Status, DateTime StartUtc, DateTime EndUtc,
    Guid ServiceTypeId, string ServiceTypeCode, string ServiceTypeName, ServiceDuration ServiceTypeDuration,
    Guid BayId, string BayName, Guid TechnicianId, string TechnicianName,
    string CustomerName, Vin Vin, string Registration);
