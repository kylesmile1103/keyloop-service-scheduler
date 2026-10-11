using Keyloop.ServiceScheduler.Api.Domain.Dealerships;
using Keyloop.ServiceScheduler.Api.Domain.Scheduling;
using Keyloop.ServiceScheduler.Api.Features.Availability.GetAvailability;
using Riok.Mapperly.Abstractions;

namespace Keyloop.ServiceScheduler.Api.Features.Availability.Mapping;

/// <summary>
/// Availability responses, generated at compile time by Mapperly (ADR-016, Addendum A §A6). An unmapped target member is a build
/// error (<see cref="RequiredMappingStrategy.Target"/>). The domain works in UTC only, so the local wall-clock strings are computed
/// in the dealership's zone by the public wrappers and passed to the generated mappings as additional parameters.
/// </summary>
[Mapper(RequiredMappingStrategy = RequiredMappingStrategy.Target, EnumMappingStrategy = EnumMappingStrategy.ByName)]
public static partial class AvailabilityMapper
{
    /// <summary>A computed slot, with its start as local wall-clock time in <paramref name="zone"/>.</summary>
    public static AvailabilitySlotResponse ToResponse(AvailabilitySlot slot, TimeZoneInfo zone)
    {
        ArgumentNullException.ThrowIfNull(slot);
        return MapSlot(slot, startLocal: LocalTimeConverter.FormatLocal(slot.StartUtc, zone));
    }

    /// <summary>An operating window, with opening and closing as local wall-clock times in <paramref name="zone"/>.</summary>
    public static OperatingWindowResponse ToResponse(OperatingWindow window, TimeZoneInfo zone) =>
        MapWindow(
            window,
            opensAtLocal: LocalTimeConverter.FormatLocal(window.StartUtc, zone),
            closesAtLocal: LocalTimeConverter.FormatLocal(window.EndUtc, zone));

    // The additional parameters are matched to the target members of the same name (StartLocal; OpensAtLocal, ClosesAtLocal).
    private static partial AvailabilitySlotResponse MapSlot(AvailabilitySlot slot, string startLocal);

    private static partial OperatingWindowResponse MapWindow(OperatingWindow window, string opensAtLocal, string closesAtLocal);
}
