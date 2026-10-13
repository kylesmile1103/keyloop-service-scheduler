using System.Globalization;
using System.Text;
using Keyloop.ServiceScheduler.Api.Features.Triage;
using Keyloop.ServiceScheduler.Api.Features.Triage.TriageBookingRequest;
using Keyloop.ServiceScheduler.Domain.Catalog;
using Keyloop.ServiceScheduler.Infrastructure.Triage;

namespace Keyloop.ServiceScheduler.IntegrationTests.Triage;

/// <summary>Pure scoring of validated answers. Reports fixture ids and closed choices, never customer or model prose.</summary>
internal static class TriageGoldenSetReport
{
    /// <summary>An accepted (service, uncovered issue) pair for a golden-set fixture.</summary>
    internal sealed record Accepted(string Service, string Uncovered = ClefQuestionBuilder.NoUncoveredIssue);

    /// <param name="Hinted">The description names the main task or what is excluded: an easier subset, reported apart.</param>
    /// <param name="StakeholderCase">Whether this is the stakeholder reference sentence, reported on its own line.</param>
    internal sealed record Sample(int Fixture, IReadOnlyList<Accepted> Accept, bool Hinted, bool StakeholderCase, bool MustAbstain, string Date,
        ClefEvaluation Answer, TriageBookingResponse Response, double LatencyMs, int AddedQuestionBytes)
    {
        /// <summary>The accepted pair for the service Clef chose, or null when that service is not accepted for this fixture.</summary>
        internal Accepted? Expected => Accept.FirstOrDefault(a => a.Service == Answer.Service.Choice);

        internal string RawUncovered => Answer.UncoveredIssue.Choice!;

        internal string Exposed => Response.UncoveredIssue?.Category.ToString() ?? ClefQuestionBuilder.NoUncoveredIssue;

        /// <summary>The raw category lies inside the scope of the service Clef chose, so the mapper never exposes it.</summary>
        internal bool InChosenScope => UncoveredIssueScope.Covers(Answer.Service.Choice!, RawUncovered);
    }

    internal static readonly double[] UncoveredThresholds = [0.0, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

    internal static readonly double[] RelativeFloors = [0.0, 0.3, 0.5, 0.7];

    private static readonly string[] Categories =
        ["NONE", "ACCIDENT_OR_BODY_DAMAGE", "LIGHTS_OR_ELECTRICAL_ACCESSORY", "AIR_CONDITIONING", "TYRES_OR_WHEELS", "GLASS", "OTHER"];

    /// <param name="services">The catalogue the questions were built from, so candidate floors can be recomputed with the real mapper.</param>
    internal static string Build(string model, IReadOnlyList<ServiceType> services, IReadOnlyList<Sample> samples)
    {
        var report = new StringBuilder("# Clef-flash live AI golden set\n\n");
        report.AppendLine($"Model: {model}. Images: none (text regression set).\n");
        var count = samples.Count;
        var options = new TriageOptions();
        report.AppendLine(CultureInfo.InvariantCulture, $"Thresholds: service {options.SuggestThreshold:F2}, date {options.DateThreshold:F2}, uncovered {options.UncoveredIssueThreshold:F2}; candidate absolute {options.CandidateFloor:F2}, relative {options.RelativeCandidateFloor:F2}.");
        report.AppendLine("Hinted fixtures name the main task or what is excluded (\"Main task\", \"Book X; also\", \"no ... needed\"); natural ones do not. The uncovered answer is scored against the service Clef chose: joint accuracy needs an accepted (service, uncovered) pair, and accuracy given the service counts only fixtures whose chosen service is accepted. Raw lines use the validated choice; exposed notices, the exposed matrix and the threshold sweep also apply same-scope suppression (a category inside the chosen service's own scope is never shown).\n");
        Line(report, "Service choice accuracy", samples, s => s.Expected is not null);
        Line(report, "Joint service and uncovered accuracy", samples, s => s.Expected?.Uncovered == s.RawUncovered);
        var given = samples.Where(s => s.Expected is not null).ToArray();
        Line(report, "Uncovered accuracy given an accepted service", given, s => s.Expected!.Uncovered == s.RawUncovered);
        report.AppendLine(CultureInfo.InvariantCulture, $"Date choice accuracy (including NO_SPECIFIC_DATE): {samples.Count(s => s.Answer.PreferredDate.Choice == s.Date)}/{count}.");
        var concrete = samples.Where(s => s.Date != ClefQuestionBuilder.NoSpecificDate).ToArray();
        report.AppendLine(CultureInfo.InvariantCulture, $"Concrete dates exposed correctly: {concrete.Count(s => s.Response.PreferredDate?.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) == s.Date)}/{concrete.Length}; false dates exposed: {samples.Count(s => s.Date == ClefQuestionBuilder.NoSpecificDate && s.Response.PreferredDate is not null)}.");
        var positive = given.Where(s => s.Expected!.Uncovered != ClefQuestionBuilder.NoUncoveredIssue).ToArray();
        var negative = given.Where(s => s.Expected!.Uncovered == ClefQuestionBuilder.NoUncoveredIssue).ToArray();
        report.AppendLine(CultureInfo.InvariantCulture, $"Uncovered given an accepted service: positive {positive.Count(s => s.RawUncovered == s.Expected!.Uncovered)}/{positive.Length}; NONE {negative.Count(s => s.RawUncovered == ClefQuestionBuilder.NoUncoveredIssue)}/{negative.Length}.");
        var suppressed = samples.Where(s => s.InChosenScope).ToArray();
        var suppressedAtThreshold = suppressed.Where(s => s.Answer.UncoveredIssue.Confidence >= options.UncoveredIssueThreshold).ToArray();
        report.AppendLine(CultureInfo.InvariantCulture, $"Same-scope suppression (all fixtures): {suppressedAtThreshold.Length} at the configured threshold ({Fixtures(suppressedAtThreshold)}); {suppressed.Length} at any confidence ({Fixtures(suppressed)}).");
        report.AppendLine(CultureInfo.InvariantCulture, $"Exposed notices given an accepted service: correct {positive.Count(s => s.Exposed == s.Expected!.Uncovered)}/{positive.Length}; false {negative.Count(s => s.Exposed != ClefQuestionBuilder.NoUncoveredIssue)}; missed {positive.Count(s => s.Exposed == ClefQuestionBuilder.NoUncoveredIssue)}; wrong category {positive.Count(s => s.Exposed != ClefQuestionBuilder.NoUncoveredIssue && s.Exposed != s.Expected!.Uncovered)}.");
        foreach (var s in samples.Where(s => s.StakeholderCase))
        {
            report.AppendLine(CultureInfo.InvariantCulture, $"Stakeholder case (fixture {s.Fixture}): service {s.Answer.Service.Choice} ({s.Answer.Service.Confidence:F2}), uncovered {s.RawUncovered} ({s.Answer.UncoveredIssue.Confidence:F2}), exposed {s.Exposed} outside {Outside(s, services)}; accepted pair: {YesNo(s.Expected?.Uncovered == s.RawUncovered)}; correct notice shown: {YesNo(s.Expected is { } e && e.Uncovered == s.Exposed && e.Uncovered != ClefQuestionBuilder.NoUncoveredIssue)}.");
        }
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
        report.AppendLine("\n## Uncovered confusion given an accepted service (raw validated choice)\n");
        Confusion(report, given, s => s.RawUncovered);
        report.AppendLine("\n## Uncovered confusion given an accepted service (exposed at the configured threshold)\n");
        Confusion(report, given, s => s.Exposed);
        report.AppendLine("\n## Uncovered threshold calibration (given an accepted service)\n");
        report.AppendLine("| Threshold | Correct notices | False notices | Missed notices | Wrong category |\n|---|---|---|---|---|");
        foreach (var threshold in UncoveredThresholds)
        {
            string Choice(Sample s) => s.Answer.UncoveredIssue.Confidence >= threshold && !s.InChosenScope ? s.RawUncovered : ClefQuestionBuilder.NoUncoveredIssue;
            report.AppendLine(CultureInfo.InvariantCulture, $"| {threshold:F2} | {positive.Count(s => Choice(s) == s.Expected!.Uncovered)} | {negative.Count(s => Choice(s) != ClefQuestionBuilder.NoUncoveredIssue)} | {positive.Count(s => Choice(s) == ClefQuestionBuilder.NoUncoveredIssue)} | {positive.Count(s => Choice(s) != ClefQuestionBuilder.NoUncoveredIssue && Choice(s) != s.Expected!.Uncovered)} |");
        }
        report.AppendLine("\n## Candidate retention by relative floor\n");
        report.AppendLine(CultureInfo.InvariantCulture, $"Recomputed with the production mapper from each answer's validated service probabilities (absolute floor {options.CandidateFloor:F2}, at most three). Retained counts fixtures whose accepted bookable service survives as a candidate.\n");
        report.AppendLine("| Relative floor | Accepted service retained | Mean candidates | Single-candidate answers |\n|---|---|---|---|");
        var bookable = samples.Where(s => Bookable(s).Any()).ToArray();
        foreach (var floor in RelativeFloors)
        {
            var kept = samples.ToDictionary(s => s.Fixture, s => Candidates(model, services, s, new TriageOptions { RelativeCandidateFloor = floor }));
            report.AppendLine(CultureInfo.InvariantCulture, $"| {floor:F2} | {bookable.Count(s => kept[s.Fixture].Intersect(Bookable(s)).Any())}/{bookable.Length} | {kept.Values.Average(k => k.Length):F2} | {kept.Values.Count(k => k.Length == 1)} |");
        }
        report.AppendLine("\n## Per-fixture results\n");
        report.AppendLine("| Fixture | Subset | Accepted (service+uncovered) | Service choice | Service confidence | Recommendation | Candidates | Accepted rank | Date expected | Date choice | Date confidence | Uncovered choice | Uncovered confidence | Exposed category | Same scope | Outside service | Input tokens | Latency ms |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
        foreach (var s in samples)
        {
            report.AppendLine(CultureInfo.InvariantCulture, $"| {s.Fixture} | {(s.Hinted ? "hinted" : "natural")} | {string.Join(" / ", s.Accept.Select(a => $"{a.Service}+{a.Uncovered}"))} | {s.Answer.Service.Choice} | {s.Answer.Service.Confidence:F3} | {s.Response.Recommendation} | {s.Response.Services.Count} | {Rank(s)} | {s.Date} | {s.Answer.PreferredDate.Choice} | {s.Answer.PreferredDate.Confidence:F3} | {s.RawUncovered} | {s.Answer.UncoveredIssue.Confidence:F3} | {s.Exposed} | {YesNo(s.InChosenScope)} | {(s.Response.UncoveredIssue is null ? "-" : Outside(s, services))} | {s.Answer.InputTokens?.ToString(CultureInfo.InvariantCulture) ?? "missing"} | {s.LatencyMs:F1} |");
        }
        return report.ToString();
    }

    private static void Line(StringBuilder report, string label, IReadOnlyList<Sample> samples, Func<Sample, bool> correct)
    {
        string Score(IEnumerable<Sample> subset) => subset.Count(correct).ToString(CultureInfo.InvariantCulture) + "/" + subset.Count().ToString(CultureInfo.InvariantCulture);
        report.AppendLine($"{label}: all {Score(samples)}; hinted {Score(samples.Where(s => s.Hinted))}; natural {Score(samples.Where(s => !s.Hinted))}.");
    }

    private static string YesNo(bool value) => value ? "yes" : "no";

    private static string Fixtures(IEnumerable<Sample> samples) =>
        samples.Any() ? "fixtures " + string.Join(", ", samples.Select(s => s.Fixture.ToString(CultureInfo.InvariantCulture))) : "none";

    private static IEnumerable<string> Bookable(Sample sample) =>
        sample.Accept.Select(a => a.Service).Where(code => code != ClefQuestionBuilder.NoneOfThese).Distinct();

    private static string[] Candidates(string model, IReadOnlyList<ServiceType> services, Sample sample, TriageOptions options) =>
        [.. TriageResponseMapper.Map(model, sample.Answer, services, options).Services.Select(c => c.ServiceType.Code)];

    /// <summary>1-based rank of the first accepted bookable service among the exposed candidates; "-" when none is exposed.</summary>
    private static string Rank(Sample sample)
    {
        var accepted = Bookable(sample).ToHashSet(StringComparer.Ordinal);
        if (accepted.Count == 0)
        {
            return "n/a";
        }
        var index = sample.Response.Services.ToList().FindIndex(c => accepted.Contains(c.ServiceType.Code));
        return index < 0 ? "-" : (index + 1).ToString(CultureInfo.InvariantCulture);
    }

    private static string Outside(Sample sample, IReadOnlyList<ServiceType> services) =>
        sample.Response.UncoveredIssue?.OutsideServiceTypeId is { } id ? services.Single(s => s.Id == id).Code : "none";

    private static void Confusion(StringBuilder report, IReadOnlyList<Sample> samples, Func<Sample, string> actual)
    {
        report.AppendLine("Rows are expected for the chosen service, columns are actual. In the exposed matrix NONE also counts notices below the threshold or inside the chosen service's scope.\n");
        report.AppendLine("| Expected / Actual | " + string.Join(" | ", Categories) + " |");
        report.AppendLine("|---|" + string.Concat(Categories.Select(_ => "---|")));
        foreach (var expected in Categories)
        {
            report.AppendLine("| " + expected + " | " + string.Join(" | ", Categories.Select(category => samples.Count(s => s.Expected!.Uncovered == expected && actual(s) == category).ToString(CultureInfo.InvariantCulture))) + " |");
        }
    }
}
