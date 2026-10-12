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
    // Calibrated on Clef-flash's live golden set (2026-10-13, 49 text fixtures, one run). Given an accepted service the sweep gave
    // 0.40: 6 correct notices, 1 false, 4 missed; 0.50: 5, 0, 5; 0.60: 3, 0, 7. 0.50 keeps the two correct notices at 0.538 and 0.547
    // that 0.60 hid and stays above the only false one (0.416, on an out-of-domain request). Ten positive fixtures are a small sample,
    // so the next approved run revisits it; a notice never preselects or books anything.
    public double UncoveredIssueThreshold { get; set; } = 0.5;
}

[OptionsValidator]
public sealed partial class TriageOptionsValidator : IValidateOptions<TriageOptions>;
