using Keyloop.ServiceScheduler.Api.Common.Contracts;
using Keyloop.ServiceScheduler.Domain.Catalog;
using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Api.Features.Appointments.Shared;
using Riok.Mapperly.Abstractions;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.Mapping;

/// <summary>
/// Appointment responses, generated at compile time by Mapperly (ADR-016, Addendum A §A6). An unmapped target member is a build
/// error (<see cref="RequiredMappingStrategy.Target"/>). The aggregate references its service type and resources by id only, so their
/// summaries and the local times (computed in the dealership's zone) arrive as additional parameters, matched to the target members of
/// the same name. Use <see cref="AppointmentResponseMapper.Map"/>, which computes them.
/// </summary>
[Mapper(RequiredMappingStrategy = RequiredMappingStrategy.Target, EnumMappingStrategy = EnumMappingStrategy.ByName)]
public static partial class AppointmentMapper
{
    /// <summary>The response for <paramref name="appointment"/>; the other parameters fill the members of the same name.</summary>
    [MapProperty(nameof(@Appointment.Slot.StartUtc), nameof(AppointmentResponse.StartUtc))]
    [MapProperty(nameof(@Appointment.Slot.EndUtc), nameof(AppointmentResponse.EndUtc))]
    public static partial AppointmentResponse ToResponse(
        Appointment appointment, ServiceTypeSummary serviceType, ResourceSummary bay, ResourceSummary technician, string startLocal, string endLocal);

    public static partial CustomerResponse ToResponse(CustomerDetails customer);

    public static partial VehicleResponse ToResponse(VehicleDetails vehicle);

    [MapProperty(nameof(ServiceType.Duration), nameof(ServiceTypeSummary.DurationMinutes), Use = nameof(MapDuration))]
    public static partial ServiceTypeSummary ToSummary(ServiceType serviceType);

    public static partial ResourceSummary ToSummary(ServiceBay bay);

    public static partial ResourceSummary ToSummary(Technician technician);

    private static string MapVin(Vin vin) => vin.Value;

    private static int MapDuration(ServiceDuration duration) => duration.Minutes;
}
