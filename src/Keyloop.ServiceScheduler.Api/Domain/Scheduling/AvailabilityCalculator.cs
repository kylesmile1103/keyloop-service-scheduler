using Keyloop.ServiceScheduler.Api.Domain.Catalog;
using Keyloop.ServiceScheduler.Api.Domain.Common;
using Keyloop.ServiceScheduler.Api.Domain.Dealerships;

namespace Keyloop.ServiceScheduler.Api.Domain.Scheduling;

/// <summary>The slots during which one bay or technician is already taken by active appointments; any order, overlaps allowed.</summary>
public sealed record ResourceBusy(Guid ResourceId, IReadOnlyList<TimeSlot> Busy);

/// <summary>A bookable start: at least one bay and one technician are free for the whole <c>[StartUtc, EndUtc)</c>.</summary>
public sealed record AvailabilitySlot(DateTime StartUtc, DateTime EndUtc, int FreeBays, int FreeTechnicians);

/// <summary>
/// Availability for one service on one operating window (SYSTEM_DESIGN §6.1–§6.2). Each resource's free time is shrunk to its
/// <em>feasible-start</em> intervals before resources are combined, so a start counts only when a single bay and a single
/// technician are each free for the full duration; the union of free sets would wrongly accept a slot that two bays cover only
/// between them.
/// </summary>
public static class AvailabilityCalculator
{
    /// <summary>
    /// Feasible start times on the granularity grid where at least one bay and at least one technician are free for the whole duration,
    /// in ascending order. Candidates are <c>window.StartUtc + k × granularity</c> with <c>start + duration ≤ window.EndUtc</c>.
    /// A zero-length window (which <see cref="Dealership.ResolveOperatingWindow"/> yields when opening and closing both fall in a DST
    /// gap) has no slots; a window that ends before it starts is a programming error.
    /// </summary>
    public static IReadOnlyList<AvailabilitySlot> Compute(
        OperatingWindow window,
        ServiceDuration duration,
        int granularityMinutes,
        IReadOnlyList<ResourceBusy> bays,
        IReadOnlyList<ResourceBusy> technicians)
    {
        ValidateWindow(window, allowEmpty: true);

        // default(ServiceDuration) bypasses ServiceDuration.Create; a zero duration would make every instant feasible.
        if (duration.Minutes <= 0)
        {
            throw new ArgumentException("Service duration must be created with ServiceDuration.Create.", nameof(duration));
        }

        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(granularityMinutes);
        ArgumentNullException.ThrowIfNull(bays);
        ArgumentNullException.ThrowIfNull(technicians);

        if (window.EndUtc == window.StartUtc)
        {
            return [];
        }

        var length = duration.AsTimeSpan;
        var bayStarts = FeasibleStartsPerResource(window, length, bays, nameof(bays));
        var technicianStarts = FeasibleStartsPerResource(window, length, technicians, nameof(technicians));
        if (bayStarts.Length == 0 || technicianStarts.Length == 0)
        {
            return [];
        }

        // Candidates only move forward, so each resource keeps a cursor into its sorted, disjoint intervals.
        var bayCursors = new int[bayStarts.Length];
        var technicianCursors = new int[technicianStarts.Length];
        var step = TimeSpan.FromMinutes(granularityMinutes);
        var slots = new List<AvailabilitySlot>();
        for (var start = window.StartUtc; start + length <= window.EndUtc; start += step)
        {
            var freeBays = CountFeasibleAt(start, bayStarts, bayCursors);
            if (freeBays == 0)
            {
                continue;
            }

            var freeTechnicians = CountFeasibleAt(start, technicianStarts, technicianCursors);
            if (freeTechnicians > 0)
            {
                slots.Add(new AvailabilitySlot(start, start + length, freeBays, freeTechnicians));
            }
        }

        return slots;
    }

    /// <summary>Ids of the resources with no busy slot overlapping <paramref name="slot"/>, in input order.</summary>
    public static IReadOnlyList<Guid> FreeResourcesAt(TimeSlot slot, IReadOnlyList<ResourceBusy> resources)
    {
        ArgumentNullException.ThrowIfNull(slot);
        ArgumentNullException.ThrowIfNull(resources);

        var free = new List<Guid>(resources.Count);
        foreach (var resource in resources)
        {
            if (!BusyOf(resource, nameof(resources)).Any(slot.Overlaps))
            {
                free.Add(resource.ResourceId);
            }
        }

        return free;
    }

    /// <summary>
    /// Closed intervals <c>[a, b − duration]</c> of feasible starts for one resource, one per free interval <c>[a, b)</c> of the window
    /// that is at least <paramref name="duration"/> long; sorted and disjoint. <paramref name="busy"/> may be unsorted, overlapping,
    /// adjacent, or extend beyond the window.
    /// </summary>
    internal static IReadOnlyList<(DateTime Start, DateTime End)> FeasibleStarts(OperatingWindow window, TimeSpan duration, IReadOnlyList<TimeSlot> busy)
    {
        ValidateWindow(window);
        ArgumentOutOfRangeException.ThrowIfLessThanOrEqual(duration, TimeSpan.Zero);
        ArgumentNullException.ThrowIfNull(busy);
        return FeasibleStartsCore(window, duration, busy, nameof(busy));
    }

    /// <summary>The <paramref name="count"/> slots closest to <paramref name="requestedStartUtc"/> by absolute distance; ties go to the earlier slot.</summary>
    public static IReadOnlyList<AvailabilitySlot> Nearest(IReadOnlyList<AvailabilitySlot> slots, DateTime requestedStartUtc, int count)
    {
        ArgumentNullException.ThrowIfNull(slots);
        Guard.Utc(requestedStartUtc, nameof(requestedStartUtc));
        if (count <= 0)
        {
            return [];
        }

        return slots
            .OrderBy(s => (s.StartUtc - requestedStartUtc).Duration())
            .ThenBy(s => s.StartUtc)
            .Take(count)
            .ToList();
    }

    private static IReadOnlyList<(DateTime Start, DateTime End)>[] FeasibleStartsPerResource(
        OperatingWindow window, TimeSpan duration, IReadOnlyList<ResourceBusy> resources, string paramName)
    {
        var result = new IReadOnlyList<(DateTime Start, DateTime End)>[resources.Count];
        for (var i = 0; i < resources.Count; i++)
        {
            result[i] = FeasibleStartsCore(window, duration, BusyOf(resources[i], paramName), paramName);
        }

        return result;
    }

    private static List<(DateTime Start, DateTime End)> FeasibleStartsCore(
        OperatingWindow window, TimeSpan duration, IReadOnlyList<TimeSlot> busy, string paramName)
    {
        // Clip to the window and drop what lies outside it; then sort by start (O(A log A)).
        var clipped = new List<(DateTime Start, DateTime End)>(busy.Count);
        foreach (var slot in busy)
        {
            if (slot is null)
            {
                throw new ArgumentException("Busy slots cannot be null.", paramName);
            }

            if (slot.StartUtc < window.EndUtc && slot.EndUtc > window.StartUtc)
            {
                clipped.Add((Max(slot.StartUtc, window.StartUtc), Min(slot.EndUtc, window.EndUtc)));
            }
        }

        clipped.Sort((x, y) => x.Start.CompareTo(y.Start));

        // Sweep: `freeFrom` is the end of the merged busy run so far, so overlapping and adjacent intervals merge implicitly
        // and every gap [freeFrom, next.Start) is a maximal free interval.
        var feasible = new List<(DateTime Start, DateTime End)>();
        var freeFrom = window.StartUtc;
        foreach (var (start, end) in clipped)
        {
            AddIfLongEnough(feasible, freeFrom, start, duration);
            freeFrom = Max(freeFrom, end);
        }

        AddIfLongEnough(feasible, freeFrom, window.EndUtc, duration);
        return feasible;
    }

    private static void AddIfLongEnough(List<(DateTime Start, DateTime End)> feasible, DateTime freeStart, DateTime freeEnd, TimeSpan duration)
    {
        // Closed at b − duration: a slot starting there ends exactly at b, which the half-open interval allows.
        if (freeEnd - freeStart >= duration)
        {
            feasible.Add((freeStart, freeEnd - duration));
        }
    }

    private static int CountFeasibleAt(DateTime start, IReadOnlyList<(DateTime Start, DateTime End)>[] feasibleStarts, int[] cursors)
    {
        var count = 0;
        for (var r = 0; r < feasibleStarts.Length; r++)
        {
            var intervals = feasibleStarts[r];
            var i = cursors[r];
            while (i < intervals.Count && intervals[i].End < start)
            {
                i++;
            }

            cursors[r] = i;
            if (i < intervals.Count && intervals[i].Start <= start)
            {
                count++;
            }
        }

        return count;
    }

    private static IReadOnlyList<TimeSlot> BusyOf(ResourceBusy? resource, string paramName)
    {
        if (resource?.Busy is null)
        {
            throw new ArgumentException("Resources and their busy lists cannot be null.", paramName);
        }

        return resource.Busy;
    }

    private static void ValidateWindow(OperatingWindow window, bool allowEmpty = false)
    {
        Guard.Utc(window.StartUtc, nameof(window));
        Guard.Utc(window.EndUtc, nameof(window));
        if (window.EndUtc < window.StartUtc || (!allowEmpty && window.EndUtc == window.StartUtc))
        {
            throw new ArgumentException("The operating window must end after it starts.", nameof(window));
        }
    }

    private static DateTime Max(DateTime a, DateTime b) => a >= b ? a : b;

    private static DateTime Min(DateTime a, DateTime b) => a <= b ? a : b;
}
