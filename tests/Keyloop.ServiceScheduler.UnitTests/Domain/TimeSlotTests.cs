using Keyloop.ServiceScheduler.Domain.Catalog;
using Keyloop.ServiceScheduler.Domain.Dealerships;
using Keyloop.ServiceScheduler.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.UnitTests.Domain;

public class TimeSlotTests
{
    private static DateTime At(int hour, int minute = 0) => new(2026, 10, 13, hour, minute, 0, DateTimeKind.Utc);

    [Fact]
    public void Create_rejects_end_before_start()
    {
        Should.Throw<ArgumentException>(() => TimeSlot.Create(At(10), At(9)));
        Should.Throw<ArgumentException>(() => TimeSlot.Create(At(10), At(10)));
    }

    [Fact]
    public void Create_rejects_non_utc_kind()
    {
        var local = new DateTime(2026, 10, 13, 9, 0, 0, DateTimeKind.Local);
        var unspecified = new DateTime(2026, 10, 13, 9, 0, 0, DateTimeKind.Unspecified);
        Should.Throw<ArgumentException>(() => TimeSlot.Create(local, At(10)));
        Should.Throw<ArgumentException>(() => TimeSlot.Create(unspecified, At(10)));
        Should.Throw<ArgumentException>(() => TimeSlot.Create(At(9), unspecified));
    }

    [Fact]
    public void Overlaps_is_true_for_partial_overlap()
    {
        var a = TimeSlot.Create(At(9), At(10));
        var b = TimeSlot.Create(At(9, 30), At(10, 30));
        a.Overlaps(b).ShouldBeTrue();
        b.Overlaps(a).ShouldBeTrue();
    }

    [Fact]
    public void Overlaps_is_false_for_adjacent_slots()
    {
        var a = TimeSlot.Create(At(9), At(10));
        var b = TimeSlot.Create(At(10), At(11));
        a.Overlaps(b).ShouldBeFalse();
        b.Overlaps(a).ShouldBeFalse();
    }

    [Fact]
    public void Overlaps_is_true_when_one_contains_the_other()
    {
        var outer = TimeSlot.Create(At(9), At(12));
        var inner = TimeSlot.Create(At(10), At(11));
        outer.Overlaps(inner).ShouldBeTrue();
        inner.Overlaps(outer).ShouldBeTrue();
    }

    [Fact]
    public void FromStart_uses_duration()
    {
        var slot = TimeSlot.FromStart(At(9), ServiceDuration.Create(90));
        slot.StartUtc.ShouldBe(At(9));
        slot.EndUtc.ShouldBe(At(10, 30));
        slot.Duration.ShouldBe(TimeSpan.FromMinutes(90));
    }

    [Theory]
    [InlineData(9, 17, true)]
    [InlineData(8, 10, false)]
    [InlineData(16, 18, false)]
    [InlineData(8, 18, false)]
    [InlineData(10, 12, true)]
    public void IsWithin_respects_window_bounds(int startHour, int endHour, bool expected)
    {
        var window = new OperatingWindow(At(9), At(17));
        var slot = TimeSlot.Create(At(startHour), At(endHour));
        slot.IsWithin(window).ShouldBe(expected);
        window.Contains(slot).ShouldBe(expected);
    }
}
