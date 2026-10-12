using Keyloop.ServiceScheduler.Domain.Resources;

namespace Keyloop.ServiceScheduler.Domain.Scheduling;

public enum AllocationCriterion { OnlyQualifiedResource, PreferredResource, SurplusCompetences, LowestLoad, Name, Id }

/// <summary>The persisted explanation is a snapshot of the policy and minimum in force when allocated.</summary>
/// <param name="DecidedBy">First comparison separating the technician winner from the runner-up, or OnlyQualifiedResource.</param>
/// <param name="BayDecidedBy">The separate deciding criterion for the service bay.</param>
/// <param name="PolicyVersion">The resolved dealership policy version at booking.</param>
/// <param name="MinimumHvLevel">The resolved HV competence floor at booking.</param>
/// <param name="FiredRules">Policy rule codes in deterministic order.</param>
/// <param name="Reasons">Bounded exclusion reason codes for preferred resources that were not chosen.</param>
/// <param name="PreferredBayId">Original preferred bay hint, including one excluded by qualification or busy time.</param>
/// <param name="PreferredTechnicianId">Original preferred technician hint.</param>
public sealed record AllocationDecision(AllocationCriterion DecidedBy, AllocationCriterion BayDecidedBy, int PolicyVersion,
    int MinimumHvLevel, IReadOnlyList<string> FiredRules, IReadOnlyList<string> Reasons, Guid? PreferredBayId, Guid? PreferredTechnicianId)
{
    public bool Equals(AllocationDecision? other) => other is not null && DecidedBy == other.DecidedBy && BayDecidedBy == other.BayDecidedBy
        && PreferredBayId == other.PreferredBayId && PreferredTechnicianId == other.PreferredTechnicianId
        && PolicyVersion == other.PolicyVersion && MinimumHvLevel == other.MinimumHvLevel
        && FiredRules.SequenceEqual(other.FiredRules, StringComparer.Ordinal) && Reasons.SequenceEqual(other.Reasons, StringComparer.Ordinal);

    public override int GetHashCode()
    {
        var hash = new HashCode();
        hash.Add(DecidedBy);
        hash.Add(BayDecidedBy);
        hash.Add(PolicyVersion);
        hash.Add(PreferredBayId);
        hash.Add(PreferredTechnicianId);
        hash.Add(MinimumHvLevel);
        foreach (var rule in FiredRules) { hash.Add(rule, StringComparer.Ordinal); }
        foreach (var reason in Reasons) { hash.Add(reason, StringComparer.Ordinal); }
        return hash.ToHashCode();
    }
}

public sealed record AllocationResult(ServiceBay Bay, Technician Technician, AllocationDecision Decision);
