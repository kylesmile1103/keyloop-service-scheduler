using System.Globalization;
using Keyloop.ServiceScheduler.Domain.Common;

namespace Keyloop.ServiceScheduler.Domain.Dealerships;

/// <summary>Converts dealership wall-clock times to UTC instants and back.</summary>
public static class LocalTimeConverter
{
    /// <summary>The format of <see cref="FormatLocal"/>: local date and time to the minute, then the offset (<c>+01:00</c>, <c>+00:00</c>, <c>-04:00</c>).</summary>
    public const string LocalFormat = "yyyy-MM-dd'T'HH:mmzzz";

    private const int MaxGapMinutes = 180;

    /// <summary>
    /// Converts a local wall-clock time to UTC. Invalid (skipped) wall time advances to the first valid instant;
    /// ambiguous wall time resolves to the earlier instant.
    /// </summary>
    public static DateTime ToUtc(DateOnly date, TimeOnly time, TimeZoneInfo zone)
    {
        ArgumentNullException.ThrowIfNull(zone);
        var local = date.ToDateTime(time, DateTimeKind.Unspecified);
        if (zone.IsInvalidTime(local))
        {
            // Spring-forward gap: walk forward to the first wall-clock minute that exists.
            var probe = local;
            for (var i = 0; i < MaxGapMinutes && zone.IsInvalidTime(probe); i++)
            {
                probe = probe.AddMinutes(1);
            }

            local = probe;
        }

        if (zone.IsAmbiguousTime(local))
        {
            // Fall-back overlap: the first occurrence is the one with the larger (daylight) offset.
            var earlierInstantOffset = zone.GetAmbiguousTimeOffsets(local).Max();
            return DateTime.SpecifyKind(local - earlierInstantOffset, DateTimeKind.Utc);
        }

        return TimeZoneInfo.ConvertTimeToUtc(local, zone);
    }

    public static DateOnly ToLocalDate(DateTime utc, TimeZoneInfo zone) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(Guard.Utc(utc, nameof(utc)), zone));

    /// <summary>
    /// Formats a UTC instant as ISO-8601 local time in <paramref name="zone"/> to the minute with the zone's UTC offset (<see cref="LocalFormat"/>).
    /// </summary>
    public static string FormatLocal(DateTime utc, TimeZoneInfo zone)
    {
        ArgumentNullException.ThrowIfNull(zone);

        // DateTimeOffset preserves the target zone's offset when formatting "zzz".
        var local = TimeZoneInfo.ConvertTime(new DateTimeOffset(Guard.Utc(utc, nameof(utc))), zone);
        return local.ToString(LocalFormat, CultureInfo.InvariantCulture);
    }
}
