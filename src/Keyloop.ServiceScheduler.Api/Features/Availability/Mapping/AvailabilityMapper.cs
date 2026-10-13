using Keyloop.ServiceScheduler.Api.Common.Contracts;
using Keyloop.ServiceScheduler.Domain.Dealerships;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Api.Features.Availability.GetAvailability;
using Riok.Mapperly.Abstractions;

namespace Keyloop.ServiceScheduler.Api.Features.Availability.Mapping;

/// <summary>Compile-time Mapperly mappings for availability responses.</summary>
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

    private static partial AvailabilitySlotResponse MapSlot(AvailabilitySlot slot, string startLocal);

    private static partial OperatingWindowResponse MapWindow(OperatingWindow window, string opensAtLocal, string closesAtLocal);
}
