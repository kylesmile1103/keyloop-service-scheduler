namespace Keyloop.ServiceScheduler.Api.Features.Availability.GetAvailability;

/// <summary>Feasible start times for one service on one local date at one dealership.</summary>
/// <param name="Date">The local calendar date asked for, in the dealership's time zone.</param>
/// <param name="TimeZoneId">The dealership's IANA time-zone id (e.g. <c>Europe/London</c>); every <c>…Local</c> value is wall-clock time there, with that zone's offset.</param>
/// <param name="OperatingWindow">Opening to closing time that day; null when the dealership is closed on that weekday.</param>
/// <param name="DurationMinutes">How long the service occupies one bay and one technician, in minutes.</param>
/// <param name="SlotGranularityMinutes">Start times fall on this grid, counted from the opening time.</param>
/// <param name="Slots">
/// Every start on the grid where at least one qualified bay and one qualified technician are free for the whole duration, in
/// ascending order. Empty when <c>unavailableReason</c> is set, when everything is booked, when the service is longer than that
/// day's opening hours, or on a day whose opening hours fall entirely in a daylight-saving gap.
/// </param>
/// <param name="UnavailableReason">
/// Why there can be no slots at all that day: <c>closed</c> (no opening hours on that weekday) or <c>no-qualified-resources</c>
/// (no active bay with every required capability, or no active technician with every required certification). Null otherwise,
/// including when every qualified resource is simply busy.
/// </param>
public sealed record AvailabilityResponse(
    DateOnly Date,
    string TimeZoneId,
    OperatingWindowResponse? OperatingWindow,
    int DurationMinutes,
    int SlotGranularityMinutes,
    IReadOnlyList<AvailabilitySlotResponse> Slots,
    string? UnavailableReason);

/// <summary>The dealership's opening hours on the requested date, as UTC instants and as local wall-clock times.</summary>
/// <param name="StartUtc">Opening time (inclusive), UTC.</param>
/// <param name="EndUtc">Closing time (exclusive), UTC; equal to <c>startUtc</c> when the opening hours fall entirely in a daylight-saving gap.</param>
/// <param name="OpensAtLocal">Opening time as local time with offset, <c>yyyy-MM-ddTHH:mm±hh:mm</c>, after daylight-saving resolution (a time skipped by the clocks moves to the first valid one).</param>
/// <param name="ClosesAtLocal">Closing time as local time with offset, <c>yyyy-MM-ddTHH:mm±hh:mm</c>, after daylight-saving resolution.</param>
public sealed record OperatingWindowResponse(DateTime StartUtc, DateTime EndUtc, string OpensAtLocal, string ClosesAtLocal);

/// <summary>A bookable start time, with how much capacity remains at it.</summary>
/// <param name="StartUtc">Start (inclusive), UTC. The identity of the slot: book with this value.</param>
/// <param name="EndUtc">End (exclusive), UTC: the start plus the service duration.</param>
/// <param name="StartLocal">
/// Start as local time with offset, <c>yyyy-MM-ddTHH:mm±hh:mm</c> (e.g. <c>2026-10-13T10:00+01:00</c>), for display. In the repeated
/// hour of an autumn daylight-saving change two slots show the same wall-clock time, and the offset tells them apart.
/// </param>
/// <param name="FreeBays">How many qualified bays are free for the whole slot (at least 1).</param>
/// <param name="FreeTechnicians">How many qualified technicians are free for the whole slot (at least 1).</param>
public sealed record AvailabilitySlotResponse(DateTime StartUtc, DateTime EndUtc, string StartLocal, int FreeBays, int FreeTechnicians);

/// <summary>The values of <see cref="AvailabilityResponse.UnavailableReason"/>; stable API.</summary>
public static class AvailabilityUnavailableReasons
{
    public const string Closed = "closed";
    public const string NoQualifiedResources = "no-qualified-resources";
}
