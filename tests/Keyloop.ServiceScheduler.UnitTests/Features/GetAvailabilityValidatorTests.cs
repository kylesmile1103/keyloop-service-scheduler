using Keyloop.ServiceScheduler.Api.Common.Options;
using Keyloop.ServiceScheduler.Api.Features.Availability.GetAvailability;
using Microsoft.Extensions.Time.Testing;

namespace Keyloop.ServiceScheduler.UnitTests.Features;

/// <summary>
/// The availability query's shape rules. The clock is Monday 2026-10-12 08:00Z with a 90-day horizon, so the accepted dates are
/// 2026-10-11 (yesterday in UTC terms) to 2027-01-11 (today + 90 + 1): loose by a day either side, because the date is local to
/// the dealership. Booking applies the exact policy.
/// </summary>
public class GetAvailabilityValidatorTests
{
    private static readonly Guid DealershipId = Guid.Parse("45fa64a1-baa9-8c61-b11a-ee9d7572ae3e");
    private static readonly Guid ServiceTypeId = Guid.Parse("3153f30d-5700-8f07-a25d-4a4ea44dfeef");

    private readonly GetAvailabilityValidator _validator = new(
        new FakeTimeProvider(new DateTimeOffset(2026, 10, 12, 8, 0, 0, TimeSpan.Zero)),
        Microsoft.Extensions.Options.Options.Create(new SchedulingOptions { BookingHorizonDays = 90 }));

    [Theory]
    [InlineData("2026-10-13")]
    [InlineData("2026-10-11")] // today − 1: the dealership's local date can be a day behind UTC
    [InlineData("2027-01-11")] // today + horizon + 1
    public void Accepts_a_well_formed_query(string date)
    {
        var result = _validator.Validate(Query(ServiceTypeId, date));

        result.IsValid.ShouldBeTrue(string.Join("; ", result.Errors));
    }

    [Theory]
    [InlineData(null, "serviceTypeId is required and must be a GUID.")]
    [InlineData("00000000-0000-0000-0000-000000000000", "serviceTypeId must not be the empty id.")]
    public void Rejects_a_missing_or_empty_service_type_id(string? serviceTypeId, string message)
    {
        var result = _validator.Validate(Query(serviceTypeId is null ? null : Guid.Parse(serviceTypeId), "2026-10-13"));

        var failure = result.Errors.ShouldHaveSingleItem();
        failure.PropertyName.ShouldBe(nameof(GetAvailabilityQuery.ServiceTypeId));
        failure.ErrorMessage.ShouldBe(message);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Rejects_a_missing_date(string? date)
    {
        var failure = _validator.Validate(Query(ServiceTypeId, date)).Errors.ShouldHaveSingleItem();

        failure.PropertyName.ShouldBe(nameof(GetAvailabilityQuery.Date));
        failure.ErrorMessage.ShouldBe("date is required, as yyyy-MM-dd.");
    }

    [Theory]
    [InlineData("13/10/2026")] // day-first: not a date in the invariant culture, and never re-read as one
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
        var failure = _validator.Validate(Query(ServiceTypeId, date)).Errors.ShouldHaveSingleItem();

        failure.PropertyName.ShouldBe(nameof(GetAvailabilityQuery.Date));
        failure.ErrorMessage.ShouldBe("date must be a calendar date in the form yyyy-MM-dd, for example 2026-10-13.");
    }

    [Theory]
    [InlineData("2026-10-10")] // today − 2
    [InlineData("2027-01-12")] // today + horizon + 2
    public void Rejects_a_date_outside_the_loose_booking_range(string date)
    {
        var failure = _validator.Validate(Query(ServiceTypeId, date)).Errors.ShouldHaveSingleItem();

        failure.PropertyName.ShouldBe(nameof(GetAvailabilityQuery.Date));
        failure.ErrorMessage.ShouldBe("date must be between 2026-10-11 and 2027-01-11.");
    }

    [Fact]
    public void Exposes_the_strictly_parsed_date_and_null_for_anything_else()
    {
        Query(ServiceTypeId, "2026-10-13").LocalDate.ShouldBe(new DateOnly(2026, 10, 13));
        Query(ServiceTypeId, "10/13/2026").LocalDate.ShouldBeNull();
        Query(ServiceTypeId, null).LocalDate.ShouldBeNull();
    }

    private static GetAvailabilityQuery Query(Guid? serviceTypeId, string? date) =>
        new() { DealershipId = DealershipId, ServiceTypeId = serviceTypeId, Date = date };
}
