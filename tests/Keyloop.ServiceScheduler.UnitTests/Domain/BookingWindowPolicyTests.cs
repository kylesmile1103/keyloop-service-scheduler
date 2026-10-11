using Keyloop.ServiceScheduler.Api.Domain.Common;
using Keyloop.ServiceScheduler.Api.Domain.Dealerships;
using Keyloop.ServiceScheduler.Api.Domain.Scheduling;
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
        var halfPastWindow = new OperatingWindow(Utc(6, 30), Utc(17, 30)); // e.g. 07:30-18:30 Europe/Berlin
        Should.NotThrow(() => BookingWindowPolicy.EnsureAligned(Utc(6, 30), halfPastWindow, 60));
        Should.NotThrow(() => BookingWindowPolicy.EnsureAligned(Utc(7, 30), halfPastWindow, 60));
        Should.Throw<DomainRuleViolationException>(() => BookingWindowPolicy.EnsureAligned(Utc(7, 0), halfPastWindow, 60))
            .Extensions["slotGranularityMinutes"].ShouldBe(60);
    }

    [Fact]
    public void EnsureAligned_rejects_non_positive_granularity() =>
        Should.Throw<ArgumentOutOfRangeException>(() => BookingWindowPolicy.EnsureAligned(Utc(7, 0), Window, 0));
}
