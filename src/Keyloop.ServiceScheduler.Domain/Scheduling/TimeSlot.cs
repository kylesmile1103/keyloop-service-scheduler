using Keyloop.ServiceScheduler.Domain.Catalog;
using Keyloop.ServiceScheduler.Domain.Dealerships;

namespace Keyloop.ServiceScheduler.Domain.Scheduling;

/// <summary>Half-open UTC interval [StartUtc, EndUtc).</summary>
public sealed record TimeSlot
{
    private TimeSlot(DateTime startUtc, DateTime endUtc)
    {
        StartUtc = startUtc;
        EndUtc = endUtc;
    }

    public DateTime StartUtc { get; }

    public DateTime EndUtc { get; }

    public TimeSpan Duration => EndUtc - StartUtc;

    public static TimeSlot Create(DateTime startUtc, DateTime endUtc)
    {
        if (startUtc.Kind != DateTimeKind.Utc)
        {
            throw new ArgumentException("Start must be a UTC DateTime.", nameof(startUtc));
        }

        if (endUtc.Kind != DateTimeKind.Utc)
        {
            throw new ArgumentException("End must be a UTC DateTime.", nameof(endUtc));
        }

        if (endUtc <= startUtc)
        {
            throw new ArgumentException("End must be after start.", nameof(endUtc));
        }

        return new TimeSlot(startUtc, endUtc);
    }

    public static TimeSlot FromStart(DateTime startUtc, ServiceDuration duration) =>
        Create(startUtc, startUtc + duration.AsTimeSpan);

    public bool Overlaps(TimeSlot other)
    {
        ArgumentNullException.ThrowIfNull(other);
        return StartUtc < other.EndUtc && other.StartUtc < EndUtc;
    }

    public bool IsWithin(OperatingWindow window) => window.Contains(this);
}
