using Keyloop.ServiceScheduler.Domain.Catalog;
using Keyloop.ServiceScheduler.Domain.Common;
using Keyloop.ServiceScheduler.Domain.Resources;

namespace Keyloop.ServiceScheduler.Domain.Scheduling;

/// <summary>
/// Picks one bay and one technician among those already known to be free and qualified at the requested start (ARCHITECTURE §6.3).
/// Deterministic greedy order: the preferred resource if it is among the candidates; otherwise the fewest surplus
/// capabilities/certifications (keep specialised capacity free), then the lowest load that day (a missing entry counts as 0), then
/// <c>Name</c> (ordinal), then <c>Id</c>.
/// </summary>
public static class AllocationPolicy
{
    /// <returns>The chosen bay, or <see langword="null"/> when there are no candidates.</returns>
    public static ServiceBay? ChooseBay(
        IReadOnlyList<ServiceBay> freeCompatibleBays, ServiceType serviceType, IReadOnlyDictionary<Guid, int> loadToday, Guid? preferredBayId)
    {
        ArgumentNullException.ThrowIfNull(freeCompatibleBays);
        ArgumentNullException.ThrowIfNull(serviceType);
        ArgumentNullException.ThrowIfNull(loadToday);
        return Choose(freeCompatibleBays, preferredBayId, bay => bay.SurplusCapabilitiesFor(serviceType), bay => bay.Name, loadToday, nameof(freeCompatibleBays));
    }

    /// <returns>The chosen technician, or <see langword="null"/> when there are no candidates.</returns>
    public static Technician? ChooseTechnician(
        IReadOnlyList<Technician> freeCertifiedTechnicians, ServiceType serviceType, IReadOnlyDictionary<Guid, int> loadToday, Guid? preferredTechnicianId)
    {
        ArgumentNullException.ThrowIfNull(freeCertifiedTechnicians);
        ArgumentNullException.ThrowIfNull(serviceType);
        ArgumentNullException.ThrowIfNull(loadToday);
        return Choose(
            freeCertifiedTechnicians,
            preferredTechnicianId,
            technician => technician.SurplusCertificationsFor(serviceType),
            technician => technician.Name,
            loadToday,
            nameof(freeCertifiedTechnicians));
    }

    /// <summary>Filters hard constraints and busy resources, then explains the first comparison separating the winner from its runner-up.</summary>
    public static AllocationResult? Allocate(
        IReadOnlyList<ServiceBay> bays, IReadOnlyList<Technician> technicians, JobRequirements requirements, DateOnly localDate,
        IReadOnlySet<Guid> busyBays, IReadOnlySet<Guid> busyTechnicians, IReadOnlyDictionary<Guid, int> loadToday,
        Guid? preferredBayId, Guid? preferredTechnicianId)
    {
        ArgumentNullException.ThrowIfNull(requirements);
        var freeBays = bays.Where(b => b.Satisfies(requirements) && !busyBays.Contains(b.Id)).ToArray();
        var freeTechnicians = technicians.Where(t => t.Satisfies(requirements, localDate) && !busyTechnicians.Contains(t.Id)).ToArray();
        var (bay, bayCriterion) = Explain(freeBays, preferredBayId, b => b.Capabilities.Count - requirements.BayCapabilities.Count, b => b.Name, loadToday);
        var (technician, criterion) = Explain(freeTechnicians, preferredTechnicianId,
            t => t.Certifications.Count(c => c != Certification.HighVoltageElectrical) - requirements.Certifications.Count
                + t.EffectiveHvLevel(localDate) - requirements.MinimumHvLevel, t => t.Name, loadToday);
        if (bay is null || technician is null)
        {
            return null;
        }
        var reasons = new List<string>();
        if (preferredBayId is { } bayId && bay.Id != bayId)
        {
            var preferred = bays.FirstOrDefault(b => b.Id == bayId);
            reasons.Add(preferred is null ? "preferred-bay:not-at-dealership" : !preferred.IsActive ? "preferred-bay:inactive"
                : !preferred.Satisfies(requirements) ? "preferred-bay:missing-capabilities" : "preferred-bay:busy");
        }
        if (preferredTechnicianId is { } techId && technician.Id != techId)
        {
            var preferred = technicians.FirstOrDefault(t => t.Id == techId);
            reasons.Add(preferred is null ? "preferred-technician:not-at-dealership" : !preferred.IsActive ? "preferred-technician:inactive"
                : !requirements.Certifications.IsSubsetOf(preferred.Certifications) ? "preferred-technician:missing-certifications"
                : preferred.EffectiveHvLevel(localDate) < requirements.MinimumHvLevel
                    ? preferred.HvLevel >= requirements.MinimumHvLevel ? "preferred-technician:hv-expired" : "preferred-technician:minimum-hv-level"
                : "preferred-technician:busy");
        }
        return new(bay, technician, new(criterion, bayCriterion, requirements.PolicyVersion, requirements.MinimumHvLevel, requirements.FiredRules, reasons.ToArray(), preferredBayId, preferredTechnicianId));
    }

    private static (T? Resource, AllocationCriterion Criterion) Explain<T>(IReadOnlyList<T> candidates, Guid? preferred,
        Func<T, int> surplus, Func<T, string> name, IReadOnlyDictionary<Guid, int> load) where T : Entity
    {
        var ordered = candidates.OrderBy(c => c.Id == preferred ? 0 : 1).ThenBy(surplus).ThenBy(c => load.GetValueOrDefault(c.Id))
            .ThenBy(name, StringComparer.Ordinal).ThenBy(c => c.Id).ToArray();
        if (ordered.Length < 2)
        {
            return (ordered.FirstOrDefault(), AllocationCriterion.OnlyQualifiedResource);
        }
        var winner = ordered[0];
        var runner = ordered[1];
        var criterion = winner.Id == preferred ? AllocationCriterion.PreferredResource
            : surplus(winner) != surplus(runner) ? AllocationCriterion.SurplusCompetences
            : load.GetValueOrDefault(winner.Id) != load.GetValueOrDefault(runner.Id) ? AllocationCriterion.LowestLoad
            : !string.Equals(name(winner), name(runner), StringComparison.Ordinal) ? AllocationCriterion.Name : AllocationCriterion.Id;
        return (winner, criterion);
    }

    private static T? Choose<T>(
        IReadOnlyList<T> candidates, Guid? preferredId, Func<T, int> surplus, Func<T, string> name, IReadOnlyDictionary<Guid, int> loadToday, string paramName)
        where T : Entity
    {
        if (candidates.Any(c => c is null))
        {
            throw new ArgumentException("Candidates cannot contain null.", paramName);
        }

        if (preferredId is { } id && candidates.FirstOrDefault(c => c.Id == id) is { } preferred)
        {
            return preferred;
        }

        return candidates
            .OrderBy(surplus)
            .ThenBy(c => loadToday.GetValueOrDefault(c.Id))
            .ThenBy(name, StringComparer.Ordinal)
            .ThenBy(c => c.Id)
            .FirstOrDefault();
    }
}
