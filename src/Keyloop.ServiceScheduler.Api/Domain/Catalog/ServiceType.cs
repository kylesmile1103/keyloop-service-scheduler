using System.Text.RegularExpressions;
using Keyloop.ServiceScheduler.Api.Domain.Common;
using Keyloop.ServiceScheduler.Api.Domain.Resources;

namespace Keyloop.ServiceScheduler.Api.Domain.Catalog;

/// <summary>A catalogue entry: what a service takes (duration) and what it needs (bay capabilities and technician certifications, all-of).</summary>
public sealed partial class ServiceType : Entity
{
    // EF Core materialisation.
    private ServiceType()
    {
        Code = string.Empty;
        Name = string.Empty;
        RequiredBayCapabilities = new HashSet<BayCapability>();
        RequiredCertifications = new HashSet<Certification>();
    }

    private ServiceType(
        Guid id, string code, string name, ServiceDuration duration, HashSet<BayCapability> requiredBayCapabilities, HashSet<Certification> requiredCertifications)
    {
        Id = id;
        Code = code;
        Name = name;
        Duration = duration;
        RequiredBayCapabilities = requiredBayCapabilities;
        RequiredCertifications = requiredCertifications;
    }

    /// <summary>Stable upper-kebab identifier, 2–32 characters (e.g. <c>EV-BATTERY-CHECK</c>); unique across the catalogue.</summary>
    public string Code { get; private set; }

    public string Name { get; private set; }

    public ServiceDuration Duration { get; private set; }

    /// <summary>Backed by a <see cref="HashSet{T}"/>; persisted as a <c>text[]</c> column. Never empty.</summary>
    public IReadOnlySet<BayCapability> RequiredBayCapabilities { get; private set; }

    /// <summary>Backed by a <see cref="HashSet{T}"/>; persisted as a <c>text[]</c> column. Never empty.</summary>
    public IReadOnlySet<Certification> RequiredCertifications { get; private set; }

    public static ServiceType Create(
        Guid id,
        string code,
        string name,
        ServiceDuration duration,
        IEnumerable<BayCapability> requiredBayCapabilities,
        IEnumerable<Certification> requiredCertifications)
    {
        Guard.NotEmpty(id, nameof(id));

        var trimmedCode = Guard.Required(code, 2, 32, nameof(code));
        if (!CodePattern().IsMatch(trimmedCode))
        {
            throw new ArgumentException("Service type code must be upper-kebab case, e.g. EV-BATTERY-CHECK.", nameof(code));
        }

        var trimmedName = Guard.Required(name, 1, 120, nameof(name));

        // default(ServiceDuration) bypasses ServiceDuration.Create; reject it here.
        if (duration.Minutes <= 0)
        {
            throw new ArgumentException("Service duration must be created with ServiceDuration.Create.", nameof(duration));
        }

        var capabilities = Guard.DefinedSet(requiredBayCapabilities, nameof(requiredBayCapabilities));
        if (capabilities.Count == 0)
        {
            throw new ArgumentException("A service type must require at least one bay capability.", nameof(requiredBayCapabilities));
        }

        var certifications = Guard.DefinedSet(requiredCertifications, nameof(requiredCertifications));
        if (certifications.Count == 0)
        {
            throw new ArgumentException("A service type must require at least one technician certification.", nameof(requiredCertifications));
        }

        return new ServiceType(id, trimmedCode, trimmedName, duration, capabilities, certifications);
    }

    [GeneratedRegex("^[A-Z0-9]+(?:-[A-Z0-9]+)*$", RegexOptions.CultureInvariant)]
    private static partial Regex CodePattern();
}
