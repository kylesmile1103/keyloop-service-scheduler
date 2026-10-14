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

/// <summary>Computes bookable availability slots for a service type on a dealership-local date.</summary>
public sealed class GetAvailabilityHandler(
    SchedulerDbContext db, DayScheduleReader reader, IOptions<SchedulingOptions> options, RequirementPolicyReader policies, BookingWindowPolicy windowPolicy)
{
    public async Task<AvailabilityResponse> HandleAsync(GetAvailabilityQuery query, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(query);

        var serviceTypeId = query.ServiceTypeId ?? throw new ArgumentException("The query has no service type id; validate it first.", nameof(query));
        var date = query.LocalDate ?? throw new ArgumentException("The query has no yyyy-MM-dd date; validate it first.", nameof(query));

        VehicleAwareInputs.EnsureHonoured(options.Value.VehicleAwareRequirements, ("powertrain", query.Powertrain is not null),
            ("manufacturer", query.Manufacturer is not null), ("vehicleClass", query.VehicleClass is not null), ("needsLiveDiagnosis", query.LiveDiagnosis == true));

        Activity.Current?.SetTag("dealership.id", query.DealershipId.ToString());
        var started = Stopwatch.GetTimestamp();
        var response = await ComputeAsync(query, serviceTypeId, date, ct);
        SchedulerTelemetry.AvailabilityDuration.Record(
            Stopwatch.GetElapsedTime(started).TotalMilliseconds);
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

        var day = await reader.ReadAsync(dealership, window, activeOnly: true, ct);
        var profile = VehicleProfile.Unknown with
        {
            Powertrain = query.PowertrainValue ?? Powertrain.Unknown,
            Manufacturer = VehicleProfile.NormalizeManufacturer(query.Manufacturer),
            VehicleClass = query.VehicleClassValue ?? VehicleClass.Unknown,
        };
        var requirements = options.Value.VehicleAwareRequirements
            ? await policies.ResolveAsync(dealershipId, serviceType, profile, query.LiveDiagnosis ?? false, ct) : null;
        var bays = day.Bays.Where(b => b.IsActive && (requirements is null ? b.Supports(serviceType) : b.Satisfies(requirements))).ToList();
        var technicians = day.Technicians.Where(t => t.IsActive && (requirements is null ? t.IsCertifiedFor(serviceType) : t.Satisfies(requirements, date))).ToList();
        if (bays.Count == 0 || technicians.Count == 0)
        {
            return Response(date, dealership, serviceType, granularity, operatingWindow, slots: [], AvailabilityUnavailableReasons.NoQualifiedResources);
        }

        var busyByBay = day.Appointments.ToLookup(a => a.BayId, a => a.Slot);
        var busyByTechnician = day.Appointments.ToLookup(a => a.TechnicianId, a => a.Slot);

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
            // Only starts a booking would be accepted at now: a start already passed or inside the minimum lead time, or one beyond
            // the booking horizon, is never offered (the same filter the 409 suggestions apply), so a chip the advisor picks cannot
            // fail the window rules a moment later.
            slots = [.. slots.Where(s => windowPolicy.IsBookable(s.StartUtc))];
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
