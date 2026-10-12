using System.Diagnostics;
using Keyloop.ServiceScheduler.Api.Common.Contracts;
using Keyloop.ServiceScheduler.Api.Common.Options;
using Keyloop.ServiceScheduler.Api.Common.Problems;
using Keyloop.ServiceScheduler.Api.Common.Telemetry;
using Keyloop.ServiceScheduler.Api.Features.Availability.Mapping;
using Keyloop.ServiceScheduler.Api.Features.Vehicles;
using Keyloop.ServiceScheduler.Domain.Catalog;
using Keyloop.ServiceScheduler.Domain.Dealerships;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Queries;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Api.Features.Availability.GetAvailability;

/// <summary>
/// Availability for one service on one local date (ARCHITECTURE §6.1–§6.2): the dealership's operating window for that date, the
/// active bays and technicians that qualify for the service, the active appointments overlapping the window, and
/// <see cref="AvailabilityCalculator"/> over them. Throws <see cref="NotFoundException"/> (404 <c>not-found</c>) for an unknown
/// dealership or service type. Records <c>scheduler.availability.duration</c> and <c>scheduler.availability.slots_returned</c>
/// for every answer, and wraps the calculation in the <c>scheduler.compute_availability</c> span (§12.1).
/// </summary>
public sealed class GetAvailabilityHandler(SchedulerDbContext db, DayScheduleReader reader, IOptions<SchedulingOptions> options, RequirementPolicyReader policies)
{
    public async Task<AvailabilityResponse> HandleAsync(GetAvailabilityQuery query, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);

        // ValidationFilter has already rejected a missing or malformed service type id or date.
        var serviceTypeId = query.ServiceTypeId ?? throw new ArgumentException("The query has no service type id; validate it first.", nameof(query));
        var date = query.LocalDate ?? throw new ArgumentException("The query has no yyyy-MM-dd date; validate it first.", nameof(query));

        VehicleAwareInputs.EnsureHonoured(options.Value.VehicleAwareRequirements, ("powertrain", query.Powertrain is not null),
            ("manufacturer", query.Manufacturer is not null), ("vehicleClass", query.VehicleClass is not null), ("needsLiveDiagnosis", query.NeedsLiveDiagnosis == true));

        // A latency is real elapsed time (Stopwatch), not the injected business clock, which tests freeze.
        var started = Stopwatch.GetTimestamp();
        var response = await ComputeAsync(query, serviceTypeId, date, ct);
        SchedulerTelemetry.AvailabilityDuration.Record(
            Stopwatch.GetElapsedTime(started).TotalMilliseconds, new KeyValuePair<string, object?>("dealership.id", query.DealershipId.ToString()));
        SchedulerTelemetry.AvailabilitySlotsReturned.Record(response.Slots.Count);
        return response;
    }

    private async Task<AvailabilityResponse> ComputeAsync(GetAvailabilityQuery query, Guid serviceTypeId, DateOnly date, CancellationToken ct)
    {
        var dealershipId = query.DealershipId;
        var dealership = await db.Dealerships.AsNoTracking().FirstOrDefaultAsync(d => d.Id == dealershipId, ct)
            ?? throw new NotFoundException(ProblemResources.Dealership, dealershipId);
        var serviceType = await db.ServiceTypes.AsNoTracking().FirstOrDefaultAsync(s => s.Id == serviceTypeId, ct)
            ?? throw new NotFoundException(ProblemResources.ServiceType, serviceTypeId);
        var granularity = options.Value.SlotGranularityMinutes;
        var zone = dealership.TimeZone;

        if (dealership.ResolveOperatingWindow(date) is not { } window)
        {
            return Response(date, dealership, serviceType, granularity, operatingWindow: null, slots: [], AvailabilityUnavailableReasons.Closed);
        }

        var operatingWindow = AvailabilityMapper.ToResponse(window, zone);

        // The day-schedule read returns every resource, active or not: only active ones that qualify are capacity, exactly the
        // ones booking would accept (Appointment.Book re-asserts the same rules).
        var day = await reader.ReadAsync(dealership, window, activeOnly: true, ct);
        var profile = VehicleProfile.Unknown with
        {
            Powertrain = query.Powertrain is null ? Powertrain.Unknown : Enum.Parse<Powertrain>(query.Powertrain, true),
            Manufacturer = VehicleProfile.NormalizeManufacturer(query.Manufacturer),
            VehicleClass = query.VehicleClass is null ? VehicleClass.Unknown : Enum.Parse<VehicleClass>(query.VehicleClass, true),
        };
        var requirements = options.Value.VehicleAwareRequirements
            ? RequirementResolver.Resolve(serviceType, profile, await policies.ReadAsync(dealershipId, ct), query.NeedsLiveDiagnosis ?? false) : null;
        var bays = day.Bays.Where(b => b.IsActive && (requirements is null ? b.Supports(serviceType) : b.Satisfies(requirements))).ToList();
        var technicians = day.Technicians.Where(t => t.IsActive && (requirements is null ? t.IsCertifiedFor(serviceType) : t.Satisfies(requirements, date))).ToList();
        if (bays.Count == 0 || technicians.Count == 0)
        {
            return Response(date, dealership, serviceType, granularity, operatingWindow, slots: [], AvailabilityUnavailableReasons.NoQualifiedResources);
        }

        var busyByBay = day.Appointments.ToLookup(a => a.BayId, a => a.Slot);
        var busyByTechnician = day.Appointments.ToLookup(a => a.TechnicianId, a => a.Slot);

        // A window lost entirely to a daylight-saving gap is zero-length: the calculator yields no slots, and there is no reason
        // to report (the dealership has hours that day and the resources qualify).
        IReadOnlyList<AvailabilitySlot> slots;
        using (var activity = SchedulerTelemetry.Source.StartActivity("scheduler.compute_availability"))
        {
            activity?.SetTag("availability.candidates_bays", bays.Count);
            activity?.SetTag("availability.candidates_technicians", technicians.Count);
            slots = AvailabilityCalculator.Compute(
                window,
                serviceType.Duration,
                granularity,
                [.. bays.Select(b => new ResourceBusy(b.Id, [.. busyByBay[b.Id]]))],
                [.. technicians.Select(t => new ResourceBusy(t.Id, [.. busyByTechnician[t.Id]]))]);
            activity?.SetTag("availability.slots_returned", slots.Count);
        }

        return Response(date, dealership, serviceType, granularity, operatingWindow, [.. slots.Select(s => AvailabilityMapper.ToResponse(s, zone))], unavailableReason: null);
    }

    private static AvailabilityResponse Response(
        DateOnly date,
        Dealership dealership,
        ServiceType serviceType,
        int granularity,
        OperatingWindowResponse? operatingWindow,
        IReadOnlyList<AvailabilitySlotResponse> slots,
        string? unavailableReason) =>
        new(date, dealership.TimeZoneId, operatingWindow, serviceType.Duration.Minutes, granularity, slots, unavailableReason);
}
