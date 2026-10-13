namespace Keyloop.ServiceScheduler.Domain.Dealerships;

/// <summary>Whole-minute wall-clock opening hours for one weekday in the dealership's time zone. A closed day has both times null.</summary>
public sealed record DayOperatingHours
{
    public DayOperatingHours(DayOfWeek day, TimeOnly? opensAt, TimeOnly? closesAt)
    {
        if (!Enum.IsDefined(day))
        {
            throw new ArgumentOutOfRangeException(nameof(day), day, "Unknown day of week.");
        }

        if (opensAt.HasValue != closesAt.HasValue)
        {
            throw new ArgumentException($"{day}: opening and closing times must both be set, or both be null for a closed day.", nameof(closesAt));
        }

        if (opensAt is { } opens && opens.Ticks % TimeSpan.TicksPerMinute != 0)
        {
            throw new ArgumentException("Opening time must be a whole minute, without seconds or fractions.", nameof(opensAt));
        }

        if (closesAt is { } closes && closes.Ticks % TimeSpan.TicksPerMinute != 0)
        {
            throw new ArgumentException("Closing time must be a whole minute, without seconds or fractions.", nameof(closesAt));
        }

        if (closesAt <= opensAt)
        {
            throw new ArgumentException($"{day}: closing time must be after opening time.", nameof(closesAt));
        }

        Day = day;
        OpensAt = opensAt;
        ClosesAt = closesAt;
    }

    public DayOfWeek Day { get; private init; }

    public TimeOnly? OpensAt { get; private init; }

    public TimeOnly? ClosesAt { get; private init; }

    public bool IsClosed => OpensAt is null;
}
