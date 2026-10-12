using Keyloop.ServiceScheduler.Domain.Dealerships;

namespace Keyloop.ServiceScheduler.UnitTests.Domain;

public class OperatingHoursTests
{
    private static readonly TimeOnly Eight = new(8, 0);
    private static readonly TimeOnly Thirteen = new(13, 0);
    private static readonly TimeOnly Eighteen = new(18, 0);
    private static readonly DateTime CreatedAt = new(2026, 10, 12, 8, 0, 0, DateTimeKind.Utc);

    private static Dealership Reading() =>
        Dealership.Create(Guid.NewGuid(), "Keyloop Motors Reading", "Europe/London", OperatingHours.MondayToFriday(Eight, Eighteen, Thirteen), CreatedAt);

    private static DayOperatingHours Open(DayOfWeek day) => new(day, Eight, Eighteen);

    [Fact]
    public void Create_requires_all_seven_days()
    {
        var sixDays = Enum.GetValues<DayOfWeek>().Where(d => d != DayOfWeek.Sunday).Select(Open).ToList();
        Should.Throw<ArgumentException>(() => OperatingHours.Create(sixDays));

        var duplicateMonday = sixDays.Append(Open(DayOfWeek.Monday)).ToList();
        duplicateMonday.Count.ShouldBe(7);
        Should.Throw<ArgumentException>(() => OperatingHours.Create(duplicateMonday));

        var hours = OperatingHours.Create(Enum.GetValues<DayOfWeek>().Reverse().Select(Open));
        hours.Days.Select(d => d.Day).ShouldBe(Enum.GetValues<DayOfWeek>());
        hours.ForDay(DayOfWeek.Wednesday).ShouldBe(Open(DayOfWeek.Wednesday));
    }

    [Fact]
    public void Closed_day_has_null_times()
    {
        var sunday = new DayOperatingHours(DayOfWeek.Sunday, null, null);
        sunday.IsClosed.ShouldBeTrue();
        sunday.OpensAt.ShouldBeNull();
        sunday.ClosesAt.ShouldBeNull();

        Should.Throw<ArgumentException>(() => new DayOperatingHours(DayOfWeek.Sunday, Eight, null));
        Should.Throw<ArgumentException>(() => new DayOperatingHours(DayOfWeek.Sunday, null, Eighteen));

        var hours = OperatingHours.MondayToFriday(Eight, Eighteen);
        hours.ForDay(DayOfWeek.Saturday).IsClosed.ShouldBeTrue();
        hours.ForDay(DayOfWeek.Sunday).IsClosed.ShouldBeTrue();
        hours.ForDay(DayOfWeek.Friday).ShouldBe(new DayOperatingHours(DayOfWeek.Friday, Eight, Eighteen));
        hours.ForDay(DayOfWeek.Friday).IsClosed.ShouldBeFalse();

        var withSaturday = OperatingHours.MondayToFriday(Eight, Eighteen, Thirteen);
        withSaturday.ForDay(DayOfWeek.Saturday).ShouldBe(new DayOperatingHours(DayOfWeek.Saturday, Eight, Thirteen));
        withSaturday.ForDay(DayOfWeek.Sunday).IsClosed.ShouldBeTrue();
    }

    [Theory]
    [InlineData(true, 300000000L)] // seconds on opening
    [InlineData(false, 300000000L)] // seconds on closing
    [InlineData(true, 1L)] // fractional tick on opening
    [InlineData(false, 1L)] // fractional tick on closing
    public void Rejects_subminute_operating_hours_on_either_bound(bool opening, long extraTicks)
    {
        var opens = opening ? Eight.Add(TimeSpan.FromTicks(extraTicks)) : Eight;
        var closes = opening ? Eighteen : Eighteen.Add(TimeSpan.FromTicks(extraTicks));

        Should.Throw<ArgumentException>(() => new DayOperatingHours(DayOfWeek.Tuesday, opens, closes))
            .ParamName.ShouldBe(opening ? "opensAt" : "closesAt");
    }

    [Fact]
    public void Accepts_whole_minutes_without_requiring_the_default_slot_grid()
    {
        var hours = new DayOperatingHours(DayOfWeek.Tuesday, new TimeOnly(8, 7), new TimeOnly(18, 11));
        hours.OpensAt.ShouldBe(new TimeOnly(8, 7));
        hours.ClosesAt.ShouldBe(new TimeOnly(18, 11));
    }

    [Fact]
    public void Rejects_closes_before_opens()
    {
        Should.Throw<ArgumentException>(() => new DayOperatingHours(DayOfWeek.Monday, Eighteen, Eight));
        Should.Throw<ArgumentException>(() => new DayOperatingHours(DayOfWeek.Monday, Eight, Eight));
    }

    [Fact]
    public void ResolveOperatingWindow_returns_null_on_closed_day() =>
        Reading().ResolveOperatingWindow(new DateOnly(2026, 10, 18)).ShouldBeNull(); // Sunday

    [Fact]
    public void ResolveOperatingWindow_converts_london_bst()
    {
        var window = Reading().ResolveOperatingWindow(new DateOnly(2026, 7, 1)).ShouldNotBeNull(); // Wednesday, UTC+1
        window.StartUtc.ShouldBe(new DateTime(2026, 7, 1, 7, 0, 0, DateTimeKind.Utc));
        window.EndUtc.ShouldBe(new DateTime(2026, 7, 1, 17, 0, 0, DateTimeKind.Utc));
        window.StartUtc.Kind.ShouldBe(DateTimeKind.Utc);
        window.EndUtc.Kind.ShouldBe(DateTimeKind.Utc);
    }

    [Fact]
    public void ResolveOperatingWindow_converts_london_gmt()
    {
        var window = Reading().ResolveOperatingWindow(new DateOnly(2026, 1, 15)).ShouldNotBeNull(); // Thursday, UTC+0
        window.StartUtc.ShouldBe(new DateTime(2026, 1, 15, 8, 0, 0, DateTimeKind.Utc));
        window.EndUtc.ShouldBe(new DateTime(2026, 1, 15, 18, 0, 0, DateTimeKind.Utc));
    }

    [Fact]
    public void ResolveOperatingWindow_uses_saturday_hours()
    {
        var window = Reading().ResolveOperatingWindow(new DateOnly(2026, 10, 17)).ShouldNotBeNull(); // Saturday, BST
        window.StartUtc.ShouldBe(new DateTime(2026, 10, 17, 7, 0, 0, DateTimeKind.Utc));
        window.EndUtc.ShouldBe(new DateTime(2026, 10, 17, 12, 0, 0, DateTimeKind.Utc));
    }

    [Fact]
    public void ResolveOperatingWindow_follows_the_offset_on_dst_change_days()
    {
        var everyDay = OperatingHours.Create(Enum.GetValues<DayOfWeek>().Select(Open));
        var dealership = Dealership.Create(Guid.NewGuid(), "Keyloop Motors Reading", "Europe/London", everyDay, CreatedAt);

        // Sunday 2026-03-29: clocks go forward at 01:00 GMT, so the day opens and closes on BST (UTC+1).
        var springForward = dealership.ResolveOperatingWindow(new DateOnly(2026, 3, 29)).ShouldNotBeNull();
        springForward.StartUtc.ShouldBe(new DateTime(2026, 3, 29, 7, 0, 0, DateTimeKind.Utc));
        springForward.EndUtc.ShouldBe(new DateTime(2026, 3, 29, 17, 0, 0, DateTimeKind.Utc));

        // Sunday 2026-10-25: clocks go back at 02:00 BST, so the day opens and closes on GMT (UTC+0).
        var fallBack = dealership.ResolveOperatingWindow(new DateOnly(2026, 10, 25)).ShouldNotBeNull();
        fallBack.StartUtc.ShouldBe(new DateTime(2026, 10, 25, 8, 0, 0, DateTimeKind.Utc));
        fallBack.EndUtc.ShouldBe(new DateTime(2026, 10, 25, 18, 0, 0, DateTimeKind.Utc));
    }

    [Fact]
    public void Dealership_create_rejects_unknown_time_zone() =>
        Should.Throw<ArgumentException>(() =>
            Dealership.Create(Guid.NewGuid(), "Nowhere Motors", "Mars/Olympus_Mons", OperatingHours.MondayToFriday(Eight, Eighteen), CreatedAt))
            .ParamName.ShouldBe("timeZoneId");

    [Fact]
    public void Dealership_create_validates_arguments()
    {
        var hours = OperatingHours.MondayToFriday(Eight, Eighteen);
        Should.Throw<ArgumentException>(() => Dealership.Create(Guid.Empty, "Reading", "Europe/London", hours, CreatedAt));
        Should.Throw<ArgumentException>(() => Dealership.Create(Guid.NewGuid(), "  ", "Europe/London", hours, CreatedAt));
        Should.Throw<ArgumentException>(() => Dealership.Create(Guid.NewGuid(), "Reading", "", hours, CreatedAt));
        Should.Throw<ArgumentNullException>(() => Dealership.Create(Guid.NewGuid(), "Reading", "Europe/London", null!, CreatedAt));
        Should.Throw<ArgumentException>(() =>
            Dealership.Create(Guid.NewGuid(), "Reading", "Europe/London", hours, new DateTime(2026, 10, 12, 8, 0, 0, DateTimeKind.Unspecified)));
    }

    [Fact]
    public void Dealership_create_sets_properties()
    {
        var id = Guid.NewGuid();
        var hours = OperatingHours.MondayToFriday(Eight, Eighteen);
        var dealership = Dealership.Create(id, " Keyloop Autohaus München ", "Europe/Berlin", hours, CreatedAt);

        dealership.Id.ShouldBe(id);
        dealership.Name.ShouldBe("Keyloop Autohaus München");
        dealership.TimeZoneId.ShouldBe("Europe/Berlin");
        dealership.TimeZone.BaseUtcOffset.ShouldBe(TimeSpan.FromHours(1));
        dealership.Hours.ShouldBeSameAs(hours);
        dealership.CreatedAtUtc.ShouldBe(CreatedAt);
    }
}
