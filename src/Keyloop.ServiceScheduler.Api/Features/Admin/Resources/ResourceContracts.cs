using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using Keyloop.ServiceScheduler.Api.Common.Serialization;
using Keyloop.ServiceScheduler.Domain.Resources;
using Riok.Mapperly.Abstractions;

namespace Keyloop.ServiceScheduler.Api.Features.Admin.Resources;

/// <summary>Complete technician state. Names and employee numbers are bounded reference fields, never notes.</summary>
/// <param name="Name" example="Amelia Clarke">Display name, 1..120 trimmed characters.</param>
/// <param name="EmployeeNumber" example="T-1001">Unique within this dealership, 1..32 trimmed characters.</param>
/// <param name="Certifications">Task qualifications. Empty is permitted.</param>
/// <param name="IsActive">False deactivates without changing existing appointments.</param>
/// <param name="HvLevel">HV level, zero to four; unconfirmed levels still count.</param>
/// <param name="HvLevelValidUntil">Inclusive dealership-local expiry; null means unlimited. Required: send null explicitly.</param>
/// <param name="HvLevelConfirmed">A person's confirmation of the recorded level.</param>
/// <param name="BrandSpecialisms">At most 16 normalized OEM codes of at most 32 characters, data only.</param>
public sealed record TechnicianWriteRequest(
    [property: Required, StringLength(120, MinimumLength = 1)] string Name,
    [property: Required, StringLength(32, MinimumLength = 1)] string EmployeeNumber,
    [property: Required, JsonConverter(typeof(ExactEnumNameArrayConverter<Certification>))] Certification[] Certifications,
    [property: JsonRequired] bool IsActive,
    [property: JsonRequired, Range(0, 4)] int HvLevel,
    [property: JsonRequired] DateOnly? HvLevelValidUntil,
    [property: JsonRequired] bool HvLevelConfirmed,
    [property: Required] string[] BrandSpecialisms);

/// <summary>Full Admin resource representation. Version is PostgreSQL xmin, also returned as a strong ETag.</summary>
public sealed record AdminTechnicianResponse(Guid Id, Guid DealershipId, string Name, string EmployeeNumber,
    IReadOnlyList<Certification> Certifications, bool IsActive, int HvLevel, DateOnly? HvLevelValidUntil,
    [property: JsonRequired] bool HvLevelConfirmed, IReadOnlyList<string> BrandSpecialisms, uint Version);

/// <summary>Complete service-bay state; taking a bay out of service preserves its appointments and history.</summary>
/// <param name="Name" example="Bay 1 - Standard">Display name, 1..100 trimmed characters.</param>
/// <param name="Capabilities">Equipment capabilities; empty is permitted.</param>
/// <param name="IsActive">Whether this bay accepts new bookings.</param>
public sealed record BayWriteRequest([property: Required, StringLength(100, MinimumLength = 1)] string Name,
    [property: Required, JsonConverter(typeof(ExactEnumNameArrayConverter<BayCapability>))] BayCapability[] Capabilities, [property: JsonRequired] bool IsActive);

/// <summary>Full Admin bay representation. Version is PostgreSQL xmin, also returned as a strong ETag.</summary>
public sealed record AdminBayResponse(Guid Id, Guid DealershipId, string Name, IReadOnlyList<BayCapability> Capabilities, bool IsActive, uint Version);

[Mapper(RequiredMappingStrategy = RequiredMappingStrategy.Target)]
public static partial class AdminResourceMapper
{
    [MapProperty(nameof(Technician.RowVersion), nameof(AdminTechnicianResponse.Version))]
    public static partial AdminTechnicianResponse ToResponse(Technician technician);
    [MapProperty(nameof(ServiceBay.RowVersion), nameof(AdminBayResponse.Version))]
    public static partial AdminBayResponse ToResponse(ServiceBay bay);
    public static partial TechnicianWriteRequest Snapshot(Technician technician);
    public static partial BayWriteRequest Snapshot(ServiceBay bay);
    private static IReadOnlyList<Certification> Certifications(IReadOnlySet<Certification> values) => values.Order().ToArray();
    private static Certification[] CertificationArray(IReadOnlySet<Certification> values) => values.Order().ToArray();
    private static IReadOnlyList<BayCapability> Capabilities(IReadOnlySet<BayCapability> values) => values.Order().ToArray();
    private static BayCapability[] CapabilityArray(IReadOnlySet<BayCapability> values) => values.Order().ToArray();
    private static IReadOnlyList<string> Brands(IReadOnlySet<string> values) => values.Order(StringComparer.Ordinal).ToArray();
    private static string[] BrandArray(IReadOnlySet<string> values) => values.Order(StringComparer.Ordinal).ToArray();
}
