using System.Security.Claims;
using Keyloop.ServiceScheduler.Api.Common.Authentication;
using Keyloop.ServiceScheduler.Api.Common.Contracts;
using Keyloop.ServiceScheduler.Api.Features.Appointments.Mapping;
using Keyloop.ServiceScheduler.Domain.Dealerships;

namespace Keyloop.ServiceScheduler.Api.Features.Appointments.ListAppointments;

internal static class ListAppointmentsResponseMapper
{
    /// <summary>A range item: summaries from the projected columns, local times in <paramref name="zone"/>, and the customer name,
    /// VIN and registration as <see cref="PersonalData"/> allows <paramref name="caller"/> to see them.</summary>
    internal static AppointmentListItemResponse Map(AppointmentListRow row, TimeZoneInfo zone, ClaimsPrincipal caller)
    {
        var visible = PersonalData.ForCaller(caller, row.CustomerName, row.Vin, row.Registration);
        return AppointmentMapper.ToListItem(row,
            new ServiceTypeSummary(row.ServiceTypeId, row.ServiceTypeCode, row.ServiceTypeName, row.ServiceTypeDuration.Minutes),
            new ResourceSummary(row.BayId, row.BayName), new ResourceSummary(row.TechnicianId, row.TechnicianName),
            LocalTimeConverter.FormatLocal(row.StartUtc, zone), LocalTimeConverter.FormatLocal(row.EndUtc, zone),
            visible.CustomerName, visible.Vin, visible.Registration);
    }
}
