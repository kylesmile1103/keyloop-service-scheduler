using System.Globalization;
using Keyloop.ServiceScheduler.Api.Domain.Common;
using Keyloop.ServiceScheduler.Api.Domain.Dealerships;

namespace Keyloop.ServiceScheduler.Api.Domain.Scheduling;

/// <summary>When a booking may start: not before now + lead time, not after now + horizon, and on the slot grid.</summary>
public sealed class BookingWindowPolicy(TimeProvider clock, TimeSpan minimumLeadTime, TimeSpan bookingHorizon)
{
    private readonly TimeProvider _clock = clock ?? throw new ArgumentNullException(nameof(clock));

    private readonly TimeSpan _minimumLeadTime = minimumLeadTime >= TimeSpan.Zero
        ? minimumLeadTime
        : throw new ArgumentOutOfRangeException(nameof(minimumLeadTime), minimumLeadTime, "Minimum lead time cannot be negative.");

    private readonly TimeSpan _bookingHorizon = bookingHorizon > minimumLeadTime
        ? bookingHorizon
        : throw new ArgumentOutOfRangeException(nameof(bookingHorizon), bookingHorizon, "Booking horizon must be longer than the minimum lead time.");

    /// <summary>Throws <c>lead-time-not-met</c> (also covers starts in the past) or <c>beyond-booking-horizon</c>.</summary>
    public void EnsureBookable(DateTime startUtc)
    {
        Guard.Utc(startUtc, nameof(startUtc));
        var nowUtc = _clock.GetUtcNow().UtcDateTime;

        var earliestStartUtc = nowUtc + _minimumLeadTime;
        if (startUtc < earliestStartUtc)
        {
            throw new DomainRuleViolationException(
                "lead-time-not-met",
                string.Create(CultureInfo.InvariantCulture, $"Appointments must start at least {_minimumLeadTime.TotalMinutes:0} minutes from now; the earliest bookable start is {earliestStartUtc:yyyy-MM-dd'T'HH:mm:ss'Z'}."),
                new Dictionary<string, object?> { ["earliestStartUtc"] = earliestStartUtc });
        }

        var latestStartUtc = nowUtc + _bookingHorizon;
        if (startUtc > latestStartUtc)
        {
            throw new DomainRuleViolationException(
                "beyond-booking-horizon",
                string.Create(CultureInfo.InvariantCulture, $"Appointments can be booked at most {_bookingHorizon.TotalDays:0.##} days ahead; the latest bookable start is {latestStartUtc:yyyy-MM-dd'T'HH:mm:ss'Z'}."),
                new Dictionary<string, object?> { ["latestStartUtc"] = latestStartUtc });
        }
    }

    /// <summary>Throws <c>slot-not-aligned</c> unless <paramref name="startUtc"/> is a whole number of granularity steps from the window start.</summary>
    public static void EnsureAligned(DateTime startUtc, OperatingWindow window, int granularityMinutes)
    {
        Guard.Utc(startUtc, nameof(startUtc));
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(granularityMinutes);

        var offset = startUtc - window.StartUtc;
        if (offset.Ticks % TimeSpan.FromMinutes(granularityMinutes).Ticks != 0)
        {
            throw new DomainRuleViolationException(
                "slot-not-aligned",
                string.Create(CultureInfo.InvariantCulture, $"Start times must fall on the {granularityMinutes}-minute grid that begins at opening time."),
                new Dictionary<string, object?> { ["slotGranularityMinutes"] = granularityMinutes });
        }
    }
}
