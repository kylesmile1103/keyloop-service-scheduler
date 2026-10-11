using Keyloop.ServiceScheduler.Api.Common.Contracts;
using Keyloop.ServiceScheduler.Api.Domain.Catalog;
using Keyloop.ServiceScheduler.Api.Domain.Dealerships;
using Keyloop.ServiceScheduler.Api.Domain.Resources;
using Keyloop.ServiceScheduler.Api.Features.Schedule.GetWorkshopSchedule;
using Riok.Mapperly.Abstractions;
using AppointmentRow = Keyloop.ServiceScheduler.Api.Infrastructure.Persistence.Queries.DayScheduleReader.AppointmentRow;

namespace Keyloop.ServiceScheduler.Api.Features.Schedule.Mapping;

/// <summary>
/// Workshop schedule responses, generated at compile time by Mapperly (ADR-016, Addendum A §A6). An unmapped target member is a
/// build error (<see cref="RequiredMappingStrategy.Target"/>). The domain works in UTC only, so local wall-clock strings are computed
/// in the dealership's zone by the public wrappers and passed to the generated mappings as additional parameters, matched to the
/// target members of the same name; so are a bay's appointments and an appointment's service and technician summaries, which the
/// day's projection references by id only.
/// </summary>
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

    public static partial TechnicianResponse ToResponse(Technician technician);

    /// <summary>
    /// An appointment of the day's projection with its service and technician, start and end as local wall-clock times in
    /// <paramref name="zone"/>.
    /// </summary>
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
    private static partial ScheduledAppointmentResponse MapAppointment(
        AppointmentRow appointment, ServiceTypeSummary serviceType, ResourceSummary technician, string startLocal, string endLocal);

    private static int MapDuration(ServiceDuration duration) => duration.Minutes;

    // The domain holds capabilities and certifications as sets; the board lists them in the enumeration's declared order, so the
    // JSON does not depend on hash-set iteration order.
    private static IReadOnlyList<BayCapability> MapCapabilities(IReadOnlySet<BayCapability> capabilities) => [.. capabilities.Order()];

    private static IReadOnlyList<Certification> MapCertifications(IReadOnlySet<Certification> certifications) => [.. certifications.Order()];
}
