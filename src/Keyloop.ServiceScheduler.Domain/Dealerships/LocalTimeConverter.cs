using System.Globalization;
using Keyloop.ServiceScheduler.Domain.Common;

namespace Keyloop.ServiceScheduler.Domain.Dealerships;

/// <summary>Converts dealership wall-clock times to UTC instants and back (SYSTEM_DESIGN §6.4).</summary>
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
    /// The instant as ISO-8601 local time in <paramref name="zone"/>, to the minute, with the zone's UTC offset at that instant
    /// (<see cref="LocalFormat"/>, e.g. <c>2026-10-13T07:30+02:00</c>). Every <c>…Local</c> string in the API uses it: the offset keeps
    /// the repeated hour of an autumn change unambiguous (Europe/London on 2026-10-25: 00:30Z is <c>01:30+01:00</c>, 01:30Z is
    /// <c>01:30+00:00</c>), and the string parses back to the same instant.
    /// </summary>
    public static string FormatLocal(DateTime utc, TimeZoneInfo zone)
    {
        ArgumentNullException.ThrowIfNull(zone);

        // A DateTimeOffset, not a DateTime: "zzz" on a DateTime formats the machine's offset, not the zone's.
        var local = TimeZoneInfo.ConvertTime(new DateTimeOffset(Guard.Utc(utc, nameof(utc))), zone);
        return local.ToString(LocalFormat, CultureInfo.InvariantCulture);
    }
}
