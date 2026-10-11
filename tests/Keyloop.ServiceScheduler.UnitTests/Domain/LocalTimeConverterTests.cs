using Keyloop.ServiceScheduler.Api.Domain.Dealerships;

namespace Keyloop.ServiceScheduler.UnitTests.Domain;

public class LocalTimeConverterTests
{
    private static readonly TimeZoneInfo London = TimeZoneInfo.FindSystemTimeZoneById("Europe/London");
    private static readonly TimeZoneInfo Berlin = TimeZoneInfo.FindSystemTimeZoneById("Europe/Berlin");

    [Fact]
    public void Spring_forward_gap_advances_to_first_valid_instant()
    {
        // 2026-03-29: London clocks jump 01:00 GMT -> 02:00 BST, so 01:30 does not exist.
        var date = new DateOnly(2026, 3, 29);
        London.IsInvalidTime(date.ToDateTime(new TimeOnly(1, 30))).ShouldBeTrue();

        var utc = LocalTimeConverter.ToUtc(date, new TimeOnly(1, 30), London);

        utc.ShouldBe(new DateTime(2026, 3, 29, 1, 0, 0, DateTimeKind.Utc));
        utc.Kind.ShouldBe(DateTimeKind.Utc);
        LocalTimeConverter.FormatLocal(utc, London).ShouldBe("2026-03-29T02:00");
    }

    [Fact]
    public void Fall_back_ambiguous_resolves_to_earlier_instant()
    {
        // 2026-10-25: London clocks fall back 02:00 BST -> 01:00 GMT, so 01:30 occurs at 00:30Z and again at 01:30Z.
        var date = new DateOnly(2026, 10, 25);
        London.IsAmbiguousTime(date.ToDateTime(new TimeOnly(1, 30))).ShouldBeTrue();

        var utc = LocalTimeConverter.ToUtc(date, new TimeOnly(1, 30), London);

        utc.ShouldBe(new DateTime(2026, 10, 25, 0, 30, 0, DateTimeKind.Utc));
        utc.Kind.ShouldBe(DateTimeKind.Utc);
        LocalTimeConverter.FormatLocal(utc, London).ShouldBe("2026-10-25T01:30");
    }

    [Fact]
    public void Normal_time_round_trips()
    {
        var date = new DateOnly(2026, 10, 13);
        var time = new TimeOnly(9, 15);

        var utc = LocalTimeConverter.ToUtc(date, time, London);

        utc.ShouldBe(new DateTime(2026, 10, 13, 8, 15, 0, DateTimeKind.Utc));
        utc.Kind.ShouldBe(DateTimeKind.Utc);
        LocalTimeConverter.ToLocalDate(utc, London).ShouldBe(date);
        LocalTimeConverter.FormatLocal(utc, London).ShouldBe("2026-10-13T09:15");
        LocalTimeConverter.ToUtc(date, time, Berlin).ShouldBe(new DateTime(2026, 10, 13, 7, 15, 0, DateTimeKind.Utc));
    }

    [Fact]
    public void ToLocalDate_crosses_midnight()
    {
        var utc = new DateTime(2026, 7, 1, 23, 30, 0, DateTimeKind.Utc); // 01:30 CEST on 2 July

        LocalTimeConverter.ToLocalDate(utc, Berlin).ShouldBe(new DateOnly(2026, 7, 2));
        LocalTimeConverter.ToLocalDate(utc, London).ShouldBe(new DateOnly(2026, 7, 2));
        LocalTimeConverter.ToLocalDate(utc, TimeZoneInfo.Utc).ShouldBe(new DateOnly(2026, 7, 1));
    }
}
