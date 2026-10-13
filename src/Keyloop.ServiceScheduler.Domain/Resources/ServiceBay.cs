using Keyloop.ServiceScheduler.Domain.Catalog;
using Keyloop.ServiceScheduler.Domain.Common;
using Keyloop.ServiceScheduler.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.Domain.Resources;

/// <summary>A physical workspace at one dealership, with the capabilities that decide which service types it can host.</summary>
public sealed class ServiceBay : Entity
{
    // EF Core materialisation.
    private ServiceBay()
    {
        Name = string.Empty;
        Capabilities = new HashSet<BayCapability>();
    }

    private ServiceBay(Guid id, Guid dealershipId, string name, HashSet<BayCapability> capabilities, bool isActive)
    {
        Id = id;
        DealershipId = dealershipId;
        Name = name;
        Capabilities = capabilities;
        IsActive = isActive;
    }

    public Guid DealershipId { get; private set; }

    public string Name { get; private set; }

    /// <summary>Backed by a <see cref="HashSet{T}"/>; persisted as a <c>text[]</c> column.</summary>
    public IReadOnlySet<BayCapability> Capabilities { get; private set; }

    public bool IsActive { get; private set; }

    public uint RowVersion { get; private set; }

    public void Edit(string name, IEnumerable<BayCapability> capabilities, bool isActive)
    {
        var validated = Create(Id, DealershipId, name, capabilities, isActive);
        Name = validated.Name;
        Capabilities = validated.Capabilities;
        IsActive = validated.IsActive;
    }

    public static ServiceBay Create(Guid id, Guid dealershipId, string name, IEnumerable<BayCapability> capabilities, bool isActive = true) =>
        new(
            Guard.NotEmpty(id, nameof(id)),
            Guard.NotEmpty(dealershipId, nameof(dealershipId)),
            Guard.Required(name, 1, 100, nameof(name)),
            Guard.DefinedSet(capabilities, nameof(capabilities)),
            isActive);

    /// <summary>All-of semantics: the bay has every capability the service type requires.</summary>
    public bool Supports(ServiceType serviceType) => serviceType.RequiredBayCapabilities.IsSubsetOf(Capabilities);

    /// <summary>Capabilities beyond what the service needs; the allocation policy prefers the bay that wastes the fewest.</summary>
    public int SurplusCapabilitiesFor(ServiceType serviceType) => Capabilities.Count - serviceType.RequiredBayCapabilities.Count;

    public bool Satisfies(JobRequirements requirements) => IsActive && requirements.BayCapabilities.IsSubsetOf(Capabilities);

    public void Deactivate() => IsActive = false;

    public void Activate() => IsActive = true;
}
