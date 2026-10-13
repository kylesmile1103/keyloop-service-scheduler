using System.Globalization;
using Keyloop.ServiceScheduler.Domain.Dealerships;
using Keyloop.ServiceScheduler.Api.Features.Dealerships.GetDealerships;
using Riok.Mapperly.Abstractions;

namespace Keyloop.ServiceScheduler.Api.Features.Dealerships.Mapping;

/// <summary>Compile-time Mapperly mapper for dealership responses.</summary>
[Mapper(RequiredMappingStrategy = RequiredMappingStrategy.Target, EnumMappingStrategy = EnumMappingStrategy.ByName)]
public static partial class DealershipMapper
{
    [MapProperty(nameof(Dealership.Hours), nameof(DealershipResponse.OperatingHours), Use = nameof(MapWeek))]
    public static partial DealershipResponse ToResponse(Dealership dealership);

    private static partial DayOperatingHoursResponse MapDay(DayOperatingHours day);

    private static IReadOnlyList<DayOperatingHoursResponse> MapWeek(OperatingHours hours) =>
        [.. hours.Days.OrderBy(day => ((int)day.Day + 6) % 7).Select(MapDay)];

    private static string? FormatTime(TimeOnly? time) => time?.ToString("HH:mm", CultureInfo.InvariantCulture);
}
