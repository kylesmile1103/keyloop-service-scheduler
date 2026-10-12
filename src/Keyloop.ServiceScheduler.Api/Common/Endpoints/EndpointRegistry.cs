using Keyloop.ServiceScheduler.Api.Features.Identity.GetCurrentUser;
using Keyloop.ServiceScheduler.Api.Features.Vehicles.ResolveVehicleProfile;
using Keyloop.ServiceScheduler.Api.Common.Options;
using Keyloop.ServiceScheduler.Api.Common.Problems;
using Keyloop.ServiceScheduler.Api.Features.Appointments.BookAppointment;
using Keyloop.ServiceScheduler.Api.Features.Appointments.CancelAppointment;
using Keyloop.ServiceScheduler.Api.Features.Appointments.GetAppointment;
using Keyloop.ServiceScheduler.Api.Features.Appointments.ListAppointments;
using Keyloop.ServiceScheduler.Api.Features.Availability.GetAvailability;
using Keyloop.ServiceScheduler.Api.Features.Catalog.GetServiceTypes;
using Keyloop.ServiceScheduler.Api.Features.Dealerships.GetDealerships;
using Keyloop.ServiceScheduler.Api.Features.Demo.ReseedDemoData;
using Keyloop.ServiceScheduler.Api.Features.Schedule.GetWorkshopSchedule;
using Keyloop.ServiceScheduler.Api.Features.Triage.GetBookingTriageStatus;
using Keyloop.ServiceScheduler.Api.Features.Triage.TriageBookingRequest;
using Keyloop.ServiceScheduler.Api.Features.Triage.UploadBookingTriageImage;
using Keyloop.ServiceScheduler.Infrastructure.Persistence;
using Microsoft.Extensions.Options;

namespace Keyloop.ServiceScheduler.Api.Common.Endpoints;

/// <summary>Every endpoint of the API, listed explicitly (ADR-016, Addendum A §A3): no assembly scanning or reflection-based discovery.</summary>
public static class EndpointRegistry
{
    public static IEndpointRouteBuilder MapSchedulerEndpoints(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);
        var group = app.MapGroup("/api/v1").WithGroupName("v1");

        // Each slice adds its line here (Tasks 8–12), in API order.
        GetDealershipsEndpoint.Map(group);
        GetServiceTypesEndpoint.Map(group);
        GetAvailabilityEndpoint.Map(group);
        BookAppointmentEndpoint.Map(group);
        GetAppointmentEndpoint.Map(group);
        CancelAppointmentEndpoint.Map(group);
        GetWorkshopScheduleEndpoint.Map(group);
        GetBookingTriageStatusEndpoint.Map(group);
        TriageBookingEndpoint.Map(group);
        UploadBookingTriageImageEndpoint.Map(group);
        ListAppointmentsEndpoint.Map(group);
        GetCurrentUserEndpoint.Map(group);
        ResolveVehicleProfileEndpoint.Map(group);

        // Demo tooling, outside the contract: only where demo data is seeded and the AppHost supplied a key (Addendum C §C3).
        var database = app.Services.GetRequiredService<IOptions<DatabaseOptions>>().Value;
        if (app.Services.GetRequiredService<IOptions<DemoOptions>>().Value.ReseedEnabled(database))
        {
            ReseedDemoDataEndpoint.Map(group);
        }

        if (app.Environment.IsEnvironment("SystemTest"))
        {
            ProblemProbeEndpoint.Map(group);
        }

        return app;
    }
}
