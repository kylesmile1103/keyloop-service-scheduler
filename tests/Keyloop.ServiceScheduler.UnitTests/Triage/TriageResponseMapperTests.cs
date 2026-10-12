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
                new("choice", "NO_SPECIFIC_DATE", 1, new() { ["NO_SPECIFIC_DATE"] = 1 }), null),
            services.Take(9).ToList(), new TriageOptions { CandidateFloor = 0.01 });
        response.Services.Select(s => s.ServiceType.Code).ShouldBe(["AIRCON-REGAS", "HEAVY-VAN-SERVICE", "WHEEL-ALIGNMENT"]);
        response.Services.Select(s => s.Probability).ShouldBe([0.09, 0.08, 0.07]);
    }

    private static TriageBookingResponse Map(double confidence = 0.9, double dateConfidence = 0.9,
        double probability = 0.8, string choice = "BRAKES-PADS-DISCS", string date = "2026-10-18") =>
        TriageResponseMapper.Map("@cf/cloudflare/clef-flash", new(
            new("choice", choice, confidence, new() { ["BRAKES-PADS-DISCS"] = probability, [ClefQuestionBuilder.NoneOfThese] = 1 - probability }),
            new("choice", date, dateConfidence, new() { [date] = 0.9 }), 321), [ClefQuestionBuilderTests.Brakes], new());
}
