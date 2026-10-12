using Keyloop.ServiceScheduler.Api.Features.Triage.TriageBookingRequest;
using Keyloop.ServiceScheduler.Infrastructure.Triage;

namespace Keyloop.ServiceScheduler.IntegrationTests.Triage;

/// <summary>Offline evidence for the live report's scoring and fixture coverage. Never constructs a real transport.</summary>
public sealed class TriageGoldenSetReportTests
{
    [Fact]
    public void Report_separates_question_accuracy_suppression_false_notices_and_category_confusion()
    {
        TriageGoldenSetReport.Sample[] samples =
        [
            Sample(1, "GLASS", "GLASS", 0.69, null),
            Sample(2, "NONE", "AIR_CONDITIONING", 0.9, TriageUncoveredCategory.AIR_CONDITIONING),
            Sample(3, "ACCIDENT_OR_BODY_DAMAGE", "OTHER", 0.9, TriageUncoveredCategory.OTHER),
        ];
        var report = TriageGoldenSetReport.Build("clef-flash", samples);
        report.ShouldContain("Service choice accuracy: 3/3.");
        report.ShouldContain("Date choice accuracy (including NO_SPECIFIC_DATE): 3/3.");
        report.ShouldContain("Uncovered choice accuracy (including NONE): 1/3.");
        report.ShouldContain("Uncovered positive accuracy: 1/2; NONE accuracy: 0/1.");
        report.ShouldContain("correct notices: 0/2; false notices: 1; missed notices: 1; wrong-category notices: 1.");
        report.ShouldContain("| 0.60 | 1 | 1 | 0 | 1 |");
        report.ShouldContain("| 0.70 | 0 | 1 | 1 | 1 |");
        report.ShouldContain("| GLASS | 1 | 0 | 0 | 0 | 0 | 0 | 0 |"); // suppressed GLASS is NONE in the exposed matrix
        report.ShouldContain("Input tokens: 300; usage missing in 0/3 requests.");
    }

    [Fact]
    public void Extended_fixtures_cover_every_uncovered_category_and_all_three_questions()
    {
        var examples = LiveAiGoldenSetTests.GoldenSet;
        examples.Length.ShouldBe(45);
        examples.Select(e => e.Uncovered).Distinct().Order().ShouldBe(
            new[] { "NONE", "ACCIDENT_OR_BODY_DAMAGE", "LIGHTS_OR_ELECTRICAL_ACCESSORY", "AIR_CONDITIONING", "TYRES_OR_WHEELS", "GLASS", "OTHER" }.Order());
        examples.Count(e => e.Uncovered != "NONE").ShouldBeGreaterThanOrEqualTo(12);
        examples.Count(e => e.Code == "ACCIDENT-DAMAGE-ASSESSMENT").ShouldBeGreaterThanOrEqualTo(4);
        examples.Count(e => e.DaysAhead is not null).ShouldBe(3);
        examples.ShouldContain(e => e.Description.Contains("headlines", StringComparison.Ordinal));
        examples.ShouldContain(e => e.Description.Contains("cannot turn on", StringComparison.Ordinal));
    }

    private static TriageGoldenSetReport.Sample Sample(int id, string expected, string actual, double confidence, TriageUncoveredCategory? exposed)
    {
        var service = new ClefAnswer("choice", "BRAKES-PADS-DISCS", 0.8, new() { ["BRAKES-PADS-DISCS"] = 1 });
        var date = new ClefAnswer("choice", "NO_SPECIFIC_DATE", 0.8, new() { ["NO_SPECIFIC_DATE"] = 1 });
        var uncovered = new ClefAnswer("choice", actual, confidence, new() { [actual] = 1 });
        var answer = new ClefEvaluation(service, date, uncovered, 100);
        var response = new TriageBookingResponse("clef-flash", "suggest", 0.8, [], null,
            exposed is { } category ? new(category, 1, confidence, null) : null);
        return new(id, "BRAKES-PADS-DISCS", false, "NO_SPECIFIC_DATE", expected, answer, response, 100, 2000);
    }
}
