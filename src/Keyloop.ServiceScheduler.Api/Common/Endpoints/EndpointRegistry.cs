using Keyloop.ServiceScheduler.Api.Features.Customers.FindReturningCustomers;
using Keyloop.ServiceScheduler.Api.Features.Admin.Resources;
using Keyloop.ServiceScheduler.Api.Features.Admin.Policies;
using Keyloop.ServiceScheduler.Api.Features.Admin.History;
using Keyloop.ServiceScheduler.Api.Features.Identity.GetCurrentUser;
using Keyloop.ServiceScheduler.Api.Features.FeatureSwitches.GetFeatures;
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

/// <summary>Maps all <c>/api/v1</c> endpoints explicitly.</summary>
public static class EndpointRegistry
{
    public static IEndpointRouteBuilder MapSchedulerEndpoints(this WebApplication app)
    {
        ArgumentNullException.ThrowIfNull(app);
        var group = app.MapGroup("/api/v1").WithGroupName("v1");

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
        GetFeaturesEndpoint.Map(group);
        ListAdminTechniciansEndpoint.Map(group);
        GetAdminTechnicianEndpoint.Map(group);
        CreateTechnicianEndpoint.Map(group);
        EditTechnicianEndpoint.Map(group);
        ConfirmTechnicianHvLevelEndpoint.Map(group);
        ListAdminBaysEndpoint.Map(group);
        GetAdminBayEndpoint.Map(group);
        CreateBayEndpoint.Map(group);
        EditBayEndpoint.Map(group);
        GetRequirementPolicyEndpoint.Map(group);
        EditRequirementPolicyEndpoint.Map(group);
        GetAdminHistoryEndpoint.Map(group);
        FindReturningCustomersEndpoint.Map(group);

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
