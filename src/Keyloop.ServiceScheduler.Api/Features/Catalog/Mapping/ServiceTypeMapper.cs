using Keyloop.ServiceScheduler.Domain.Catalog;
using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Api.Features.Catalog.GetServiceTypes;
using Riok.Mapperly.Abstractions;

namespace Keyloop.ServiceScheduler.Api.Features.Catalog.Mapping;

/// <summary>
/// Service catalogue responses, generated at compile time by Mapperly (ADR-016, Addendum A §A6). An unmapped target member is a
/// build error (<see cref="RequiredMappingStrategy.Target"/>).
/// </summary>
[Mapper(RequiredMappingStrategy = RequiredMappingStrategy.Target, EnumMappingStrategy = EnumMappingStrategy.ByName)]
public static partial class ServiceTypeMapper
{
    /// <summary>The response for one catalogue entry, with <paramref name="bookable"/> as computed for the route dealership.</summary>
    /// <param name="serviceType">The catalogue entry.</param>
    /// <param name="bookable">An additional mapping parameter: Mapperly matches it to <see cref="ServiceTypeResponse.Bookable"/> by name.</param>
    [MapProperty(nameof(ServiceType.Duration), nameof(ServiceTypeResponse.DurationMinutes), Use = nameof(MapDuration))]
    public static partial ServiceTypeResponse ToResponse(ServiceType serviceType, bool bookable);

    private static int MapDuration(ServiceDuration duration) => duration.Minutes;

    // The domain holds the requirements as sets; the response orders them so the JSON does not depend on hash-set iteration order.
    private static IReadOnlyList<BayCapability> MapCapabilities(IReadOnlySet<BayCapability> capabilities) => [.. capabilities.Order()];

    private static IReadOnlyList<Certification> MapCertifications(IReadOnlySet<Certification> certifications) => [.. certifications.Order()];
}
