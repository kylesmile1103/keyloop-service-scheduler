namespace Keyloop.ServiceScheduler.Api.Domain.Dealerships;

/// <summary>Weekly opening hours: exactly one <see cref="DayOperatingHours"/> per <see cref="DayOfWeek"/>.</summary>
public sealed class OperatingHours
{
    // EF Core materialisation: Days is an owned collection populated through the private setter.
    private OperatingHours() => Days = new List<DayOperatingHours>(7);

    private OperatingHours(List<DayOperatingHours> days) => Days = days;

    public IReadOnlyList<DayOperatingHours> Days { get; private set; }

    public static OperatingHours Create(IEnumerable<DayOperatingHours> days)
    {
        ArgumentNullException.ThrowIfNull(days);
        var list = days.ToList();
        if (list.Any(d => d is null))
        {
            throw new ArgumentException("Operating hours cannot contain null days.", nameof(days));
        }

        var distinctDays = list.Select(d => d.Day).Distinct().Count();
        if (list.Count != 7 || distinctDays != 7)
        {
            throw new ArgumentException($"Operating hours must define each of the 7 days exactly once (got {list.Count} entries for {distinctDays} distinct days).", nameof(days));
        }

        list.Sort((a, b) => a.Day.CompareTo(b.Day));
        return new OperatingHours(list);
    }

    /// <summary>Monday–Friday open <paramref name="opens"/>–<paramref name="closes"/>; Saturday open <paramref name="opens"/>–<paramref name="saturdayCloses"/> when given, otherwise closed; Sunday closed.</summary>
    public static OperatingHours MondayToFriday(TimeOnly opens, TimeOnly closes, TimeOnly? saturdayCloses = null) =>
        Create(Enum.GetValues<DayOfWeek>().Select(day => day switch
        {
            DayOfWeek.Sunday => new DayOperatingHours(day, null, null),
            DayOfWeek.Saturday => saturdayCloses is { } satCloses ? new DayOperatingHours(day, opens, satCloses) : new DayOperatingHours(day, null, null),
            _ => new DayOperatingHours(day, opens, closes),
        }));

    // Searched rather than indexed: an EF-materialised collection carries no ordering guarantee.
    public DayOperatingHours ForDay(DayOfWeek day) =>
        Days.FirstOrDefault(d => d.Day == day) ?? throw new InvalidOperationException($"Operating hours have no entry for {day}.");
}
