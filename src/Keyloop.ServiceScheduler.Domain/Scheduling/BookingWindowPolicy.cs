using System.Globalization;
using Keyloop.ServiceScheduler.Domain.Common;
using Keyloop.ServiceScheduler.Domain.Dealerships;

namespace Keyloop.ServiceScheduler.Domain.Scheduling;

/// <summary>
/// When a booking may start: inside the dealership's opening hours that day, not before now + lead time, not after now + horizon, and
/// on the slot grid.
/// </summary>
public sealed class BookingWindowPolicy(TimeProvider clock, TimeSpan minimumLeadTime, TimeSpan bookingHorizon)
{
    private const string OutsideOperatingHours = "outside-operating-hours";

    private readonly TimeProvider _clock = clock ?? throw new ArgumentNullException(nameof(clock));

    private readonly TimeSpan _minimumLeadTime = minimumLeadTime >= TimeSpan.Zero
        ? minimumLeadTime
        : throw new ArgumentOutOfRangeException(nameof(minimumLeadTime), minimumLeadTime, "Minimum lead time cannot be negative.");

    private readonly TimeSpan _bookingHorizon = bookingHorizon > minimumLeadTime
        ? bookingHorizon
        : throw new ArgumentOutOfRangeException(nameof(bookingHorizon), bookingHorizon, "Booking horizon must be longer than the minimum lead time.");

    /// <summary>
    /// The operating window that must contain <paramref name="slot"/>: the one of the dealership's local date at the slot's start.
    /// Throws <c>outside-operating-hours</c> when the dealership is closed that day (extension <c>localDate</c>) or the slot is not
    /// inside the window (extension <c>operatingWindow</c>; see <see cref="EnsureWithinOperatingHours"/>).
    /// </summary>
    public static OperatingWindow OperatingWindowFor(Dealership dealership, TimeSlot slot)
    {
        ArgumentNullException.ThrowIfNull(dealership);
        ArgumentNullException.ThrowIfNull(slot);
        var localDate = LocalTimeConverter.ToLocalDate(slot.StartUtc, dealership.TimeZone);
        var window = dealership.ResolveOperatingWindow(localDate)
            ?? throw new DomainRuleViolationException(
                OutsideOperatingHours,
                string.Create(CultureInfo.InvariantCulture, $"{dealership.Name} is closed on {localDate.DayOfWeek}s (no opening hours on {localDate:yyyy-MM-dd})."),
                new Dictionary<string, object?> { ["localDate"] = localDate });
        EnsureWithinOperatingHours(dealership, slot, window);
        return window;
    }

    /// <summary>
    /// Throws <c>outside-operating-hours</c> unless <paramref name="slot"/> lies inside <paramref name="window"/> (half-open: a slot may
    /// end exactly at closing time). The detail gives local times; the <c>operatingWindow</c> extension gives the window in UTC.
    /// </summary>
    public static void EnsureWithinOperatingHours(Dealership dealership, TimeSlot slot, OperatingWindow window)
    {
        ArgumentNullException.ThrowIfNull(dealership);
        ArgumentNullException.ThrowIfNull(slot);
        if (window.Contains(slot))
        {
            return;
        }

        var zone = dealership.TimeZone;
        string Local(DateTime utc) => LocalTimeConverter.FormatLocal(utc, zone);
        throw new DomainRuleViolationException(
            OutsideOperatingHours,
            $"The slot {Local(slot.StartUtc)} to {Local(slot.EndUtc)} is outside the operating hours of {dealership.Name} " +
            $"({Local(window.StartUtc)} to {Local(window.EndUtc)}, {dealership.TimeZoneId}).",
            // Use a named value type so the source-generated JSON context can serialize it.
            new Dictionary<string, object?> { ["operatingWindow"] = window });
    }

    /// <summary>Whether <see cref="EnsureBookable"/> would accept <paramref name="startUtc"/> now (used to filter suggestions).</summary>
    public bool IsBookable(DateTime startUtc)
    {
        Guard.Utc(startUtc, nameof(startUtc));
        var nowUtc = _clock.GetUtcNow().UtcDateTime;
        return startUtc >= nowUtc + _minimumLeadTime && startUtc <= nowUtc + _bookingHorizon;
    }

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

        EnsureWithinHorizon(startUtc, nowUtc);
    }

    /// <summary>
    /// Bounds the requested instant before slot arithmetic or time-zone conversion. Does not check lead time: operating-hours
    /// refusals still precede lead-time/grid refusals for ordinary starts inside the horizon.
    /// </summary>
    public void EnsureWithinHorizon(DateTime startUtc)
    {
        Guard.Utc(startUtc, nameof(startUtc));
        EnsureWithinHorizon(startUtc, _clock.GetUtcNow().UtcDateTime);
    }

    private void EnsureWithinHorizon(DateTime startUtc, DateTime nowUtc)
    {
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
