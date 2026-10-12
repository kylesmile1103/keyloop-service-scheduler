using System.Globalization;
using Keyloop.ServiceScheduler.Domain.Catalog;
using Keyloop.ServiceScheduler.Domain.Dealerships;
using Keyloop.ServiceScheduler.Infrastructure.Triage;
using Microsoft.Extensions.Time.Testing;

namespace Keyloop.ServiceScheduler.UnitTests.Triage;

public sealed class JevQuestionBuilderTests
{
    internal static readonly ServiceType Brakes = ServiceType.Create(Guid.NewGuid(), "BRAKES-PADS-DISCS", "Brake Pads & Discs",
        ServiceDuration.Create(90), [Keyloop.ServiceScheduler.Domain.Resources.BayCapability.StandardLift],
        [Keyloop.ServiceScheduler.Domain.Resources.Certification.Brakes]);
    internal static readonly Dealership Reading = Dealership.Create(Guid.NewGuid(), "Reading", "Europe/London",
        OperatingHours.MondayToFriday(new(8, 0), new(18, 0)), new(2026, 10, 12, 8, 0, 0, DateTimeKind.Utc));

    [Fact]
    public void Rubric_covers_exactly_every_seeded_service_code()
    {
        var services = Keyloop.ServiceScheduler.Infrastructure.Persistence.Seeding.ReferenceDataSeed.CreateServiceTypes();
        ServiceTriageRubric.Entries.Keys.Order().ShouldBe(services.Select(s => s.Code).Order());
        var request = JevQuestionBuilder.Build("typesafe/jev", "service due", services, Reading,
            new FakeTimeProvider(new DateTimeOffset(2026, 10, 12, 8, 0, 0, TimeSpan.Zero)), 90);
        request.Input.Questions["service"].Criteria.Select(c => c.Key).ShouldBe(services.Select(s => s.Code).Append("NONE_OF_THESE"));
    }

    [Fact]
    public void Builds_closed_service_choice_with_structured_rubric_and_untrusted_state()
    {
        var request = Build("2026-10-12T08:00:00Z");
        request.Input.State.CustomerDescription.ShouldBe("brakes squeal");
        var service = request.Input.Questions["service"];
        service.Type.ShouldBe("choice");
        service.Criteria.Select(c => c.Key).ShouldBe(["BRAKES-PADS-DISCS", "NONE_OF_THESE"]);
        service.Criteria[Brakes.Code]!["typical_symptoms"]!.ToJsonString().ShouldContain("squeal");
        service.Criteria[Brakes.Code]!["not_for"].ShouldNotBeNull();
        service.Instructions["vehicle_hint"]!.GetValue<string>().ShouldContain("electric vehicle");
    }

    [Theory]
    [InlineData("2026-10-24T23:30:00Z", "2026-10-25", "Sunday 25 October 2026")]
    [InlineData("2026-03-28T23:30:00Z", "2026-03-28", "Saturday 28 March 2026")]
    public void Dates_follow_dealership_zone_across_DST(string utc, string localToday, string todayDescription)
    {
        var question = Build(utc).Input.Questions["preferred_date"];
        question.Criteria.Count.ShouldBe(15);
        question.Criteria.First().Key.ShouldBe(localToday);
        question.Instructions["today"]!.GetValue<string>().ShouldBe(todayDescription);
        question.Instructions["time_zone"]!.GetValue<string>().ShouldBe("Europe/London");
        question.Criteria.First().Value!.GetValue<string>().ShouldContain("today");
        question.Criteria.Skip(1).First().Value!.GetValue<string>().ShouldContain("tomorrow");
        question.Criteria["2026-" + (utc.Contains("10-24", StringComparison.Ordinal) ? "10-25" : "03-29")]!
            .GetValue<string>().ShouldContain("workshop closed");
    }

    [Fact]
    public void Horizon_is_converted_from_the_last_bookable_instant_to_local_date()
    {
        var request = Build("2026-10-12T23:30:00Z", horizon: 2);
        var dates = request.Input.Questions["preferred_date"].Criteria;
        dates.Select(c => c.Key).ShouldBe(["2026-10-13", "2026-10-14", "2026-10-15", "NO_SPECIFIC_DATE"]);
    }

    private static JevRequest Build(string utc, int horizon = 90) => JevQuestionBuilder.Build("typesafe/jev", "  brakes squeal  ",
        [Brakes], Reading, new FakeTimeProvider(DateTimeOffset.Parse(utc, CultureInfo.InvariantCulture)), horizon);
}
