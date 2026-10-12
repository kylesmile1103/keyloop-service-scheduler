using Keyloop.ServiceScheduler.Api.Features.Triage.TriageBookingRequest;
using Keyloop.ServiceScheduler.Infrastructure.Persistence.Seeding;
using Keyloop.ServiceScheduler.Infrastructure.Triage;
using static Keyloop.ServiceScheduler.IntegrationTests.Triage.TriageGoldenSetReport;

namespace Keyloop.ServiceScheduler.IntegrationTests.Triage;

/// <summary>Offline evidence for the live report's scoring and fixture coverage. Never constructs a real transport.</summary>
public sealed class TriageGoldenSetReportTests
{
    private static readonly Domain.Catalog.ServiceType[] Services = ReferenceDataSeed.CreateServiceTypes();

    [Fact]
    public void Report_separates_question_accuracy_suppression_false_notices_and_category_confusion()
    {
        Sample[] samples =
        [
            Sample(1, [new("BRAKES-PADS-DISCS", "GLASS")], "BRAKES-PADS-DISCS", "GLASS", 0.59, hinted: true),
            Sample(2, [new("BRAKES-PADS-DISCS")], "BRAKES-PADS-DISCS", "AIR_CONDITIONING", 0.9),
            Sample(3, [new("BRAKES-PADS-DISCS", "ACCIDENT_OR_BODY_DAMAGE")], "BRAKES-PADS-DISCS", "OTHER", 0.9),
        ];
        var report = Build("clef-flash", Services, samples);
        report.ShouldContain("Service choice accuracy: all 3/3; hinted 1/1; natural 2/2.");
        report.ShouldContain("Joint service and uncovered accuracy: all 1/3; hinted 1/1; natural 0/2.");
        report.ShouldContain("Uncovered accuracy given an accepted service: all 1/3; hinted 1/1; natural 0/2.");
        report.ShouldContain("Date choice accuracy (including NO_SPECIFIC_DATE): 3/3.");
        report.ShouldContain("Uncovered given an accepted service: positive 1/2; NONE 0/1.");
        report.ShouldContain("Exposed notices given an accepted service: correct 0/2; false 1; missed 1; wrong category 1.");
        report.ShouldContain("| 0.40 | 1 | 1 | 0 | 1 |");
        report.ShouldContain("| 0.60 | 0 | 1 | 1 | 1 |");
        report.ShouldContain("| GLASS | 1 | 0 | 0 | 0 | 0 | 0 | 0 |"); // suppressed GLASS is NONE in the exposed matrix
        report.ShouldContain("Input tokens: 300; usage missing in 0/3 requests.");
    }

    [Fact]
    public void Uncovered_answers_are_scored_against_the_service_Clef_chose()
    {
        Accepted[] either = [new("DIAG-FAULT-FINDING", "ACCIDENT_OR_BODY_DAMAGE"), new("ACCIDENT-DAMAGE-ASSESSMENT", "AIR_CONDITIONING")];
        Sample[] samples =
        [
            Sample(1, either, "ACCIDENT-DAMAGE-ASSESSMENT", "AIR_CONDITIONING", 0.9, stakeholder: true), // the alternative pair is right
            Sample(2, either, "DIAG-FAULT-FINDING", "AIR_CONDITIONING", 0.9), // AC is what DIAG covers: the crash is the uncovered part
            Sample(3, either, "BRAKES-PADS-DISCS", "ACCIDENT_OR_BODY_DAMAGE", 0.9), // wrong service: not scored for the uncovered answer
        ];
        var report = Build("clef-flash", Services, samples);
        report.ShouldContain("Service choice accuracy: all 2/3; hinted 0/0; natural 2/3.");
        report.ShouldContain("Joint service and uncovered accuracy: all 1/3; hinted 0/0; natural 1/3.");
        report.ShouldContain("Uncovered accuracy given an accepted service: all 1/2; hinted 0/0; natural 1/2.");
        report.ShouldContain("Exposed notices given an accepted service: correct 1/2; false 0; missed 0; wrong category 1.");
        report.ShouldContain("Stakeholder case (fixture 1): service ACCIDENT-DAMAGE-ASSESSMENT (0.80), uncovered AIR_CONDITIONING (0.90), exposed AIR_CONDITIONING outside ACCIDENT-DAMAGE-ASSESSMENT; accepted pair: yes; correct notice shown: yes.");
        report.ShouldContain("| 1 | natural | DIAG-FAULT-FINDING+ACCIDENT_OR_BODY_DAMAGE / ACCIDENT-DAMAGE-ASSESSMENT+AIR_CONDITIONING | ACCIDENT-DAMAGE-ASSESSMENT |");
    }

    [Fact]
    public void Report_recomputes_candidate_retention_for_each_relative_floor()
    {
        // The stakeholder's measured shape: DIAG 0.53 with Full Service 0.10 beside it; a second answer keeps a plausible 0.30 alternative.
        Sample[] samples =
        [
            Sample(1, [new("DIAG-FAULT-FINDING")], "DIAG-FAULT-FINDING", "NONE", 0.9,
                probabilities: new() { ["DIAG-FAULT-FINDING"] = 0.53, ["FULL-SERVICE"] = 0.10, ["NONE_OF_THESE"] = 0.37 }),
            Sample(2, [new("AIRCON-REGAS")], "DIAG-FAULT-FINDING", "NONE", 0.9,
                probabilities: new() { ["DIAG-FAULT-FINDING"] = 0.50, ["AIRCON-REGAS"] = 0.30, ["NONE_OF_THESE"] = 0.20 }),
            Sample(3, [new("NONE_OF_THESE", "GLASS")], "NONE_OF_THESE", "GLASS", 0.9),
        ];
        var report = Build("clef-flash", Services, samples);
        report.ShouldContain("| 0.00 | 2/2 | 1.33 | 0 |"); // absolute floor only: DIAG+FULL, DIAG+AIRCON, nothing for the no-match
        report.ShouldContain("| 0.50 | 2/2 | 1.00 | 1 |"); // the 0.265 floor drops Full Service but keeps the 0.30 alternative
        report.ShouldContain("| 0.70 | 1/2 | 0.67 | 2 |"); // a 0.35 floor loses the accepted 0.30 alternative
        report.ShouldContain("| 2 | natural | AIRCON-REGAS+NONE | DIAG-FAULT-FINDING | 0.800 | suggest | 2 | 2 |");
        report.ShouldContain("| 3 | natural | NONE_OF_THESE+GLASS | NONE_OF_THESE | 0.800 | no-match | 0 | n/a |");
    }

    [Fact]
    public void Extended_fixtures_cover_every_uncovered_category_and_all_three_questions()
    {
        var examples = LiveAiGoldenSetTests.GoldenSet;
        examples.Length.ShouldBe(49);
        examples.SelectMany(e => e.Accept).Select(a => a.Uncovered).Distinct().Order().ShouldBe(
            new[] { "NONE", "ACCIDENT_OR_BODY_DAMAGE", "LIGHTS_OR_ELECTRICAL_ACCESSORY", "AIR_CONDITIONING", "TYRES_OR_WHEELS", "GLASS", "OTHER" }.Order());
        examples.Count(e => e.Uncovered != "NONE").ShouldBeGreaterThanOrEqualTo(12);
        examples.Count(e => e.Code == "ACCIDENT-DAMAGE-ASSESSMENT").ShouldBeGreaterThanOrEqualTo(4);
        examples.Count(e => e.DaysAhead is not null).ShouldBe(3);
        examples.ShouldContain(e => e.Description.Contains("headlines", StringComparison.Ordinal));
        examples.ShouldContain(e => e.Description.Contains("cannot turn on", StringComparison.Ordinal));
        // The stakeholder's own sentence, verbatim (task 32 brief, "What the stakeholder saw").
        examples.ShouldContain(e => e.Description == "I crashed my Kia Sportage and headlines are broken, also the AC can't turn on, need check ASAP");
        examples.Single(e => e.Description == LiveAiGoldenSetTests.StakeholderDescription).Accept.Count.ShouldBe(2);
        // Hinted fixtures are reported apart; natural multi-issue and unsupported repairs must exist without those hints.
        examples.Count(e => e.Hinted).ShouldBe(13);
        examples.Where(e => e.Hinted).ShouldAllBe(e => e.Description.Contains("Main task", StringComparison.Ordinal)
            || e.Description.StartsWith("Book ", StringComparison.Ordinal) || e.Description.Contains(" no ", StringComparison.Ordinal)
            || e.Description.Contains("not an", StringComparison.Ordinal) || e.Description.Contains("diagnose why", StringComparison.Ordinal));
        examples.Count(e => !e.Hinted && e.Accept.Any(a => a.Uncovered != "NONE")).ShouldBeGreaterThanOrEqualTo(5);
        examples.Take(25).ShouldAllBe(e => !e.Hinted && e.Uncovered == "NONE"); // the original two-question set stays first
    }

    private static Sample Sample(int id, Accepted[] accept, string service, string uncovered, double confidence, bool hinted = false,
        bool stakeholder = false, Dictionary<string, double>? probabilities = null)
    {
        // A complete validated distribution over the catalogue, as the answer validator guarantees for live answers.
        var distribution = Services.Select(s => s.Code).Append(ClefQuestionBuilder.NoneOfThese).ToDictionary(code => code, _ => 0.0);
        foreach (var (code, value) in probabilities ?? new() { [service] = 1 })
        {
            distribution[code] = value;
        }
        var answer = new ClefEvaluation(new ClefAnswer("choice", service, 0.8, distribution),
            new ClefAnswer("choice", "NO_SPECIFIC_DATE", 0.8, new() { ["NO_SPECIFIC_DATE"] = 1 }),
            new ClefAnswer("choice", uncovered, confidence, new() { [uncovered] = 1 }), 100);
        var response = TriageResponseMapper.Map("clef-flash", answer, Services, new());
        return new(id, accept, hinted, stakeholder, false, "NO_SPECIFIC_DATE", answer, response, 100, 2000);
    }
}
