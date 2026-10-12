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
