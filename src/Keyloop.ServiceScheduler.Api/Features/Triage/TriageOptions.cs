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
    // Provisional until the approved extended golden set. Clef's confidences sit low: on 2026-10-12 correct clear services scored 0.38
    // to 0.88 (only 10 of 22 at 0.70 or above) and both correct concrete dates 0.63 and 0.73. On that scale 0.70 would hide about half
    // the correct notices, the silent omission the stakeholder reported; 0.60 is the date question's calibrated value for the same kind
    // of explicitly mentioned closed choice, and a notice never preselects or books anything. The report sweeps 0.30 to 1.00.
    public double UncoveredIssueThreshold { get; set; } = 0.6;
}

[OptionsValidator]
public sealed partial class TriageOptionsValidator : IValidateOptions<TriageOptions>;
