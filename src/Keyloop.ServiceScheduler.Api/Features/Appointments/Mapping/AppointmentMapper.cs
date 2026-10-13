using Keyloop.ServiceScheduler.Api.Common.Contracts;
using Keyloop.ServiceScheduler.Domain.Catalog;
using Keyloop.ServiceScheduler.Domain.Resources;
using Keyloop.ServiceScheduler.Domain.Scheduling;
using Keyloop.ServiceScheduler.Api.Features.Appointments.Shared;
using Keyloop.ServiceScheduler.Api.Features.Appointments.ListAppointments;
using Riok.Mapperly.Abstractions;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.Mapping;

/// <summary>Compile-time Mapperly mappings for appointment responses and summaries.</summary>
[Mapper(RequiredMappingStrategy = RequiredMappingStrategy.Target, EnumMappingStrategy = EnumMappingStrategy.ByName)]
public static partial class AppointmentMapper
{
    /// <summary>The response for <paramref name="appointment"/>; the other parameters fill the members of the same name.</summary>
    [MapProperty(nameof(@Appointment.Slot.StartUtc), nameof(AppointmentResponse.StartUtc))]
    [MapProperty(nameof(@Appointment.Slot.EndUtc), nameof(AppointmentResponse.EndUtc))]
    [MapProperty(nameof(Appointment.AllocationDecision), nameof(AppointmentResponse.Allocation))]
    [MapperIgnoreTarget(nameof(AppointmentResponse.CompetenceWarning))]
    public static partial AppointmentResponse ToResponse(
        Appointment appointment, ServiceTypeSummary serviceType, ResourceSummary bay, ResourceSummary technician, string startLocal, string endLocal);

    /// <summary>A range item; <c>ListAppointmentsResponseMapper</c> supplies the summaries and the audience-policy values.</summary>
    internal static partial AppointmentListItemResponse ToListItem(
        AppointmentListRow appointment, ServiceTypeSummary serviceType, ResourceSummary bay, ResourceSummary technician,
        string startLocal, string endLocal, string customerName, string vin, string registration);

    public static partial CustomerResponse ToResponse(CustomerDetails customer);

    [MapperIgnoreTarget(nameof(VehicleResponse.Profile))]
    public static partial VehicleResponse ToResponse(VehicleDetails vehicle);

    [MapProperty(nameof(ServiceType.Duration), nameof(ServiceTypeSummary.DurationMinutes), Use = nameof(MapDuration))]
    public static partial ServiceTypeSummary ToSummary(ServiceType serviceType);

    public static partial ResourceSummary ToSummary(ServiceBay bay);

    public static partial ResourceSummary ToSummary(Technician technician);

    private static string MapVin(Vin vin) => vin.Value;

    private static int MapDuration(ServiceDuration duration) => duration.Minutes;
}
