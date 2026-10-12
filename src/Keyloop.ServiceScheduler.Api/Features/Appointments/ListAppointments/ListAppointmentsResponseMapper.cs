using System.Security.Claims;
using Keyloop.ServiceScheduler.Api.Features.Appointments.Mapping;
using Keyloop.ServiceScheduler.Domain.Dealerships;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.ListAppointments;

internal static class ListAppointmentsResponseMapper
{
    internal static AppointmentListItemResponse Map(AppointmentListRow row, TimeZoneInfo zone, ClaimsPrincipal caller)
    {
        var (customerName, vin) = CustomerAndVinForCaller(caller, row.CustomerName, row.Vin.Value);
        return AppointmentMapper.ToListItem(row,
            AppointmentMapper.ToSummary(row.ServiceType), AppointmentMapper.ToSummary(row.Bay), AppointmentMapper.ToSummary(row.Technician),
            LocalTimeConverter.FormatLocal(row.StartUtc, zone), LocalTimeConverter.FormatLocal(row.EndUtc, zone), customerName, vin);
    }

    /// <summary>The single audience-policy seam for the range read's customer name and VIN.</summary>
    private static (string CustomerName, string Vin) CustomerAndVinForCaller(ClaimsPrincipal caller, string customerName, string vin)
    {
        return Common.Authentication.PersonalData.ForCaller(caller, customerName, vin);
    }
}
