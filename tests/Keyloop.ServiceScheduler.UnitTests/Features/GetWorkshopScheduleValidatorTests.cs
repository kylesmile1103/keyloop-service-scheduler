using Keyloop.ServiceScheduler.Api.Features.Schedule.GetWorkshopSchedule;

namespace Keyloop.ServiceScheduler.UnitTests.Features;

/// <summary>
/// The schedule query's shape rule: the date is required and strictly <c>yyyy-MM-dd</c>, exactly as availability's. Unlike
/// availability there is no range: past days are the board's history and later days are simply empty.
/// </summary>
public class GetWorkshopScheduleValidatorTests
{
    private static readonly Guid DealershipId = Guid.Parse("45fa64a1-baa9-8c61-b11a-ee9d7572ae3e");

    private readonly GetWorkshopScheduleValidator _validator = new();

    [Theory]
    [InlineData("2026-10-13")]
    [InlineData("2024-02-29")] // a leap day, and in the past: the board shows history
    [InlineData("0001-01-01")] // the ends of the calendar convert without error (TimeZoneInfo clamps), so they need no rule
    [InlineData("9999-12-31")]
    public void Accepts_a_well_formed_date(string date)
    {
        var result = _validator.Validate(Query(date));

        result.IsValid.ShouldBeTrue(string.Join("; ", result.Errors));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Rejects_a_missing_date(string? date)
    {
        var failure = _validator.Validate(Query(date)).Errors.ShouldHaveSingleItem();

        failure.PropertyName.ShouldBe(nameof(GetWorkshopScheduleQuery.Date));
        failure.ErrorMessage.ShouldBe("date is required, as yyyy-MM-dd.");
    }

    [Theory]
    [InlineData("13/10/2026")] // day-first
    [InlineData("10/13/2026")] // month-first: DateOnly binding would accept it; the contract does not
    [InlineData("2026-10-13T00:00")] // a date-time is not a date
    [InlineData("2026-10-13Z")]
    [InlineData("2026-1-3")]
    [InlineData("20261013")]
    [InlineData(" 2026-10-13")]
    [InlineData("2026-02-30")] // shaped right, but no such day
    [InlineData("13 Oct 2026")]
    public void Rejects_anything_but_an_iso_calendar_date(string date)
    {
        var failure = _validator.Validate(Query(date)).Errors.ShouldHaveSingleItem();

        failure.PropertyName.ShouldBe(nameof(GetWorkshopScheduleQuery.Date));
        failure.ErrorMessage.ShouldBe("date must be a calendar date in the form yyyy-MM-dd, for example 2026-10-13.");
    }

    [Fact]
    public void Exposes_the_strictly_parsed_date_and_null_for_anything_else()
    {
        Query("2026-10-13").LocalDate.ShouldBe(new DateOnly(2026, 10, 13));
        Query("10/13/2026").LocalDate.ShouldBeNull();
        Query(null).LocalDate.ShouldBeNull();
    }

    private static GetWorkshopScheduleQuery Query(string? date) => new() { DealershipId = DealershipId, Date = date };
}
