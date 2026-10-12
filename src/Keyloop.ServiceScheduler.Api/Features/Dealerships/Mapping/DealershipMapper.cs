using System.Globalization;
using Keyloop.ServiceScheduler.Domain.Dealerships;
using Keyloop.ServiceScheduler.Api.Features.Dealerships.GetDealerships;
using Riok.Mapperly.Abstractions;

namespace Keyloop.ServiceScheduler.Api.Features.Dealerships.Mapping;

/// <summary>
/// Dealership responses, generated at compile time by Mapperly (ADR-016, Addendum A §A6). An unmapped target member is a build
/// error (<see cref="RequiredMappingStrategy.Target"/>); source members the responses do not expose (creation time, domain events)
/// are left out by design.
/// </summary>
[Mapper(RequiredMappingStrategy = RequiredMappingStrategy.Target, EnumMappingStrategy = EnumMappingStrategy.ByName)]
public static partial class DealershipMapper
{
    [MapProperty(nameof(Dealership.Hours), nameof(DealershipResponse.OperatingHours), Use = nameof(MapWeek))]
    public static partial DealershipResponse ToResponse(Dealership dealership);

    private static partial DayOperatingHoursResponse MapDay(DayOperatingHours day);

    // The persisted days carry no order; the response lists Monday to Sunday (DayOfWeek itself starts on Sunday).
    private static IReadOnlyList<DayOperatingHoursResponse> MapWeek(OperatingHours hours) =>
        [.. hours.Days.OrderBy(day => ((int)day.Day + 6) % 7).Select(MapDay)];

    // Picked by signature for OpensAt and ClosesAt; a closed day stays null.
    private static string? FormatTime(TimeOnly? time) => time?.ToString("HH:mm", CultureInfo.InvariantCulture);
}
