using Keyloop.ServiceScheduler.Api.Features.Triage;
using Keyloop.ServiceScheduler.Api.Features.Triage.TriageBookingRequest;
using Keyloop.ServiceScheduler.Domain.Catalog;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Seeding;
using Keyloop.ServiceScheduler.Infrastructure.Triage;
using Microsoft.Extensions.Time.Testing;

namespace Keyloop.ServiceScheduler.UnitTests.Triage;

/// <summary>Same-scope suppression: a notice never names a problem that the service Clef chose already addresses.</summary>
public sealed class UncoveredIssueScopeTests
{
    private static readonly ServiceType[] Services = ReferenceDataSeed.CreateServiceTypes();

    [Fact]
    public void The_reviewed_map_covers_exactly_these_service_categories()
    {
        UncoveredIssueScope.Covered.Keys.Order(StringComparer.Ordinal).ToArray().ShouldBe(["ACCIDENT-DAMAGE-ASSESSMENT", "AIRCON-REGAS"]);
        UncoveredIssueScope.Covered["ACCIDENT-DAMAGE-ASSESSMENT"].ToArray().ShouldBe(["ACCIDENT_OR_BODY_DAMAGE"]);
        UncoveredIssueScope.Covered["AIRCON-REGAS"].ToArray().ShouldBe(["AIR_CONDITIONING"]);
    }

    [Fact]
    public void Every_entry_names_a_rubric_service_and_a_sent_category_other_than_NONE_and_OTHER()
    {
        var request = ClefQuestionBuilder.Build("@cf/cloudflare/clef-flash", "service due", Services, ClefQuestionBuilderTests.Reading,
            new FakeTimeProvider(new DateTimeOffset(2026, 10, 12, 8, 0, 0, TimeSpan.Zero)), 90);
        var sent = request.Questions["uncovered_issue"].Criteria.Select(c => c.Key).ToArray();
        foreach (var (service, categories) in UncoveredIssueScope.Covered)
        {
            ServiceTriageRubric.Entries.ShouldContainKey(service);
            categories.ShouldNotBeEmpty();
            categories.ShouldAllBe(c => sent.Contains(c) && c != ClefQuestionBuilder.NoUncoveredIssue && c != "OTHER");
        }
        // Every exposable API category has a request option of the same name, so the map speaks the mapper's vocabulary.
        Enum.GetNames<TriageUncoveredCategory>().ShouldAllBe(c => sent.Contains(c));
    }

    // Fixture 43 of the 2026-10-13 live run: Clef chose the accident assessment (confidence 0.409) and named ACCIDENT_OR_BODY_DAMAGE at
    // 0.84, a notice telling the person to book separately the damage the chosen service inspects.
    [Theory]
    [InlineData("ACCIDENT-DAMAGE-ASSESSMENT", "ACCIDENT_OR_BODY_DAMAGE", 0.84)]
    [InlineData("AIRCON-REGAS", "AIR_CONDITIONING", 1.0)]
    public void A_category_inside_the_chosen_services_scope_is_never_exposed(string chosen, string category, double confidence)
    {
        var response = Map(chosen, 0.409, category, confidence);
        response.UncoveredIssue.ShouldBeNull();
        response.Recommendation.ShouldBe("confirm"); // the suggestion itself is unchanged
        response.Services.ShouldHaveSingleItem().ServiceType.Code.ShouldBe(chosen);
    }

    [Theory]
    [InlineData("ACCIDENT-DAMAGE-ASSESSMENT", "AIR_CONDITIONING")] // rubric: not for an unrelated air-con fault (the stakeholder's case)
    [InlineData("ACCIDENT-DAMAGE-ASSESSMENT", "OTHER")]
    // Impact damage is not something the categories can tell apart, and the live run chose the assessment for non-collision repairs.
    [InlineData("ACCIDENT-DAMAGE-ASSESSMENT", "LIGHTS_OR_ELECTRICAL_ACCESSORY")] // fixture 49, a blown bulb
    [InlineData("ACCIDENT-DAMAGE-ASSESSMENT", "GLASS")] // fixture 48, a windscreen replacement
    [InlineData("ACCIDENT-DAMAGE-ASSESSMENT", "TYRES_OR_WHEELS")] // fixture 31, a puncture
    [InlineData("AIRCON-REGAS", "GLASS")] // fixture 41
    [InlineData("AIRCON-REGAS", "OTHER")] // fixture 47's alternative pair
    [InlineData("WHEEL-ALIGNMENT", "TYRES_OR_WHEELS")] // geometry only; rubric: not for tyre puncture repair
    [InlineData("DIAG-FAULT-FINDING", "ACCIDENT_OR_BODY_DAMAGE")] // rubric: not for collision damage assessment
    [InlineData("DIAG-FAULT-FINDING", "LIGHTS_OR_ELECTRICAL_ACCESSORY")] // rubric: not for headlight repair
    [InlineData("DIAG-FAULT-FINDING", "AIR_CONDITIONING")] // only a switch-on failure is diagnosis; weak cooling is regas
    [InlineData("MOT-TEST", "TYRES_OR_WHEELS")] // fixture 40: the test checks, it does not replace
    [InlineData("INTERIM-SERVICE", "LIGHTS_OR_ELECTRICAL_ACCESSORY")] // fixture 39
    [InlineData("BRAKES-PADS-DISCS", "ACCIDENT_OR_BODY_DAMAGE")] // fixture 43's accepted pair
    [InlineData("EV-BATTERY-CHECK", "LIGHTS_OR_ELECTRICAL_ACCESSORY")] // rubric: not for a 12 volt battery fault
    public void A_category_outside_the_chosen_services_scope_is_still_exposed_at_the_threshold(string chosen, string category)
    {
        var issue = Map(chosen, 0.6, category, new TriageOptions().UncoveredIssueThreshold).UncoveredIssue.ShouldNotBeNull();
        issue.Category.ToString().ShouldBe(category);
        issue.OutsideServiceTypeId.ShouldBe(Services.Single(s => s.Code == chosen).Id);
    }

    // Fixture 48 of the 2026-10-13 live run: a windscreen replacement that should be no-match came back as the accident assessment at
    // 0.485 (confirm) with GLASS at 0.62. The replacement is outside the assessment ("not the repair itself"), so the notice is correct.
    [Fact]
    public void A_glass_replacement_beside_the_accident_assessment_is_exposed()
    {
        var response = Map("ACCIDENT-DAMAGE-ASSESSMENT", 0.485, "GLASS", 0.62);
        response.Recommendation.ShouldBe("confirm");
        var issue = response.UncoveredIssue.ShouldNotBeNull();
        issue.Category.ShouldBe(TriageUncoveredCategory.GLASS);
        issue.Confidence.ShouldBe(0.62);
        issue.OutsideServiceTypeId.ShouldBe(Services.Single(s => s.Code == "ACCIDENT-DAMAGE-ASSESSMENT").Id);
    }

    [Theory]
    [InlineData("ACCIDENT_OR_BODY_DAMAGE")]
    [InlineData("LIGHTS_OR_ELECTRICAL_ACCESSORY")]
    [InlineData("AIR_CONDITIONING")]
    [InlineData("TYRES_OR_WHEELS")]
    [InlineData("GLASS")]
    [InlineData("OTHER")]
    public void Choosing_none_of_the_services_never_suppresses(string category)
    {
        var response = Map(ClefQuestionBuilder.NoneOfThese, 0.6, category, 0.9);
        response.Recommendation.ShouldBe("no-match");
        var issue = response.UncoveredIssue.ShouldNotBeNull();
        issue.Category.ToString().ShouldBe(category);
        issue.OutsideServiceTypeId.ShouldBeNull();
        UncoveredIssueScope.Covers(ClefQuestionBuilder.NoneOfThese, category).ShouldBeFalse();
    }

    [Fact]
    public void A_service_outside_the_reviewed_map_suppresses_nothing() =>
        UncoveredIssueScope.Covers("OPERATOR-ADDED-SERVICE", "AIR_CONDITIONING").ShouldBeFalse();

    private static TriageBookingResponse Map(string chosen, double confidence, string category, double uncoveredConfidence)
    {
        // A complete validated distribution: the chosen service (or the abstention) leads and every other code is zero.
        var probabilities = Services.Select(s => s.Code).Append(ClefQuestionBuilder.NoneOfThese).ToDictionary(code => code, _ => 0.0);
        probabilities[chosen] = 0.8;
        if (chosen != ClefQuestionBuilder.NoneOfThese)
        {
            probabilities[ClefQuestionBuilder.NoneOfThese] = 0.2;
        }
        return TriageResponseMapper.Map("clef-flash", new(
            new("choice", chosen, confidence, probabilities),
            new("choice", ClefQuestionBuilder.NoSpecificDate, 1, new() { [ClefQuestionBuilder.NoSpecificDate] = 1 }),
            new("choice", category, uncoveredConfidence, new() { [category] = 0.9 }), null), Services, new());
    }
}
