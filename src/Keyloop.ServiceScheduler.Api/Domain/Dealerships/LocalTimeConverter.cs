using System.Globalization;

namespace Keyloop.ServiceScheduler.Api.Domain.Dealerships;

/// <summary>Converts dealership wall-clock times to UTC instants and back (SYSTEM_DESIGN §6.4).</summary>
public static class LocalTimeConverter
{
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
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(utc, zone));

    public static string FormatLocal(DateTime utc, TimeZoneInfo zone) =>
        TimeZoneInfo.ConvertTimeFromUtc(utc, zone).ToString("yyyy-MM-dd'T'HH:mm", CultureInfo.InvariantCulture);
}
