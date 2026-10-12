using Keyloop.ServiceScheduler.Domain.Catalog;
using Keyloop.ServiceScheduler.Domain.Common;
using Keyloop.ServiceScheduler.Domain.Dealerships;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Microsoft.Extensions.Time.Testing;

namespace Keyloop.ServiceScheduler.UnitTests.Domain;

public class BookingWindowPolicyTests
{
    private static readonly DateTime Now = new(2026, 10, 12, 8, 0, 0, DateTimeKind.Utc);
    private static readonly TimeSpan Lead = TimeSpan.FromMinutes(60);
    private static readonly TimeSpan Horizon = TimeSpan.FromDays(90);

    private static BookingWindowPolicy Policy() => new(new FakeTimeProvider(new DateTimeOffset(Now)), Lead, Horizon);

    private static DateTime Utc(int hour, int minute) => new(2026, 10, 13, hour, minute, 0, DateTimeKind.Utc);

    private static readonly OperatingWindow Window = new(Utc(7, 0), Utc(17, 0));

    [Fact]
    public void Rejects_start_in_the_past()
    {
        var ex = Should.Throw<DomainRuleViolationException>(() => Policy().EnsureBookable(Now.AddHours(-1)));
        ex.RuleCode.ShouldBe("lead-time-not-met");
        ex.Extensions["earliestStartUtc"].ShouldBe(Now + Lead);
    }

    [Fact]
    public void Rejects_start_in_the_past_with_zero_lead_time()
    {
        var policy = new BookingWindowPolicy(new FakeTimeProvider(new DateTimeOffset(Now)), TimeSpan.Zero, Horizon);
        var ex = Should.Throw<DomainRuleViolationException>(() => policy.EnsureBookable(Now.AddMinutes(-15)));
        ex.RuleCode.ShouldBe("lead-time-not-met");
        ex.Extensions["earliestStartUtc"].ShouldBe(Now);
        Should.NotThrow(() => policy.EnsureBookable(Now));
    }

    [Fact]
    public void Rejects_start_inside_lead_time()
    {
        var ex = Should.Throw<DomainRuleViolationException>(() => Policy().EnsureBookable(Now.AddMinutes(30)));
        ex.RuleCode.ShouldBe("lead-time-not-met");
        var earliest = ex.Extensions["earliestStartUtc"].ShouldBeOfType<DateTime>();
        earliest.ShouldBe(new DateTime(2026, 10, 12, 9, 0, 0, DateTimeKind.Utc));
        earliest.Kind.ShouldBe(DateTimeKind.Utc);
    }

    [Fact]
    public void Accepts_start_at_exact_lead_time() =>
        Should.NotThrow(() => Policy().EnsureBookable(new DateTime(2026, 10, 12, 9, 0, 0, DateTimeKind.Utc)));

    [Fact]
    public void Lead_time_follows_the_clock()
    {
        var clock = new FakeTimeProvider(new DateTimeOffset(Now));
        var policy = new BookingWindowPolicy(clock, Lead, Horizon);
        var start = Now.AddMinutes(90);
        Should.NotThrow(() => policy.EnsureBookable(start));

        clock.Advance(TimeSpan.FromMinutes(31));

        Should.Throw<DomainRuleViolationException>(() => policy.EnsureBookable(start)).RuleCode.ShouldBe("lead-time-not-met");
    }

    [Fact]
    public void EnsureBookable_rejects_non_utc_start()
    {
        var unspecified = DateTime.SpecifyKind(Now.AddHours(2), DateTimeKind.Unspecified);
        Should.Throw<ArgumentException>(() => Policy().EnsureBookable(unspecified)).ParamName.ShouldBe("startUtc");
    }

    [Fact]
    public void Rejects_beyond_horizon()
    {
        var ex = Should.Throw<DomainRuleViolationException>(() => Policy().EnsureBookable(Now + Horizon + TimeSpan.FromHours(1)));
        ex.RuleCode.ShouldBe("beyond-booking-horizon");
        var latest = ex.Extensions["latestStartUtc"].ShouldBeOfType<DateTime>();
        latest.ShouldBe(new DateTime(2027, 1, 10, 8, 0, 0, DateTimeKind.Utc));
        latest.Kind.ShouldBe(DateTimeKind.Utc);
    }

    [Fact]
    public void Accepts_start_at_exact_horizon() =>
        Should.NotThrow(() => Policy().EnsureBookable(Now + Horizon));

    [Fact]
    public void Rejects_invalid_configuration()
    {
        var clock = new FakeTimeProvider(new DateTimeOffset(Now));
        Should.Throw<ArgumentNullException>(() => new BookingWindowPolicy(null!, Lead, Horizon));
        Should.Throw<ArgumentOutOfRangeException>(() => new BookingWindowPolicy(clock, TimeSpan.FromMinutes(-1), Horizon));
        Should.Throw<ArgumentOutOfRangeException>(() => new BookingWindowPolicy(clock, Lead, Lead));
    }

    [Fact]
    public void EnsureAligned_rejects_off_grid()
    {
        var ex = Should.Throw<DomainRuleViolationException>(() => BookingWindowPolicy.EnsureAligned(Utc(7, 10), Window, 15));
        ex.RuleCode.ShouldBe("slot-not-aligned");
        ex.Extensions["slotGranularityMinutes"].ShouldBe(15);

        Should.Throw<DomainRuleViolationException>(() => BookingWindowPolicy.EnsureAligned(Utc(7, 15).AddSeconds(1), Window, 15))
            .RuleCode.ShouldBe("slot-not-aligned");
    }

    [Theory]
    [InlineData(7, 0)]
    [InlineData(7, 45)]
    [InlineData(16, 45)]
    public void EnsureAligned_accepts_on_grid(int hour, int minute) =>
        Should.NotThrow(() => BookingWindowPolicy.EnsureAligned(Utc(hour, minute), Window, 15));

    [Fact]
    public void EnsureAligned_measures_the_grid_from_the_window_start()
    {
        var halfPastWindow = new OperatingWindow(Utc(6, 30), Utc(17, 30)); // e.g. 07:30-18:30 Europe/London on 2026-10-13 (BST, UTC+1)
        Should.NotThrow(() => BookingWindowPolicy.EnsureAligned(Utc(6, 30), halfPastWindow, 60));
        Should.NotThrow(() => BookingWindowPolicy.EnsureAligned(Utc(7, 30), halfPastWindow, 60));
        Should.Throw<DomainRuleViolationException>(() => BookingWindowPolicy.EnsureAligned(Utc(7, 0), halfPastWindow, 60))
            .Extensions["slotGranularityMinutes"].ShouldBe(60);
    }

    [Fact]
    public void EnsureAligned_rejects_non_utc_start()
    {
        var local = DateTime.SpecifyKind(Utc(7, 0), DateTimeKind.Local);
        Should.Throw<ArgumentException>(() => BookingWindowPolicy.EnsureAligned(local, Window, 15)).ParamName.ShouldBe("startUtc");
    }

    [Fact]
    public void EnsureAligned_rejects_non_positive_granularity() =>
        Should.Throw<ArgumentOutOfRangeException>(() => BookingWindowPolicy.EnsureAligned(Utc(7, 0), Window, 0));

    [Theory]
    [InlineData(60, true)] // exactly the lead time
    [InlineData(59, false)]
    [InlineData(-60, false)] // the past
    public void IsBookable_agrees_with_EnsureBookable_on_the_lead_time(int minutesFromNow, bool bookable)
    {
        var start = Now.AddMinutes(minutesFromNow);

        Policy().IsBookable(start).ShouldBe(bookable);
        if (!bookable)
        {
            Should.Throw<DomainRuleViolationException>(() => Policy().EnsureBookable(start));
        }
    }

    [Fact]
    public void IsBookable_agrees_with_EnsureBookable_on_the_horizon()
    {
        Policy().IsBookable(Now + Horizon).ShouldBeTrue();
        Policy().IsBookable(Now + Horizon + TimeSpan.FromMinutes(1)).ShouldBeFalse();
    }

    private static readonly Dealership Reading = Dealership.Create(
        Guid.NewGuid(), "Keyloop Motors Reading", "Europe/London", OperatingHours.MondayToFriday(new TimeOnly(8, 0), new TimeOnly(18, 0)), Now);

    private static TimeSlot Hour(DateTime startUtc) => TimeSlot.FromStart(startUtc, ServiceDuration.Create(60));

    [Theory]
    [InlineData(7, 0)] // starts exactly at opening (08:00 BST)
    [InlineData(16, 0)] // ends exactly at closing (18:00 BST), half-open
    public void OperatingWindowFor_returns_the_local_day_s_window_for_a_slot_inside_it(int hour, int minute) =>
        BookingWindowPolicy.OperatingWindowFor(Reading, Hour(Utc(hour, minute))).ShouldBe(Window);

    [Theory]
    [InlineData(16, 1)] // ends one minute after closing
    [InlineData(16, 30)]
    [InlineData(17, 30)] // starts after closing
    [InlineData(6, 45)] // starts before opening
    public void OperatingWindowFor_rejects_a_slot_outside_the_window_with_the_window(int hour, int minute)
    {
        var ex = Should.Throw<DomainRuleViolationException>(() => BookingWindowPolicy.OperatingWindowFor(Reading, Hour(Utc(hour, minute))));

        ex.RuleCode.ShouldBe("outside-operating-hours");
        ex.Extensions["operatingWindow"].ShouldBe(Window);
        ex.Message.ShouldContain("Keyloop Motors Reading (2026-10-13T08:00+01:00 to 2026-10-13T18:00+01:00, Europe/London)");
    }

    [Fact]
    public void OperatingWindowFor_rejects_a_closed_day_with_the_local_date()
    {
        var sunday = new DateTime(2026, 10, 18, 9, 0, 0, DateTimeKind.Utc);

        var ex = Should.Throw<DomainRuleViolationException>(() => BookingWindowPolicy.OperatingWindowFor(Reading, Hour(sunday)));

        ex.RuleCode.ShouldBe("outside-operating-hours");
        ex.Extensions["localDate"].ShouldBe(new DateOnly(2026, 10, 18));
        ex.Message.ShouldBe("Keyloop Motors Reading is closed on Sundays (no opening hours on 2026-10-18).");
    }

    [Fact]
    public void OperatingWindowFor_uses_the_dealership_s_local_date_not_the_utc_date()
    {
        // 23:30Z on Friday 2026-10-16 is 01:30 on Saturday in Berlin (CEST): Saturday's hours apply, and this dealership is closed then.
        var berlin = Dealership.Create(
            Guid.NewGuid(), "Autohaus Test", "Europe/Berlin", OperatingHours.MondayToFriday(new TimeOnly(0, 0), new TimeOnly(23, 0)), Now);

        var ex = Should.Throw<DomainRuleViolationException>(() =>
            BookingWindowPolicy.OperatingWindowFor(berlin, Hour(new DateTime(2026, 10, 16, 23, 30, 0, DateTimeKind.Utc))));

        ex.Extensions["localDate"].ShouldBe(new DateOnly(2026, 10, 17));
    }
}
