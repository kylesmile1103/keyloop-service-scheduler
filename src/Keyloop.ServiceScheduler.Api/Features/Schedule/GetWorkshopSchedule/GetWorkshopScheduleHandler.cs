using System.Security.Claims;
using Keyloop.ServiceScheduler.Api.Common.Authentication;
using Keyloop.ServiceScheduler.Api.Common.Contracts;
using Keyloop.ServiceScheduler.Api.Common.Options;
using Keyloop.ServiceScheduler.Api.Common.Problems;
using Keyloop.ServiceScheduler.Api.Features.Schedule.Mapping;
using Keyloop.ServiceScheduler.Domain.Dealerships;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Queries;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Api.Features.Schedule.GetWorkshopSchedule;

/// <summary>
/// The dispatch board for one dealership and local date (FR-9): a projection over the dealership-day (ARCHITECTURE §5.3), read with
/// <see cref="DayScheduleReader"/> from the dealership already loaded. Every bay and technician is listed, active or not, so that
/// appointments on a resource taken out of service stay visible; each bay holds its appointments overlapping the operating window in
/// every status except <see cref="AppointmentStatus.Cancelled"/>, ordered by start. A closed day has no window and no appointments.
/// Throws <see cref="NotFoundException"/> (404 <c>not-found</c>) for an unknown dealership. Nothing is tracked or locked.
/// </summary>
public sealed class GetWorkshopScheduleHandler(SchedulerDbContext db, DayScheduleReader reader, IOptions<SchedulingOptions> options)
{
    public async Task<WorkshopScheduleResponse> HandleAsync(GetWorkshopScheduleQuery query, ClaimsPrincipal caller, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);

        // ValidationFilter has already rejected a missing or malformed date.
        var date = query.LocalDate ?? throw new ArgumentException("The query has no yyyy-MM-dd date; validate it first.", nameof(query));
        var dealership = await db.Dealerships.AsNoTracking().FirstOrDefaultAsync(d => d.Id == query.DealershipId, ct)
            ?? throw new NotFoundException(ProblemResources.Dealership, query.DealershipId);

        if (dealership.ResolveOperatingWindow(date) is not { } window)
        {
            var (bays, technicians) = await reader.ReadResourcesAsync(dealership.Id, ct);
            return Response(dealership, date, operatingWindow: null, [.. bays.Select(b => ScheduleMapper.ToResponse(b, []))], [.. technicians.Select(ScheduleMapper.ToResponse)]);
        }

        // Every status is read, then cancelled appointments are dropped: the board shows what happened as well as what is booked.
        var day = await reader.ReadAsync(dealership, window, activeOnly: false, ct);
        var scheduled = day.Appointments.Where(a => a.Status != AppointmentStatus.Cancelled).ToList();
        var zone = dealership.TimeZone;
        var serviceTypes = await ServiceTypeSummariesAsync(scheduled, ct);
        var technicianSummaries = day.Technicians.ToDictionary(t => t.Id, ScheduleMapper.ToSummary);

        // Rows arrive ordered by start, so each bay's list is too. The reader lists every resource of the dealership and an
        // appointment's bay and technician are always the dealership's own, so a missing key is corrupt data: it fails loudly.
        var appointmentsByBay = day.Bays.ToDictionary(b => b.Id, _ => new List<ScheduledAppointmentResponse>());
        foreach (var appointment in scheduled)
        {
            var response = ScheduleMapper.ToResponse(appointment, serviceTypes[appointment.ServiceTypeId], technicianSummaries[appointment.TechnicianId], zone);
            var (name, vin) = PersonalData.ForCaller(caller, response.CustomerName, response.Vin);
            appointmentsByBay[appointment.BayId].Add(response with { CustomerName = name, Vin = vin });
        }

        return Response(
            dealership,
            date,
            ScheduleMapper.ToResponse(window, zone),
            [.. day.Bays.Select(b => ScheduleMapper.ToResponse(b, appointmentsByBay[b.Id]))],
            [.. day.Technicians.Select(ScheduleMapper.ToResponse)]);
    }

    /// <summary>The services the appointments reference (the catalogue is global; only those referenced are read).</summary>
    private async Task<Dictionary<Guid, ServiceTypeSummary>> ServiceTypeSummariesAsync(
        List<DayScheduleReader.AppointmentRow> appointments, CancellationToken ct)
    {
        if (appointments.Count == 0)
        {
            return [];
        }

        var ids = appointments.Select(a => a.ServiceTypeId).Distinct().ToList();
        var serviceTypes = await db.ServiceTypes.AsNoTracking().Where(s => ids.Contains(s.Id)).ToListAsync(ct);
        return serviceTypes.ToDictionary(s => s.Id, ScheduleMapper.ToSummary);
    }

    private WorkshopScheduleResponse Response(
        Dealership dealership,
        DateOnly date,
        OperatingWindowResponse? operatingWindow,
        IReadOnlyList<BayScheduleResponse> bays,
        IReadOnlyList<TechnicianResponse> technicians) =>
        new(ScheduleMapper.ToSummary(dealership), date, operatingWindow, options.Value.SlotGranularityMinutes, bays, technicians);
}
