using Keyloop.ServiceScheduler.Domain.Resources;

namespace Keyloop.ServiceScheduler.Domain.Scheduling;

public enum AllocationCriterion { OnlyQualifiedResource, PreferredResource, SurplusCompetences, LowestLoad, Name, Id }

/// <summary>The persisted explanation is a snapshot of the policy and minimum in force when allocated.</summary>
public sealed record AllocationDecision(AllocationCriterion DecidedBy, AllocationCriterion BayDecidedBy, int PolicyVersion,
    int MinimumHvLevel, IReadOnlyList<string> FiredRules, IReadOnlyList<string> Reasons);

public sealed record AllocationResult(ServiceBay Bay, Technician Technician, AllocationDecision Decision);
