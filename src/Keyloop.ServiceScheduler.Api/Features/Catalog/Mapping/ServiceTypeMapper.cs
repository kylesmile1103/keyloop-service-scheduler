using Keyloop.ServiceScheduler.Domain.Catalog;
using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Api.Features.Catalog.GetServiceTypes;
using Riok.Mapperly.Abstractions;

namespace Keyloop.ServiceScheduler.Api.Features.Catalog.Mapping;

/// <summary>Compile-time Mapperly mapper for service catalogue responses.</summary>
[Mapper(RequiredMappingStrategy = RequiredMappingStrategy.Target, EnumMappingStrategy = EnumMappingStrategy.ByName)]
public static partial class ServiceTypeMapper
{
    /// <summary>Maps a <see cref="ServiceType"/> and its dealership-specific bookability to <see cref="ServiceTypeResponse"/>.</summary>
    [MapProperty(nameof(ServiceType.Duration), nameof(ServiceTypeResponse.DurationMinutes), Use = nameof(MapDuration))]
    public static partial ServiceTypeResponse ToResponse(ServiceType serviceType, bool bookable);

    private static int MapDuration(ServiceDuration duration) => duration.Minutes;

    private static IReadOnlyList<BayCapability> MapCapabilities(IReadOnlySet<BayCapability> capabilities) => [.. capabilities.Order()];

    private static IReadOnlyList<Certification> MapCertifications(IReadOnlySet<Certification> certifications) => [.. certifications.Order()];
}
