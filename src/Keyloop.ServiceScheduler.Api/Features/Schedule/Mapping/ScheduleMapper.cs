using AppointmentRow = Keyloop.ServiceScheduler.Infrastructure.Persistence.Queries.DayScheduleReader.AppointmentRow;
using Keyloop.ServiceScheduler.Api.Common.Contracts;
using Keyloop.ServiceScheduler.Api.Features.Schedule.GetWorkshopSchedule;
using Keyloop.ServiceScheduler.Domain.Catalog;
using Keyloop.ServiceScheduler.Domain.Dealerships;
using Keyloop.ServiceScheduler.Domain.Resources;
using Riok.Mapperly.Abstractions;

namespace Keyloop.ServiceScheduler.Api.Features.Schedule.Mapping;

/// <summary>Compile-time Mapperly mappings for workshop schedule responses.</summary>
[Mapper(RequiredMappingStrategy = RequiredMappingStrategy.Target, EnumMappingStrategy = EnumMappingStrategy.ByName)]
public static partial class ScheduleMapper
{
    public static partial DealershipSummary ToSummary(Dealership dealership);

    /// <summary>An operating window, with opening and closing as local wall-clock times in <paramref name="zone"/>.</summary>
    public static OperatingWindowResponse ToResponse(OperatingWindow window, TimeZoneInfo zone) =>
        MapWindow(
            window,
            opensAtLocal: LocalTimeConverter.FormatLocal(window.StartUtc, zone),
            closesAtLocal: LocalTimeConverter.FormatLocal(window.EndUtc, zone));

    /// <summary>A bay as a lane of the board, holding <paramref name="appointments"/> (already mapped and ordered by start).</summary>
    public static partial BayScheduleResponse ToResponse(ServiceBay bay, IReadOnlyList<ScheduledAppointmentResponse> appointments);

    public static TechnicianResponse ToResponse(Technician technician) => MapTechnician(technician, null, null, null, null);

    /// <summary>Maps a technician to a schedule response, including competence fields when <paramref name="vehicleAware"/> is true.</summary>
    public static TechnicianResponse ToResponse(Technician technician, bool vehicleAware) => MapTechnician(technician,
        vehicleAware ? technician.HvLevel : null,
        vehicleAware ? technician.HvLevelValidUntil : null,
        vehicleAware ? technician.HvLevelConfirmed : null,
        vehicleAware ? technician.BrandSpecialisms.Order(StringComparer.Ordinal).ToArray() : null);

    private static partial TechnicianResponse MapTechnician(Technician technician, int? hvLevel, DateOnly? hvLevelValidUntil,
        bool? hvLevelConfirmed, IReadOnlyList<string>? brandSpecialisms);

    /// <summary>Maps an appointment projection row with its service, technician, and local start/end times.</summary>
    public static ScheduledAppointmentResponse ToResponse(AppointmentRow appointment, ServiceTypeSummary serviceType, ResourceSummary technician, TimeZoneInfo zone)
    {
        ArgumentNullException.ThrowIfNull(appointment);
        return MapAppointment(
            appointment,
            serviceType,
            technician,
            startLocal: LocalTimeConverter.FormatLocal(appointment.Slot.StartUtc, zone),
            endLocal: LocalTimeConverter.FormatLocal(appointment.Slot.EndUtc, zone));
    }

    [MapProperty(nameof(ServiceType.Duration), nameof(ServiceTypeSummary.DurationMinutes), Use = nameof(MapDuration))]
    public static partial ServiceTypeSummary ToSummary(ServiceType serviceType);

    public static partial ResourceSummary ToSummary(Technician technician);

    private static partial OperatingWindowResponse MapWindow(OperatingWindow window, string opensAtLocal, string closesAtLocal);

    [MapProperty(nameof(@AppointmentRow.Slot.StartUtc), nameof(ScheduledAppointmentResponse.StartUtc))]
    [MapProperty(nameof(@AppointmentRow.Slot.EndUtc), nameof(ScheduledAppointmentResponse.EndUtc))]
    [MapperIgnoreTarget(nameof(ScheduledAppointmentResponse.CompetenceWarning))]
    private static partial ScheduledAppointmentResponse MapAppointment(
        AppointmentRow appointment, ServiceTypeSummary serviceType, ResourceSummary technician, string startLocal, string endLocal);

    private static int MapDuration(ServiceDuration duration) => duration.Minutes;

    private static IReadOnlyList<BayCapability> MapCapabilities(IReadOnlySet<BayCapability> capabilities) => [.. capabilities.Order()];

    private static IReadOnlyList<Certification> MapCertifications(IReadOnlySet<Certification> certifications) => [.. certifications.Order()];
}
