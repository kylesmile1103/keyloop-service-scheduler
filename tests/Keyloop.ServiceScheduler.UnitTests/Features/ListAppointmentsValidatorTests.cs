using Keyloop.ServiceScheduler.Api.Features.Appointments.ListAppointments;
using Keyloop.ServiceScheduler.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.UnitTests.Features;

public sealed class ListAppointmentsValidatorTests
{
    private readonly ListAppointmentsValidator _validator = new();

    [Theory]
    [InlineData("2026-10-25", "2026-10-25")]
    [InlineData("2026-10-12", "2026-12-12")] // 62 inclusive days
    [InlineData("2025-01-01", "2025-01-02")]
    [InlineData("0001-01-01", "0001-01-01")]
    [InlineData("9999-12-31", "9999-12-31")]
    public void Accepts_an_inclusive_range_of_at_most_62_calendar_days(string from, string to) =>
        _validator.Validate(Query(from, to)).IsValid.ShouldBeTrue();

    [Theory]
    [InlineData(null, "2026-10-13", "From")]
    [InlineData("", "2026-10-13", "From")]
    [InlineData("   ", "2026-10-13", "From")]
    [InlineData("2026-10-12", null, "To")]
    [InlineData("2026-10-12", "", "To")]
    [InlineData("2026-10-12", "   ", "To")]
    [InlineData("10/12/2026", "2026-10-13", "From")]
    [InlineData("2026-10-12", "13/10/2026", "To")]
    [InlineData("2026-02-30", "2026-10-13", "From")]
    [InlineData("2026-1-2", "2026-10-13", "From")]
    [InlineData("2026-10-12T00:00Z", "2026-10-13", "From")]
    [InlineData("2026-10-12", " 2026-10-13", "To")]
    [InlineData("2026-10-14", "2026-10-13", "To")]
    [InlineData("2026-10-12", "2026-12-13", "To")] // 63 inclusive days
    public void Rejects_missing_malformed_reversed_or_overlong_dates(string? from, string? to, string field)
    {
        var failure = _validator.Validate(Query(from, to)).Errors.ShouldHaveSingleItem();
        failure.PropertyName.ShouldBe(field);
    }

    [Fact]
    public void Accepts_all_status_names_and_repeated_values()
    {
        _validator.Validate(Query("2026-10-12", "2026-10-13") with
        {
            Status = [.. Enum.GetNames<AppointmentStatus>(), "Completed"],
        }).IsValid.ShouldBeTrue();
    }

    [Theory]
    [InlineData("Unknown")]
    [InlineData("confirmed")]
    [InlineData("1")]
    [InlineData("Confirmed,Cancelled")]
    [InlineData("")]
    public void Rejects_any_value_other_than_a_declared_status_name(string status)
    {
        var failure = _validator.Validate(Query("2026-10-12", "2026-10-13") with { Status = ["Confirmed", status] }).Errors.ShouldHaveSingleItem();
        failure.PropertyName.ShouldBe(nameof(ListAppointmentsQuery.Status));
    }

    [Fact]
    public void Parses_dates_strictly_and_avoids_range_rules_after_parse_failures()
    {
        Query("2026-10-12", "2026-10-13").LocalFrom.ShouldBe(new DateOnly(2026, 10, 12));
        Query("2026-10-12", "2026-10-13").LocalTo.ShouldBe(new DateOnly(2026, 10, 13));
        var invalid = Query("10/12/2026", "2026-02-30");
        invalid.LocalFrom.ShouldBeNull();
        invalid.LocalTo.ShouldBeNull();
        _validator.Validate(invalid).Errors.Select(f => f.PropertyName).ShouldBe(["From", "To"]);
    }

    private static ListAppointmentsQuery Query(string? from, string? to) => new() { From = from, To = to };
}
