using System.Globalization;
using System.Text;
using Keyloop.ServiceScheduler.Api.Features.Triage;
using Keyloop.ServiceScheduler.Api.Features.Triage.TriageBookingRequest;
using Keyloop.ServiceScheduler.Infrastructure.Triage;

namespace Keyloop.ServiceScheduler.IntegrationTests.Triage;

/// <summary>Pure scoring of validated answers. Reports fixture ids and closed choices, never customer or model prose.</summary>
internal static class TriageGoldenSetReport
{
    internal sealed record Sample(int Fixture, string Service, bool MustAbstain, string Date, string Uncovered,
        ClefEvaluation Answer, TriageBookingResponse Response, double LatencyMs, int AddedQuestionBytes);

    internal static string Build(string model, IReadOnlyList<Sample> samples)
    {
        var report = new StringBuilder("# Clef-flash live AI golden set\n\n");
        report.AppendLine($"Model: {model}. Images: none (text regression set).\n");
        var count = samples.Count;
        var options = new TriageOptions();
        report.AppendLine(CultureInfo.InvariantCulture, $"Thresholds: service {options.SuggestThreshold:F2}, date {options.DateThreshold:F2}, uncovered {options.UncoveredIssueThreshold:F2}; candidate absolute {options.CandidateFloor:F2}, relative {options.RelativeCandidateFloor:F2}.");
        report.AppendLine(CultureInfo.InvariantCulture, $"Service choice accuracy: {samples.Count(s => s.Answer.Service.Choice == s.Service)}/{count}.");
        report.AppendLine(CultureInfo.InvariantCulture, $"Date choice accuracy (including NO_SPECIFIC_DATE): {samples.Count(s => s.Answer.PreferredDate.Choice == s.Date)}/{count}.");
        var concrete = samples.Where(s => s.Date != ClefQuestionBuilder.NoSpecificDate).ToArray();
        report.AppendLine(CultureInfo.InvariantCulture, $"Concrete dates exposed correctly: {concrete.Count(s => s.Response.PreferredDate?.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) == s.Date)}/{concrete.Length}; false dates exposed: {samples.Count(s => s.Date == ClefQuestionBuilder.NoSpecificDate && s.Response.PreferredDate is not null)}.");
        report.AppendLine(CultureInfo.InvariantCulture, $"Uncovered choice accuracy (including NONE): {samples.Count(s => s.Answer.UncoveredIssue.Choice == s.Uncovered)}/{count}.");
        var positive = samples.Where(s => s.Uncovered != "NONE").ToArray();
        var negative = samples.Where(s => s.Uncovered == "NONE").ToArray();
        report.AppendLine(CultureInfo.InvariantCulture, $"Uncovered positive accuracy: {positive.Count(s => s.Answer.UncoveredIssue.Choice == s.Uncovered)}/{positive.Length}; NONE accuracy: {negative.Count(s => s.Answer.UncoveredIssue.Choice == "NONE")}/{negative.Length}.");
        report.AppendLine(CultureInfo.InvariantCulture, $"Uncovered exposed accuracy: {samples.Count(s => Exposed(s) == s.Uncovered)}/{count}; correct notices: {positive.Count(s => Exposed(s) == s.Uncovered)}/{positive.Length}; false notices: {negative.Count(s => Exposed(s) != "NONE")}; missed notices: {positive.Count(s => Exposed(s) == "NONE")}; wrong-category notices: {positive.Count(s => Exposed(s) != "NONE" && Exposed(s) != s.Uncovered)}.");
        var mustAbstain = samples.Where(s => s.MustAbstain).ToArray();
        report.AppendLine(CultureInfo.InvariantCulture, $"Required abstention/confirmation: {mustAbstain.Count(s => s.Response.Recommendation is "confirm" or "no-match")}/{mustAbstain.Length}; all abstentions/confirmations: {samples.Count(s => s.Response.Recommendation is "confirm" or "no-match")}/{count}.");
        var latencies = samples.Select(s => s.LatencyMs).Order().ToArray();
        double Percentile(double p) => latencies[(int)Math.Ceiling(latencies.Length * p) - 1];
        report.AppendLine(CultureInfo.InvariantCulture, $"Latency p50: {Percentile(0.5):F1} ms; p95: {Percentile(0.95):F1} ms. Input tokens: {samples.Sum(s => s.Answer.InputTokens ?? 0)}; usage missing in {samples.Count(s => s.Answer.InputTokens is null)}/{count} requests.");
        var extraBytes = samples[0].AddedQuestionBytes;
        report.AppendLine(CultureInfo.InvariantCulture, $"Third question adds {extraBytes} UTF-8 request bytes, approximately {Math.Ceiling(extraBytes / 4.0):F0} input tokens at 4 bytes/token (offline planning estimate, not measured Clef tokenization). One request per fixture; upstream reports total usage, not per-question usage.");
        if (count >= 25)
        {
            report.AppendLine(CultureInfo.InvariantCulture, $"Original 25 fixtures: {samples.Take(25).Sum(s => s.Answer.InputTokens ?? 0)} input tokens versus the historical two-question total 39696. This comparison also includes catalogue/rubric/date changes and is not an isolated third-question measurement.");
        }
        report.AppendLine("\n## Uncovered confusion (raw validated choice)\n");
        Confusion(report, samples, s => s.Answer.UncoveredIssue.Choice!);
        report.AppendLine("\n## Uncovered confusion (exposed at the configured threshold)\n");
        Confusion(report, samples, Exposed);
        report.AppendLine("\n## Uncovered threshold calibration\n");
        report.AppendLine("| Threshold | Correct notices | False notices | Missed notices | Wrong category |\n|---|---|---|---|---|");
        foreach (var threshold in new[] { 0.0, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0 })
        {
            string Choice(Sample s) => s.Answer.UncoveredIssue.Confidence >= threshold ? s.Answer.UncoveredIssue.Choice! : "NONE";
            report.AppendLine(CultureInfo.InvariantCulture, $"| {threshold:F2} | {positive.Count(s => Choice(s) == s.Uncovered)} | {negative.Count(s => Choice(s) != "NONE")} | {positive.Count(s => Choice(s) == "NONE")} | {positive.Count(s => Choice(s) != "NONE" && Choice(s) != s.Uncovered)} |");
        }
        report.AppendLine("\n## Per-fixture results\n");
        report.AppendLine("| Fixture | Service expected | Service choice | Service confidence | Recommendation | Date expected | Date choice | Date confidence | Uncovered expected | Uncovered choice | Uncovered confidence | Exposed category | Input tokens | Latency ms |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
        foreach (var s in samples)
        {
            report.AppendLine(CultureInfo.InvariantCulture, $"| {s.Fixture} | {s.Service} | {s.Answer.Service.Choice} | {s.Answer.Service.Confidence:F3} | {s.Response.Recommendation} | {s.Date} | {s.Answer.PreferredDate.Choice} | {s.Answer.PreferredDate.Confidence:F3} | {s.Uncovered} | {s.Answer.UncoveredIssue.Choice} | {s.Answer.UncoveredIssue.Confidence:F3} | {Exposed(s)} | {s.Answer.InputTokens?.ToString(CultureInfo.InvariantCulture) ?? "missing"} | {s.LatencyMs:F1} |");
        }
        return report.ToString();
    }

    private static string Exposed(Sample sample) => sample.Response.UncoveredIssue?.Category.ToString() ?? "NONE";

    private static void Confusion(StringBuilder report, IReadOnlyList<Sample> samples, Func<Sample, string> actual)
    {
        string[] categories = ["NONE", "ACCIDENT_OR_BODY_DAMAGE", "LIGHTS_OR_ELECTRICAL_ACCESSORY", "AIR_CONDITIONING", "TYRES_OR_WHEELS", "GLASS", "OTHER"];
        report.AppendLine("Rows are expected, columns are actual. NONE includes suppressed notices in the exposed matrix.\n");
        report.AppendLine("| Expected / Actual | " + string.Join(" | ", categories) + " |");
        report.AppendLine("|---|" + string.Concat(categories.Select(_ => "---|")));
        foreach (var expected in categories)
        {
            report.AppendLine("| " + expected + " | " + string.Join(" | ", categories.Select(category => samples.Count(s => s.Uncovered == expected && actual(s) == category).ToString(CultureInfo.InvariantCulture))) + " |");
        }
    }
}
