using System.ComponentModel.DataAnnotations;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Api.Features.Triage;

/// <summary>Presentation limits and confidence thresholds; shares the Triage configuration section with the outbound adapter.</summary>
public sealed class TriageOptions
{
    [Range(1, 500)]
    public int MaxDescriptionLength { get; set; } = 500;
    [Range(0.0, 1.0)]
    // Calibrated for Clef-flash on its live golden set (2026-10-12): clear requests scored 0.38 to 0.88, the vague one 0.19, which
    // must be confirmed. Jev, which scored clear requests 1.00 and the vague one 0.86, used 0.95; each model needs its own value.
    public double SuggestThreshold { get; set; } = 0.5;
    [Range(0.0, 1.0)]
    public double DateThreshold { get; set; } = 0.6;
    [Range(0.0, 1.0)]
    public double CandidateFloor { get; set; } = 0.1;
    [Range(0.0, 1.0)]
    public double RelativeCandidateFloor { get; set; } = 0.5;
    [Range(0.0, 1.0)]
    // Provisional: flag a further issue only with stronger evidence than a service suggestion. Calibrate on the extended golden set.
    public double UncoveredIssueThreshold { get; set; } = 0.7;
}

[OptionsValidator]
public sealed partial class TriageOptionsValidator : IValidateOptions<TriageOptions>;
