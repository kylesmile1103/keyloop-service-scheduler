using Keyloop.ServiceScheduler.Api.Features.Triage;
using Keyloop.ServiceScheduler.Api.Features.Triage.TriageBookingRequest;
using Keyloop.ServiceScheduler.Domain.Catalog;
using Keyloop.ServiceScheduler.Infrastructure.Triage;

namespace Keyloop.ServiceScheduler.UnitTests.Triage;

public sealed class TriageResponseMapperTests
{
    [Theory]
    [InlineData(1.0, "suggest")]
    [InlineData(0.5, "suggest")]
    [InlineData(0.49999, "confirm")]
    // Clef-flash live golden set (2026-10-12): clear requests scored 0.38 to 0.88 (0.64 for "brakes squeal when stopping"),
    // the vague "something feels odd" 0.19.
    [InlineData(0.64, "suggest")]
    [InlineData(0.19, "confirm")]
    [InlineData(0.0, "confirm")]
    public void Confidence_threshold_is_inclusive_and_distinct_from_probability(double confidence, string expected)
    {
        var response = Map(confidence);
        response.Recommendation.ShouldBe(expected);
        response.ServiceConfidence.ShouldBe(confidence);
        response.Services.ShouldHaveSingleItem().Probability.ShouldBe(0.8);
    }

    [Theory]
    [InlineData(0.6, true)]
    [InlineData(0.59999, false)]
    public void Date_threshold_is_inclusive(double confidence, bool present)
    {
        var response = Map(dateConfidence: confidence);
        (response.PreferredDate is not null).ShouldBe(present);
        if (present)
        {
            response.PreferredDate!.Date.ShouldBe(new DateOnly(2026, 10, 18));
        }
    }

    [Fact]
    public void None_winner_abstains_even_with_other_candidates()
    {
        var response = Map(probability: 0.2, choice: ClefQuestionBuilder.NoneOfThese);
        response.Recommendation.ShouldBe("no-match");
        response.Services.ShouldHaveSingleItem().ServiceType.Code.ShouldBe("BRAKES-PADS-DISCS");
    }

    [Fact]
    public void Candidate_floor_is_inclusive_and_empty_candidates_abstain()
    {
        Map(probability: 0.1).Services.ShouldHaveSingleItem();
        var below = Map(probability: 0.09999);
        below.Services.ShouldBeEmpty();
        below.Recommendation.ShouldBe("no-match");
    }

    [Fact]
    public void No_specific_date_returns_null_even_at_high_confidence() =>
        Map(date: ClefQuestionBuilder.NoSpecificDate).PreferredDate.ShouldBeNull();

    [Fact]
    public void Candidates_are_ranked_limited_to_three_and_use_only_the_bookable_list()
    {
        var services = Keyloop.ServiceScheduler.Infrastructure.Persistence.Seeding.ReferenceDataSeed.CreateServiceTypes();
        var probabilities = services.Select((s, i) => (s.Code, Probability: (i + 1) / 100.0))
            .ToDictionary(p => p.Code, p => p.Probability, StringComparer.Ordinal);
        var response = TriageResponseMapper.Map("@cf/cloudflare/clef-flash",
            new(new("choice", "DIAG-FAULT-FINDING", 0.8, probabilities),
                new("choice", "NO_SPECIFIC_DATE", 1, new() { ["NO_SPECIFIC_DATE"] = 1 }), None, null),
            services.Take(9).ToList(), new TriageOptions { CandidateFloor = 0.01 });
        response.Services.Select(s => s.ServiceType.Code).ShouldBe(["AIRCON-REGAS", "HEAVY-VAN-SERVICE", "WHEEL-ALIGNMENT"]);
        response.Services.Select(s => s.Probability).ShouldBe([0.09, 0.08, 0.07]);
    }

    private static TriageBookingResponse Map(double confidence = 0.9, double dateConfidence = 0.9,
        double probability = 0.8, string choice = "BRAKES-PADS-DISCS", string date = "2026-10-18") =>
        TriageResponseMapper.Map("@cf/cloudflare/clef-flash", new(
            new("choice", choice, confidence, new() { ["BRAKES-PADS-DISCS"] = probability, [ClefQuestionBuilder.NoneOfThese] = 1 - probability }),
            new("choice", date, dateConfidence, new() { [date] = 0.9 }), None, 321), [ClefQuestionBuilderTests.Brakes], new());

    private static readonly ClefAnswer None = new("choice", "NONE", 1, new() { ["NONE"] = 1 });

    [Theory]
    [InlineData(0.09999, 0.0, false)]
    [InlineData(0.1, 0.0, true)]
    [InlineData(0.1, 0.5, false)]
    [InlineData(0.26499, 0.5, false)]
    [InlineData(0.265, 0.5, true)]
    [InlineData(0.47, 1.0, false)]
    public void Relative_floor_removes_the_stakeholders_ten_percent_noise_and_keeps_boundary_candidates(double other, double relative, bool kept)
    {
        var services = Keyloop.ServiceScheduler.Infrastructure.Persistence.Seeding.ReferenceDataSeed.CreateServiceTypes()
            .Where(s => s.Code is "DIAG-FAULT-FINDING" or "FULL-SERVICE").ToArray();
        var response = TriageResponseMapper.Map("clef-flash", new(
            new("choice", "DIAG-FAULT-FINDING", 0.53, new() { ["DIAG-FAULT-FINDING"] = 0.53, ["FULL-SERVICE"] = other }),
            new("choice", "NO_SPECIFIC_DATE", 1, new() { ["NO_SPECIFIC_DATE"] = 1 }), None, null), services,
            new TriageOptions { RelativeCandidateFloor = relative });
        response.Services.Count.ShouldBe(kept ? 2 : 1);
        response.Services[0].ServiceType.Code.ShouldBe("DIAG-FAULT-FINDING");
    }

    [Theory]
    [InlineData("NONE", 1, false)]
    // Default 0.50 (live golden set, 2026-10-13): the lowest correct notices scored 0.538 and 0.547, the only false one 0.416.
    [InlineData("GLASS", 0.49999, false)]
    [InlineData("GLASS", 0.5, true)]
    [InlineData("GLASS", 0.538, true)]
    [InlineData("LIGHTS_OR_ELECTRICAL_ACCESSORY", 0.416, false)]
    [InlineData("ACCIDENT_OR_BODY_DAMAGE", 0.8, true)]
    [InlineData("LIGHTS_OR_ELECTRICAL_ACCESSORY", 0.8, true)]
    [InlineData("AIR_CONDITIONING", 0.8, true)]
    [InlineData("TYRES_OR_WHEELS", 0.8, true)]
    [InlineData("OTHER", 0.8, true)]
    public void Uncovered_issue_has_its_own_inclusive_confidence_threshold(string category, double confidence, bool present)
    {
        var response = TriageResponseMapper.Map("clef-flash", new(
            new("choice", "BRAKES-PADS-DISCS", 0.1, new() { ["BRAKES-PADS-DISCS"] = 1 }),
            new("choice", "NO_SPECIFIC_DATE", 1, new() { ["NO_SPECIFIC_DATE"] = 1 }),
            new("choice", category, confidence, new() { [category] = 0.9 }), null), [ClefQuestionBuilderTests.Brakes], new());
        response.Recommendation.ShouldBe("confirm");
        (response.UncoveredIssue is not null).ShouldBe(present);
        if (present)
        {
            response.UncoveredIssue!.Category.ToString().ShouldBe(category);
            response.UncoveredIssue.Probability.ShouldBe(0.9);
            response.UncoveredIssue.Confidence.ShouldBe(confidence);
        }
    }

    [Fact]
    public void Empty_catalogue_abstains_without_losing_the_uncovered_issue()
    {
        var response = TriageResponseMapper.Map("clef-flash", new(
            new("choice", "NONE_OF_THESE", 1, new() { ["NONE_OF_THESE"] = 1 }),
            new("choice", "NO_SPECIFIC_DATE", 1, new() { ["NO_SPECIFIC_DATE"] = 1 }),
            new("choice", "GLASS", 0.9, new() { ["GLASS"] = 1 }), null), [], new());
        response.Services.ShouldBeEmpty();
        response.Recommendation.ShouldBe("no-match");
        var issue = response.UncoveredIssue.ShouldNotBeNull();
        issue.Category.ShouldBe(TriageUncoveredCategory.GLASS);
        issue.OutsideServiceTypeId.ShouldBeNull(); // Clef chose no service, so the issue is outside the whole bookable catalogue
    }

    // The question asks for an issue outside Clef's most likely service, which need not be the candidate a person picks: with
    // DIAG 0.45 and ACCIDENT 0.40 (confirm, nothing preselected) the notice is relative to DIAG only.
    [Theory]
    [InlineData("DIAG-FAULT-FINDING")]
    [InlineData("ACCIDENT-DAMAGE-ASSESSMENT")]
    public void Uncovered_issue_names_the_service_it_is_outside(string chosen)
    {
        var services = Keyloop.ServiceScheduler.Infrastructure.Persistence.Seeding.ReferenceDataSeed.CreateServiceTypes()
            .Where(s => s.Code is "DIAG-FAULT-FINDING" or "ACCIDENT-DAMAGE-ASSESSMENT").ToArray();
        var other = chosen == "DIAG-FAULT-FINDING" ? "ACCIDENT-DAMAGE-ASSESSMENT" : "DIAG-FAULT-FINDING";
        var response = TriageResponseMapper.Map("clef-flash", new(
            new("choice", chosen, 0.4, new() { [chosen] = 0.45, [other] = 0.40, [ClefQuestionBuilder.NoneOfThese] = 0.15 }),
            new("choice", "NO_SPECIFIC_DATE", 1, new() { ["NO_SPECIFIC_DATE"] = 1 }),
            new("choice", "AIR_CONDITIONING", 0.9, new() { ["AIR_CONDITIONING"] = 1 }), null), services, new());
        response.Recommendation.ShouldBe("confirm");
        response.Services.Select(s => s.ServiceType.Code).ShouldBe([chosen, other]);
        response.UncoveredIssue.ShouldNotBeNull().OutsideServiceTypeId.ShouldBe(services.Single(s => s.Code == chosen).Id);
    }

    [Theory]
    [InlineData(0.6, true)]
    [InlineData(0.8, true)]
    [InlineData(0.80001, false)]
    [InlineData(1.0, false)]
    public void Uncovered_threshold_is_configurable_without_changing_service_or_date_thresholds(double threshold, bool present)
    {
        var response = TriageResponseMapper.Map("clef-flash", new(
            new("choice", "BRAKES-PADS-DISCS", 0.5, new() { ["BRAKES-PADS-DISCS"] = 1 }),
            new("choice", "2026-10-13", 0.6, new() { ["2026-10-13"] = 1 }),
            new("choice", "AIR_CONDITIONING", 0.8, new() { ["AIR_CONDITIONING"] = 1 }), null),
            [ClefQuestionBuilderTests.Brakes], new TriageOptions { UncoveredIssueThreshold = threshold });
        response.Recommendation.ShouldBe("suggest");
        response.PreferredDate.ShouldNotBeNull().Date.ShouldBe(new DateOnly(2026, 10, 13));
        (response.UncoveredIssue is not null).ShouldBe(present);
    }
}
