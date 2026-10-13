using Keyloop.ServiceScheduler.Domain.Catalog;
using Keyloop.ServiceScheduler.Domain.Dealerships;
using Keyloop.ServiceScheduler.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.UnitTests.Domain;

public class AvailabilityCalculatorTests
{
    private const int Granularity = 15;

    private static readonly OperatingWindow Window = new(At(8), At(12));
    private static readonly ServiceDuration OneHour = ServiceDuration.Create(60);
    private static readonly TimeZoneInfo London = TimeZoneInfo.FindSystemTimeZoneById("Europe/London");

    private static DateTime At(int hour, int minute = 0) => new(2026, 10, 13, hour, minute, 0, DateTimeKind.Utc);

    private static TimeSlot Busy(int fromHour, int fromMinute, int toHour, int toMinute) =>
        TimeSlot.Create(At(fromHour, fromMinute), At(toHour, toMinute));

    private static ResourceBusy Resource(params TimeSlot[] busy) => new(Guid.NewGuid(), busy);

    private static IReadOnlyList<AvailabilitySlot> Compute(IReadOnlyList<ResourceBusy> bays, IReadOnlyList<ResourceBusy> technicians) =>
        AvailabilityCalculator.Compute(Window, OneHour, Granularity, bays, technicians);

    private static IEnumerable<DateTime> Every15Minutes(DateTime first, DateTime last)
    {
        for (var t = first; t <= last; t = t.AddMinutes(Granularity))
        {
            yield return t;
        }
    }

    [Fact]
    public void Empty_day_returns_every_grid_start()
    {
        ResourceBusy[] bays = [Resource(), Resource()];
        ResourceBusy[] technicians = [Resource(), Resource(), Resource()];

        var slots = Compute(bays, technicians);

        slots.Count.ShouldBe(13);
        slots.Select(s => s.StartUtc).ShouldBe(Every15Minutes(At(8), At(11)));
        slots.ShouldAllBe(s => s.EndUtc == s.StartUtc.AddMinutes(60));
        slots.ShouldAllBe(s => s.FreeBays == bays.Length && s.FreeTechnicians == technicians.Length);
        slots.ShouldAllBe(s => s.StartUtc.Kind == DateTimeKind.Utc && s.EndUtc.Kind == DateTimeKind.Utc);
    }

    [Fact]
    public void Worked_example_from_spec()
    {
        ResourceBusy[] bays = [Resource(Busy(9, 0, 10, 0)), Resource(Busy(8, 0, 9, 30), Busy(10, 30, 11, 0))];
        ResourceBusy[] technicians = [Resource(Busy(8, 30, 9, 0)), Resource(Busy(10, 0, 12, 0))];

        var slots = Compute(bays, technicians);

        slots.Select(s => s.StartUtc).ShouldBe([At(8), At(9, 30), At(10), At(10, 15), At(10, 30), At(10, 45), At(11)]);

        // 08:15 is the trap: Bay 1 is free 08:00–09:00 and Tech B 08:00–10:00, yet 08:15 + 60 min hits Bay 1's 09:00 job.
        slots.ShouldNotContain(s => s.StartUtc == At(8, 15));

        var byStart = slots.ToDictionary(s => s.StartUtc);
        byStart[At(8)].ShouldBe(new AvailabilitySlot(At(8), At(9), FreeBays: 1, FreeTechnicians: 1));        // Bay 1 + Tech B
        byStart[At(9, 30)].ShouldBe(new AvailabilitySlot(At(9, 30), At(10, 30), FreeBays: 1, FreeTechnicians: 1)); // Bay 2 + Tech A
        byStart[At(10)].ShouldBe(new AvailabilitySlot(At(10), At(11), FreeBays: 1, FreeTechnicians: 1));      // Bay 1 + Tech A
        byStart[At(11)].ShouldBe(new AvailabilitySlot(At(11), At(12), FreeBays: 2, FreeTechnicians: 1));      // both bays + Tech A
    }

    [Fact]
    public void FeasibleStarts_match_the_worked_example()
    {
        var hour = OneHour.AsTimeSpan;

        AvailabilityCalculator.FeasibleStarts(Window, hour, [Busy(9, 0, 10, 0)])
            .ShouldBe([(At(8), At(8)), (At(10), At(11))]);
        AvailabilityCalculator.FeasibleStarts(Window, hour, [Busy(8, 0, 9, 30), Busy(10, 30, 11, 0)])
            .ShouldBe([(At(9, 30), At(9, 30)), (At(11), At(11))]);
        AvailabilityCalculator.FeasibleStarts(Window, hour, [Busy(8, 30, 9, 0)])
            .ShouldBe([(At(9), At(11))]);
        AvailabilityCalculator.FeasibleStarts(Window, hour, [Busy(10, 0, 12, 0)])
            .ShouldBe([(At(8), At(9))]);
    }

    [Fact]
    public void Union_of_free_sets_is_not_used()
    {
        // Bay 1 is free 08:00–08:30 and Bay 2 from 08:30: together they cover 08:00–09:00, but neither bay alone does.
        ResourceBusy[] bays = [Resource(Busy(8, 30, 12, 0)), Resource(Busy(8, 0, 8, 30))];
        ResourceBusy[] technicians = [Resource()];

        var slots = Compute(bays, technicians);

        slots.ShouldNotContain(s => s.StartUtc == At(8));
        slots.ShouldNotContain(s => s.StartUtc == At(8, 15));
        slots.ShouldContain(s => s.StartUtc == At(8, 30));
        slots.Select(s => s.StartUtc).ShouldBe(Every15Minutes(At(8, 30), At(11)));
        slots.ShouldAllBe(s => s.FreeBays == 1);
    }

    [Fact]
    public void Duration_longer_than_any_gap_yields_nothing()
    {
        // The bay's only free gaps are 08:00–08:30 and 11:30–12:00, both shorter than the 60-minute service.
        ResourceBusy[] bays = [Resource(Busy(8, 30, 11, 30))];
        ResourceBusy[] technicians = [Resource()];

        Compute(bays, technicians).ShouldBeEmpty();
    }

    [Fact]
    public void Back_to_back_bookings_leave_adjacent_slot_free()
    {
        ResourceBusy[] bays = [Resource(Busy(9, 0, 10, 0))];
        ResourceBusy[] technicians = [Resource()];

        var slots = Compute(bays, technicians);

        // 08:00–09:00 ends exactly where the booking starts and 10:00–11:00 starts exactly where it ends (half-open).
        slots.Select(s => s.StartUtc).ShouldBe([At(8), At(10), At(10, 15), At(10, 30), At(10, 45), At(11)]);
    }

    [Fact]
    public void Fully_booked_resource_class_yields_nothing()
    {
        ResourceBusy[] bays = [Resource(), Resource()];
        ResourceBusy[] technicians =
        [
            Resource(Busy(8, 0, 12, 0)),
            Resource(TimeSlot.Create(At(7), At(13))), // extends beyond the window on both sides
        ];

        Compute(bays, technicians).ShouldBeEmpty();
    }

    [Fact]
    public void Empty_resource_class_yields_nothing()
    {
        Compute([], [Resource()]).ShouldBeEmpty();
        Compute([Resource()], []).ShouldBeEmpty();
    }

    [Fact]
    public void Per_slot_counts_are_correct()
    {
        ResourceBusy[] bays = [Resource(Busy(8, 0, 9, 0)), Resource()];
        ResourceBusy[] technicians = [Resource(), Resource(Busy(10, 0, 11, 0))];

        var byStart = Compute(bays, technicians).ToDictionary(s => s.StartUtc);

        byStart[At(8)].FreeBays.ShouldBe(1);
        byStart[At(8, 45)].FreeBays.ShouldBe(1);
        byStart[At(9)].FreeBays.ShouldBe(2);
        byStart[At(9)].FreeTechnicians.ShouldBe(2);
        byStart[At(9, 15)].FreeTechnicians.ShouldBe(1); // 09:15–10:15 collides with the 10:00 job
        byStart[At(10, 45)].FreeTechnicians.ShouldBe(1);
        byStart[At(11)].FreeTechnicians.ShouldBe(2);
        byStart.Count.ShouldBe(13);
    }

    [Fact]
    public void Busy_intervals_are_normalised_before_use()
    {
        // Unsorted, overlapping (09:00–09:45 with 09:30–10:00), adjacent (10:00–10:15), clipped at both ends, and outside the window.
        TimeSlot[] busy =
        [
            TimeSlot.Create(At(10, 45), At(13)),
            Busy(9, 30, 10, 0),
            TimeSlot.Create(At(7), At(8, 15)),
            Busy(10, 0, 10, 15),
            TimeSlot.Create(At(12, 30), At(14)),
            Busy(9, 0, 9, 45),
            TimeSlot.Create(At(6), At(7)),
        ];

        var feasible = AvailabilityCalculator.FeasibleStarts(Window, TimeSpan.FromMinutes(30), busy);

        // Free: 08:15–09:00 (45 min → starts 08:15..08:30) and 10:15–10:45 (30 min → exactly 10:15).
        feasible.ShouldBe([(At(8, 15), At(8, 30)), (At(10, 15), At(10, 15))]);

        // A slot nested inside a longer one must not shorten the merged busy run.
        AvailabilityCalculator.FeasibleStarts(Window, TimeSpan.FromMinutes(30), [Busy(8, 0, 11, 0), Busy(8, 30, 9, 0)])
            .ShouldBe([(At(11), At(11, 30))]);
    }

    [Fact]
    public void FeasibleStarts_of_an_idle_resource_span_the_whole_window()
    {
        AvailabilityCalculator.FeasibleStarts(Window, OneHour.AsTimeSpan, []).ShouldBe([(At(8), At(11))]);
        AvailabilityCalculator.FeasibleStarts(Window, TimeSpan.FromHours(4), []).ShouldBe([(At(8), At(8))]);
        AvailabilityCalculator.FeasibleStarts(Window, TimeSpan.FromHours(5), []).ShouldBeEmpty();
    }

    [Fact]
    public void Grid_is_anchored_at_the_window_start()
    {
        var window = new OperatingWindow(At(8, 30), At(10));

        var slots = AvailabilityCalculator.Compute(window, OneHour, 20, [Resource()], [Resource()]);

        // 09:10 + 60 min ends at 10:10, after closing.
        slots.Select(s => s.StartUtc).ShouldBe([At(8, 30), At(8, 50)]);
    }

    [Fact]
    public void Zero_length_window_yields_no_slots()
    {
        // Dealership.ResolveOperatingWindow returns End == Start when opening and closing both fall inside a DST gap.
        ResourceBusy[] one = [Resource()];

        AvailabilityCalculator.Compute(new OperatingWindow(At(8), At(8)), OneHour, Granularity, one, one).ShouldBeEmpty();
        AvailabilityCalculator.Compute(new OperatingWindow(At(8), At(8)), OneHour, Granularity, [], []).ShouldBeEmpty();

        // Other arguments are still validated, and a window that ends before it starts is still a programming error.
        Should.Throw<ArgumentOutOfRangeException>(() => AvailabilityCalculator.Compute(new OperatingWindow(At(8), At(8)), OneHour, 0, one, one));
        Should.Throw<ArgumentException>(() => AvailabilityCalculator.Compute(new OperatingWindow(At(8), At(8).AddTicks(-1)), OneHour, Granularity, one, one))
            .ParamName.ShouldBe("window");
    }

    [Fact]
    public void Compute_validates_arguments()
    {
        ResourceBusy[] one = [Resource()];

        Should.Throw<ArgumentOutOfRangeException>(() => AvailabilityCalculator.Compute(Window, OneHour, 0, one, one));
        Should.Throw<ArgumentOutOfRangeException>(() => AvailabilityCalculator.Compute(Window, OneHour, -15, one, one));
        Should.Throw<ArgumentException>(() => AvailabilityCalculator.Compute(new OperatingWindow(At(12), At(8)), OneHour, Granularity, one, one))
            .ParamName.ShouldBe("window");
        Should.Throw<ArgumentException>(() => AvailabilityCalculator.Compute(
                new OperatingWindow(DateTime.SpecifyKind(At(8), DateTimeKind.Unspecified), At(12)), OneHour, Granularity, one, one))
            .ParamName.ShouldBe("window");
        Should.Throw<ArgumentException>(() => AvailabilityCalculator.Compute(Window, default, Granularity, one, one))
            .ParamName.ShouldBe("duration");
        Should.Throw<ArgumentNullException>(() => AvailabilityCalculator.Compute(Window, OneHour, Granularity, null!, one)).ParamName.ShouldBe("bays");
        Should.Throw<ArgumentNullException>(() => AvailabilityCalculator.Compute(Window, OneHour, Granularity, one, null!)).ParamName.ShouldBe("technicians");
        Should.Throw<ArgumentException>(() => AvailabilityCalculator.Compute(Window, OneHour, Granularity, [null!], one)).ParamName.ShouldBe("bays");
        Should.Throw<ArgumentException>(() => AvailabilityCalculator.Compute(Window, OneHour, Granularity, one, [new ResourceBusy(Guid.NewGuid(), null!)]))
            .ParamName.ShouldBe("technicians");
        Should.Throw<ArgumentException>(() => AvailabilityCalculator.Compute(Window, OneHour, Granularity, [new ResourceBusy(Guid.NewGuid(), [null!])], one))
            .ParamName.ShouldBe("bays");
    }

    [Fact]
    public void FreeResourcesAt_excludes_overlapping()
    {
        var early = Resource(Busy(9, 0, 10, 0));
        var late = Resource(Busy(10, 0, 11, 0));
        var idle = Resource();
        ResourceBusy[] resources = [early, late, idle];

        AvailabilityCalculator.FreeResourcesAt(Busy(9, 30, 10, 30), resources).ShouldBe([idle.ResourceId]);
        AvailabilityCalculator.FreeResourcesAt(Busy(10, 0, 11, 0), resources).ShouldBe([early.ResourceId, idle.ResourceId]); // half-open: adjacent is free
        AvailabilityCalculator.FreeResourcesAt(Busy(8, 0, 9, 0), resources).ShouldBe([early.ResourceId, late.ResourceId, idle.ResourceId]);
        AvailabilityCalculator.FreeResourcesAt(Busy(8, 0, 9, 0), []).ShouldBeEmpty();

        Should.Throw<ArgumentNullException>(() => AvailabilityCalculator.FreeResourcesAt(null!, resources)).ParamName.ShouldBe("slot");
        Should.Throw<ArgumentNullException>(() => AvailabilityCalculator.FreeResourcesAt(Busy(8, 0, 9, 0), null!)).ParamName.ShouldBe("resources");
    }

    [Fact]
    public void Nearest_returns_closest_three_with_earlier_tie_break()
    {
        AvailabilitySlot[] slots = [.. new[] { At(8), At(9), At(9, 30), At(10, 30), At(11) }.Select(t => new AvailabilitySlot(t, t.AddHours(1), 1, 1))];

        // Distances from 10:00: 120, 60, 30, 30, 60 minutes.
        var nearest = AvailabilityCalculator.Nearest(slots, At(10), 3);

        nearest.Select(s => s.StartUtc).ShouldBe([At(9, 30), At(10, 30), At(9)]);
        AvailabilityCalculator.Nearest([.. slots.Reverse()], At(10), 3).Select(s => s.StartUtc).ShouldBe([At(9, 30), At(10, 30), At(9)]);
        AvailabilityCalculator.Nearest(slots, At(10), 10).Select(s => s.StartUtc).ShouldBe([At(9, 30), At(10, 30), At(9), At(11), At(8)]);
        AvailabilityCalculator.Nearest(slots, At(10), 0).ShouldBeEmpty();
        AvailabilityCalculator.Nearest(slots, At(10), -1).ShouldBeEmpty();
        AvailabilityCalculator.Nearest([], At(10), 3).ShouldBeEmpty();
        Should.Throw<ArgumentNullException>(() => AvailabilityCalculator.Nearest(null!, At(10), 3)).ParamName.ShouldBe("slots");
    }

    [Fact]
    public void Spring_forward_window_has_no_duplicate_starts()
    {
        var day = new DateOnly(2026, 3, 29); // Europe/London moves to BST at 01:00Z
        var window = new OperatingWindow(
            LocalTimeConverter.ToUtc(day, new TimeOnly(8, 0), London),
            LocalTimeConverter.ToUtc(day, new TimeOnly(18, 0), London));

        var starts = AvailabilityCalculator.Compute(window, OneHour, Granularity, [Resource()], [Resource()]).Select(s => s.StartUtc).ToList();

        window.StartUtc.ShouldBe(new DateTime(2026, 3, 29, 7, 0, 0, DateTimeKind.Utc));
        starts.Distinct().Count().ShouldBe(starts.Count);
        starts.Zip(starts.Skip(1), (a, b) => b - a).ShouldAllBe(step => step == TimeSpan.FromMinutes(Granularity));
        starts[0].ShouldBe(window.StartUtc);
        starts[^1].ShouldBe(window.EndUtc.AddMinutes(-60));
        starts.Count.ShouldBe(37); // 07:00Z … 16:00Z
    }

    [Theory]
    [InlineData(2026, 3, 29, 5)]  // spring forward: the 00:00–06:00 local window lasts 5 hours
    [InlineData(2026, 10, 25, 7)] // fall back: the same wall-clock window lasts 7 hours
    public void Window_spanning_a_dst_transition_keeps_a_unique_utc_grid(int year, int month, int dayOfMonth, int absoluteHours)
    {
        var day = new DateOnly(year, month, dayOfMonth);
        var window = new OperatingWindow(
            LocalTimeConverter.ToUtc(day, new TimeOnly(0, 0), London),
            LocalTimeConverter.ToUtc(day, new TimeOnly(6, 0), London));

        var starts = AvailabilityCalculator.Compute(window, OneHour, Granularity, [Resource()], [Resource()]).Select(s => s.StartUtc).ToList();

        (window.EndUtc - window.StartUtc).ShouldBe(TimeSpan.FromHours(absoluteHours));
        starts.Distinct().Count().ShouldBe(starts.Count);
        starts.Zip(starts.Skip(1), (a, b) => b - a).ShouldAllBe(step => step == TimeSpan.FromMinutes(Granularity));
        starts.Count.ShouldBe(((absoluteHours - 1) * 4) + 1);
    }
}
