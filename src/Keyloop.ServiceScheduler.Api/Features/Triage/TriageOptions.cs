using System.ComponentModel.DataAnnotations;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Api.Features.Triage;

/// <summary>Presentation limits and confidence thresholds; shares the Triage configuration section with the outbound adapter.</summary>
public sealed class TriageOptions
{
    [Range(1, 500)]
    public int MaxDescriptionLength { get; set; } = 500;
    [Range(0.0, 1.0)]
    public double SuggestThreshold { get; set; } = 0.7;
    [Range(0.0, 1.0)]
    public double DateThreshold { get; set; } = 0.6;
    [Range(0.0, 1.0)]
    public double CandidateFloor { get; set; } = 0.1;
}

[OptionsValidator]
public sealed partial class TriageOptionsValidator : IValidateOptions<TriageOptions>;
