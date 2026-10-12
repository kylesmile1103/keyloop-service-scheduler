using System.Security.Claims;
using Keyloop.ServiceScheduler.Api.Features.Appointments.Shared;
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
/// Customer names, VINs and registrations pass through <see cref="PersonalData"/>, the audience policy shared with the range read.
/// Throws <see cref="NotFoundException"/> (404 <c>not-found</c>) for an unknown dealership. Nothing is tracked or locked.
/// </summary>
public sealed class GetWorkshopScheduleHandler(SchedulerDbContext db, DayScheduleReader reader, IOptions<SchedulingOptions> options)
{
    public async Task<WorkshopScheduleResponse> HandleAsync(GetWorkshopScheduleQuery query, ClaimsPrincipal caller, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);
        ArgumentNullException.ThrowIfNull(caller);

        // ValidationFilter has already rejected a missing or malformed date.
        var date = query.LocalDate ?? throw new ArgumentException("The query has no yyyy-MM-dd date; validate it first.", nameof(query));
        var dealership = await db.Dealerships.AsNoTracking().FirstOrDefaultAsync(d => d.Id == query.DealershipId, ct)
            ?? throw new NotFoundException(ProblemResources.Dealership, query.DealershipId);

        // A named technician's HV level, expiry and confirmation are employee data: shown with the vehicle-aware flag on, and only to a
        // caller with an API role, the audience PersonalData uses for customer data.
        var competence = options.Value.VehicleAwareRequirements && SchedulerRoles.CanReadPersonalData(caller);

        if (dealership.ResolveOperatingWindow(date) is not { } window)
        {
            var (bays, technicians) = await reader.ReadResourcesAsync(dealership.Id, ct);
            return Response(dealership, date, operatingWindow: null, [.. bays.Select(b => ScheduleMapper.ToResponse(b, []))], [.. technicians.Select(t => ScheduleMapper.ToResponse(t, competence))]);
        }

        // Every status is read, then cancelled appointments are dropped: the board shows what happened as well as what is booked.
        var day = await reader.ReadAsync(dealership, window, activeOnly: false, ct);
        var scheduled = day.Appointments.Where(a => a.Status != AppointmentStatus.Cancelled).ToList();
        var zone = dealership.TimeZone;
        var serviceTypes = await ServiceTypesAsync(scheduled, ct);
        var technicianSummaries = day.Technicians.ToDictionary(t => t.Id, ScheduleMapper.ToSummary);

        // Rows arrive ordered by start, so each bay's list is too. The reader lists every resource of the dealership and an
        // appointment's bay and technician are always the dealership's own, so a missing key is corrupt data: it fails loudly.
        var appointmentsByBay = day.Bays.ToDictionary(b => b.Id, _ => new List<ScheduledAppointmentResponse>());
        var rulesByVersion = new Dictionary<int, IReadOnlyList<RequirementRule>>();
        foreach (var appointment in scheduled)
        {
            var response = ScheduleMapper.ToResponse(appointment, ScheduleMapper.ToSummary(serviceTypes[appointment.ServiceTypeId]), technicianSummaries[appointment.TechnicianId], zone);
            // Completed and no-show rows stay on the board as history; only appointments still holding resources can need review.
            if (competence && AppointmentCompetenceReader.AppliesTo(appointment.Status))
            {
                var service = serviceTypes[appointment.ServiceTypeId];
                var requirements = await AppointmentCompetenceReader.RequirementsAsync(db, dealership.Id, service, appointment.RecordedRequirements,
                    appointment.Allocation, appointment.Profile ?? VehicleProfile.Unknown, appointment.NeedsLiveDiagnosis, rulesByVersion, ct);
                var warning = AppointmentCompetenceReader.Evaluate(requirements,
                    day.Bays.Single(b => b.Id == appointment.BayId), day.Technicians.Single(t => t.Id == appointment.TechnicianId),
                    LocalTimeConverter.ToLocalDate(appointment.Slot.StartUtc, zone));
                response = response with { CompetenceWarning = warning.RequiresReview ? warning : null };
            }
            var visible = PersonalData.ForCaller(caller, appointment.CustomerName, Vin.Create(appointment.Vin), appointment.Registration);
            appointmentsByBay[appointment.BayId].Add(response with { CustomerName = visible.CustomerName, Vin = visible.Vin, Registration = visible.Registration });
        }

        return Response(
            dealership,
            date,
            ScheduleMapper.ToResponse(window, zone),
            [.. day.Bays.Select(b => ScheduleMapper.ToResponse(b, appointmentsByBay[b.Id]))],
            [.. day.Technicians.Select(t => ScheduleMapper.ToResponse(t, competence))]);
    }

    /// <summary>The services the appointments reference (the catalogue is global; only those referenced are read).</summary>
    private async Task<Dictionary<Guid, Domain.Catalog.ServiceType>> ServiceTypesAsync(
        List<DayScheduleReader.AppointmentRow> appointments, CancellationToken ct)
    {
        if (appointments.Count == 0)
        {
            return [];
        }

        var ids = appointments.Select(a => a.ServiceTypeId).Distinct().ToList();
        var serviceTypes = await db.ServiceTypes.AsNoTracking().Where(s => ids.Contains(s.Id)).ToListAsync(ct);
        return serviceTypes.ToDictionary(s => s.Id);
    }

    private WorkshopScheduleResponse Response(
        Dealership dealership,
        DateOnly date,
        OperatingWindowResponse? operatingWindow,
        IReadOnlyList<BayScheduleResponse> bays,
        IReadOnlyList<TechnicianResponse> technicians) =>
        new(ScheduleMapper.ToSummary(dealership), date, operatingWindow, options.Value.SlotGranularityMinutes, bays, technicians);
}
