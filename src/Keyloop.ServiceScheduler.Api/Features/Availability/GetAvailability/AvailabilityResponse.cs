using Keyloop.ServiceScheduler.Api.Common.Contracts;

namespace Keyloop.ServiceScheduler.Api.Features.Availability.GetAvailability;

/// <summary>Feasible start times for one service on one local date at one dealership.</summary>
/// <param name="Date">The local calendar date asked for, in the dealership's time zone.</param>
/// <param name="TimeZoneId">The dealership's IANA time-zone id (e.g. <c>Europe/London</c>); every <c>…Local</c> value is wall-clock time there, with that zone's offset.</param>
/// <param name="OperatingWindow">Opening to closing time that day; null when the dealership is closed on that weekday.</param>
/// <param name="DurationMinutes">How long the service occupies one bay and one technician, in minutes.</param>
/// <param name="SlotGranularityMinutes">Start times fall on this grid, counted from the opening time.</param>
/// <param name="Slots">Bookable start times on the slot grid in ascending order, or empty when closed or fully booked.</param>
/// <param name="UnavailableReason">Reason when no slots can exist on the requested date (<c>closed</c> or <c>no-qualified-resources</c>); otherwise null.</param>
public sealed record AvailabilityResponse(
    DateOnly Date,
    string TimeZoneId,
    OperatingWindowResponse? OperatingWindow,
    int DurationMinutes,
    int SlotGranularityMinutes,
    IReadOnlyList<AvailabilitySlotResponse> Slots,
    string? UnavailableReason);

/// <summary>A bookable start time, with how much capacity remains at it.</summary>
/// <param name="StartUtc">Start (inclusive), UTC. The identity of the slot: book with this value.</param>
/// <param name="EndUtc">End (exclusive), UTC: the start plus the service duration.</param>
/// <param name="StartLocal">Start as local time with offset, <c>yyyy-MM-ddTHH:mm±hh:mm</c> (e.g. <c>2026-10-13T10:00+01:00</c>), for display.</param>
/// <param name="FreeBays">How many qualified bays are free for the whole slot (at least 1).</param>
/// <param name="FreeTechnicians">How many qualified technicians are free for the whole slot (at least 1).</param>
public sealed record AvailabilitySlotResponse(DateTime StartUtc, DateTime EndUtc, string StartLocal, int FreeBays, int FreeTechnicians);

/// <summary>The values of <see cref="AvailabilityResponse.UnavailableReason"/>; stable API.</summary>
public static class AvailabilityUnavailableReasons
{
    public const string Closed = "closed";
    public const string NoQualifiedResources = "no-qualified-resources";
}
