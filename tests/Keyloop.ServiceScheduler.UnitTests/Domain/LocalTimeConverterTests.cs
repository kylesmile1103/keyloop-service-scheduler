using Keyloop.ServiceScheduler.Domain.Dealerships;

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
        LocalTimeConverter.FormatLocal(utc, London).ShouldBe("2026-03-29T02:00+01:00");
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
        LocalTimeConverter.FormatLocal(utc, London).ShouldBe("2026-10-25T01:30+01:00");
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
        LocalTimeConverter.FormatLocal(utc, London).ShouldBe("2026-10-13T09:15+01:00");
        LocalTimeConverter.ToUtc(date, time, Berlin).ShouldBe(new DateTime(2026, 10, 13, 7, 15, 0, DateTimeKind.Utc));
    }

    [Fact]
    public void FormatLocal_tells_the_two_occurrences_of_a_repeated_wall_clock_time_apart()
    {
        // 2026-10-25 in Europe/London: 01:30 happens at 00:30Z (BST, +01:00) and again at 01:30Z (GMT, +00:00). The offset is the
        // only part of the string that differs, which is why every *Local value in the API carries it.
        var first = LocalTimeConverter.FormatLocal(new DateTime(2026, 10, 25, 0, 30, 0, DateTimeKind.Utc), London);
        var second = LocalTimeConverter.FormatLocal(new DateTime(2026, 10, 25, 1, 30, 0, DateTimeKind.Utc), London);

        first.ShouldBe("2026-10-25T01:30+01:00");
        second.ShouldBe("2026-10-25T01:30+00:00");
        first.ShouldNotBe(second);
        DateTimeOffset.Parse(first, System.Globalization.CultureInfo.InvariantCulture).UtcDateTime.ShouldBe(new DateTime(2026, 10, 25, 0, 30, 0, DateTimeKind.Utc));
        DateTimeOffset.Parse(second, System.Globalization.CultureInfo.InvariantCulture).UtcDateTime.ShouldBe(new DateTime(2026, 10, 25, 1, 30, 0, DateTimeKind.Utc));
    }

    [Fact]
    public void FormatLocal_uses_the_zone_offset_not_the_machine_offset()
    {
        var utc = new DateTime(2026, 10, 13, 5, 30, 0, DateTimeKind.Utc);

        LocalTimeConverter.FormatLocal(utc, Berlin).ShouldBe("2026-10-13T07:30+02:00");
        LocalTimeConverter.FormatLocal(utc, TimeZoneInfo.Utc).ShouldBe("2026-10-13T05:30+00:00");
        LocalTimeConverter.FormatLocal(utc, TimeZoneInfo.FindSystemTimeZoneById("America/New_York")).ShouldBe("2026-10-13T01:30-04:00");
    }

    [Fact]
    public void ToLocalDate_crosses_midnight()
    {
        var utc = new DateTime(2026, 7, 1, 23, 30, 0, DateTimeKind.Utc); // 01:30 CEST on 2 July

        LocalTimeConverter.ToLocalDate(utc, Berlin).ShouldBe(new DateOnly(2026, 7, 2));
        LocalTimeConverter.ToLocalDate(utc, London).ShouldBe(new DateOnly(2026, 7, 2));
        LocalTimeConverter.ToLocalDate(utc, TimeZoneInfo.Utc).ShouldBe(new DateOnly(2026, 7, 1));
    }

    [Fact]
    public void ToLocalDate_rejects_non_utc_instant()
    {
        var unspecified = new DateTime(2026, 10, 13, 8, 0, 0, DateTimeKind.Unspecified);
        Should.Throw<ArgumentException>(() => LocalTimeConverter.ToLocalDate(unspecified, London)).ParamName.ShouldBe("utc");
    }

    [Fact]
    public void FormatLocal_rejects_non_utc_instant()
    {
        var local = new DateTime(2026, 10, 13, 8, 0, 0, DateTimeKind.Local);
        Should.Throw<ArgumentException>(() => LocalTimeConverter.FormatLocal(local, London)).ParamName.ShouldBe("utc");
    }
}
