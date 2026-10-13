using Keyloop.ServiceScheduler.Domain.Resources;

namespace Keyloop.ServiceScheduler.Domain.Scheduling;

/// <summary>The complete hard requirements at booking, independent of subsequent roster and policy edits.</summary>
public sealed record RecordedRequirements(BayCapability[] BayCapabilities, Certification[] Certifications, int MinimumHvLevel)
{
    public bool Equals(RecordedRequirements? other) => other is not null && MinimumHvLevel == other.MinimumHvLevel
        && BayCapabilities.SequenceEqual(other.BayCapabilities) && Certifications.SequenceEqual(other.Certifications);

    public override int GetHashCode()
    {
        var hash = new HashCode();
        hash.Add(MinimumHvLevel);
        foreach (var value in BayCapabilities) { hash.Add(value); }
        foreach (var value in Certifications) { hash.Add(value); }
        return hash.ToHashCode();
    }
}
