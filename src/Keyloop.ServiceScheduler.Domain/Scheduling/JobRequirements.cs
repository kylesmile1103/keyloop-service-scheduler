using Keyloop.ServiceScheduler.Domain.Resources;

namespace Keyloop.ServiceScheduler.Domain.Scheduling;

/// <summary>A resolved policy snapshot for a service job.</summary>
public sealed record JobRequirements(IReadOnlySet<BayCapability> BayCapabilities, IReadOnlySet<Certification> Certifications,
    int MinimumHvLevel, int PolicyVersion, IReadOnlyList<string> FiredRules)
{
    public string? RequiredBrand => null;
}
