using Keyloop.ServiceScheduler.Api.Domain.Common;

namespace Keyloop.ServiceScheduler.Api.Domain.Dealerships;

public sealed class Dealership : AggregateRoot
{
    // EF Core materialisation.
    private Dealership()
    {
        Name = string.Empty;
        TimeZoneId = string.Empty;
        Hours = null!;
    }

    private Dealership(Guid id, string name, string timeZoneId, OperatingHours hours, DateTime createdAtUtc)
    {
        Id = id;
        Name = name;
        TimeZoneId = timeZoneId;
        Hours = hours;
        CreatedAtUtc = createdAtUtc;
    }

    public string Name { get; private set; }

    /// <summary>IANA time-zone id (e.g. <c>Europe/London</c>) that operating hours are expressed in.</summary>
    public string TimeZoneId { get; private set; }

    public OperatingHours Hours { get; private set; }

    public DateTime CreatedAtUtc { get; private set; }

    public TimeZoneInfo TimeZone => TimeZoneInfo.FindSystemTimeZoneById(TimeZoneId);

    public static Dealership Create(Guid id, string name, string timeZoneId, OperatingHours hours, DateTime nowUtc)
    {
        if (id == Guid.Empty)
        {
            throw new ArgumentException("Dealership id must not be empty.", nameof(id));
        }

        var trimmedName = Guard.Required(name, 1, 200, nameof(name));
        if (string.IsNullOrWhiteSpace(timeZoneId))
        {
            throw new ArgumentException("Time zone id is required.", nameof(timeZoneId));
        }

        try
        {
            _ = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
        }
        catch (Exception ex) when (ex is TimeZoneNotFoundException or InvalidTimeZoneException)
        {
            throw new ArgumentException($"Unknown time zone id '{timeZoneId}'.", nameof(timeZoneId), ex);
        }

        ArgumentNullException.ThrowIfNull(hours);
        if (nowUtc.Kind != DateTimeKind.Utc)
        {
            throw new ArgumentException("Creation time must be a UTC DateTime.", nameof(nowUtc));
        }

        return new Dealership(id, trimmedName, timeZoneId, hours, nowUtc);
    }

    /// <summary>The UTC operating window for a local calendar date, or null when the dealership is closed that weekday.</summary>
    public OperatingWindow? ResolveOperatingWindow(DateOnly localDate)
    {
        var day = Hours.ForDay(localDate.DayOfWeek);
        if (day.IsClosed)
        {
            return null;
        }

        var zone = TimeZone;
        return new OperatingWindow(
            LocalTimeConverter.ToUtc(localDate, day.OpensAt!.Value, zone),
            LocalTimeConverter.ToUtc(localDate, day.ClosesAt!.Value, zone));
    }
}
