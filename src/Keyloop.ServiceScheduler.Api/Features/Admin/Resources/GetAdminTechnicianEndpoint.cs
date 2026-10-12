using System.ComponentModel;
using Keyloop.ServiceScheduler.Api.Common.Endpoints;
using Keyloop.ServiceScheduler.Api.Common.OpenApi;
using Keyloop.ServiceScheduler.Api.Common.Validation;
using Keyloop.ServiceScheduler.Api.Features.Admin.Shared;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;

namespace Keyloop.ServiceScheduler.Api.Features.Admin.Resources;

public sealed class GetAdminTechnicianEndpoint : IEndpoint
{
    public static void Map(IEndpointRouteBuilder app) =>
        app.MapGet("/dealerships/{dealershipId:guid}/technicians/{technicianId:guid}", HandleAsync)
            .AdminRead("GetAdminTechnician")
            .Produces<AdminTechnicianResponse>(200)
            .WithResponseHeader(200, "ETag", "Strong xmin version; echo in If-Match for an edit.");

    /// <summary>Get a technician for editing</summary>
    /// <response code="200">Current Admin representation.</response>
    /// <response code="401">Sign-in required, unauthenticated.</response>
    /// <response code="403">Admin role required, forbidden.</response>
    /// <response code="404">Unknown dealership or resource, not-found.</response>
    /// <response code="429">Rate limited; retry after Retry-After seconds.</response>
    internal static async Task<Ok<AdminTechnicianResponse>> HandleAsync(
        Guid dealershipId, Guid technicianId, [FromServices] AdminResourcesHandler handler, HttpContext http, CancellationToken ct)
    {
        var response = await handler.GetTechnicianAsync(dealershipId, technicianId, ct);
        AdminEndpointConventions.ETag(http, AdminPreconditions.ResourceTag(response.Version));
        return TypedResults.Ok(response);
    }
}
