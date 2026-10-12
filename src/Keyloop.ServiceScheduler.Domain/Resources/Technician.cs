using Keyloop.ServiceScheduler.Domain.Catalog;
using Keyloop.ServiceScheduler.Domain.Common;
using Keyloop.ServiceScheduler.Domain.Scheduling;

namespace Keyloop.ServiceScheduler.Domain.Resources;

/// <summary>A technician employed at one dealership, with the certifications that decide which service types they may perform.</summary>
public sealed class Technician : Entity
{
    // EF Core materialisation.
    private Technician()
    {
        Name = string.Empty;
        EmployeeNumber = string.Empty;
        Certifications = new HashSet<Certification>();
    }

    private Technician(Guid id, Guid dealershipId, string name, string employeeNumber, HashSet<Certification> certifications, bool isActive)
    {
        Id = id;
        DealershipId = dealershipId;
        Name = name;
        EmployeeNumber = employeeNumber;
        Certifications = certifications;
        IsActive = isActive;
    }

    public Guid DealershipId { get; private set; }

    public string Name { get; private set; }

    /// <summary>Unique per dealership (enforced by the database).</summary>
    public string EmployeeNumber { get; private set; }

    /// <summary>Backed by a <see cref="HashSet{T}"/>; persisted as a <c>text[]</c> column.</summary>
    public IReadOnlySet<Certification> Certifications { get; private set; }

    public bool IsActive { get; private set; }

    public int HvLevel { get; private set; }
    public DateOnly? HvLevelValidUntil { get; private set; }
    public bool HvLevelConfirmed { get; private set; }
    public IReadOnlySet<string> BrandSpecialisms { get; private set; } = new HashSet<string>(StringComparer.Ordinal);

    public void SetCompetence(int hvLevel, DateOnly? validUntil, bool confirmed, IEnumerable<string>? brandSpecialisms = null)
    {
        if (hvLevel is < 0 or > 4)
        {
            throw new ArgumentOutOfRangeException(nameof(hvLevel));
        }
        HvLevel = hvLevel;
        HvLevelValidUntil = validUntil;
        HvLevelConfirmed = confirmed;
        BrandSpecialisms = (brandSpecialisms ?? []).Select(VehicleProfile.NormalizeManufacturer).ToHashSet(StringComparer.Ordinal);
    }

    public int EffectiveHvLevel(DateOnly localDate) => HvLevelValidUntil is { } expiry && expiry < localDate ? 0 : HvLevel;

    public bool Satisfies(JobRequirements requirements, DateOnly localDate) => IsActive
        && requirements.Certifications.IsSubsetOf(Certifications) && EffectiveHvLevel(localDate) >= requirements.MinimumHvLevel;

    public static Technician Create(
        Guid id, Guid dealershipId, string name, string employeeNumber, IEnumerable<Certification> certifications, bool isActive = true,
        int hvLevel = 0, DateOnly? hvLevelValidUntil = null, bool hvLevelConfirmed = false, IEnumerable<string>? brandSpecialisms = null)
    {
        var technician = new Technician(
            Guard.NotEmpty(id, nameof(id)),
            Guard.NotEmpty(dealershipId, nameof(dealershipId)),
            Guard.Required(name, 1, 120, nameof(name)),
            Guard.Required(employeeNumber, 1, 32, nameof(employeeNumber)),
            Guard.DefinedSet(certifications, nameof(certifications)),
            isActive);
        technician.SetCompetence(hvLevel, hvLevelValidUntil, hvLevelConfirmed, brandSpecialisms);
        return technician;
    }

    /// <summary>All-of semantics: the technician holds every certification the service type requires.</summary>
    public bool IsCertifiedFor(ServiceType serviceType) => serviceType.RequiredCertifications.IsSubsetOf(Certifications);

    /// <summary>Certifications beyond what the service needs; the allocation policy prefers the technician who wastes the fewest.</summary>
    public int SurplusCertificationsFor(ServiceType serviceType) => Certifications.Count - serviceType.RequiredCertifications.Count;
}
