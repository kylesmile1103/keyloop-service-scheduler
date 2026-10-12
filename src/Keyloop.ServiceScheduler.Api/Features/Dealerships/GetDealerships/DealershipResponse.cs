namespace Keyloop.ServiceScheduler.Api.Features.Dealerships.GetDealerships;

/// <summary>A dealership with its time zone and weekly operating hours.</summary>
/// <param name="Id">The dealership's id; every other route is scoped by it.</param>
/// <param name="Name">Display name.</param>
/// <param name="TimeZoneId">IANA time-zone id (e.g. <c>Europe/London</c>) in which the operating hours are expressed.</param>
/// <param name="OperatingHours">Exactly seven entries, one per weekday, Monday first.</param>
public sealed record DealershipResponse(Guid Id, string Name, string TimeZoneId, IReadOnlyList<DayOperatingHoursResponse> OperatingHours);

/// <summary>Opening hours for one weekday, as wall-clock times in the dealership's time zone.</summary>
/// <param name="Day">The weekday.</param>
/// <param name="OpensAt">Opening time, <c>HH:mm</c> local; null when the dealership is closed that day.</param>
/// <param name="ClosesAt">Closing time, <c>HH:mm</c> local (exclusive); null when the dealership is closed that day.</param>
public sealed record DayOperatingHoursResponse(DayOfWeek Day, string? OpensAt, string? ClosesAt);
