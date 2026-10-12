using System.ComponentModel;
using Keyloop.ServiceScheduler.Api.Common.Endpoints;
using Keyloop.ServiceScheduler.Api.Common.OpenApi;
using Keyloop.ServiceScheduler.Api.Common.Validation;
using Keyloop.ServiceScheduler.Api.Features.Admin.Shared;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;

namespace Keyloop.ServiceScheduler.Api.Features.Admin.Resources;

public sealed class CreateTechnicianEndpoint : IEndpoint
{
    public static void Map(IEndpointRouteBuilder app) =>
        app.MapPost("/dealerships/{dealershipId:guid}/technicians", HandleAsync)
            .AdminWrite("CreateTechnician", edit: false)
            .AddEndpointFilter<ValidationFilter<TechnicianWriteRequest>>()
            .Produces<AdminTechnicianResponse>(201)
            .WithResponseHeader(201, "ETag", "Strong xmin version; echo in If-Match for an edit.")
            .WithResponseHeader(201, "Location", "Path of the created technician's Admin read.", "uri-reference");

    /// <summary>Create a technician</summary>
    /// <response code="201">Created resource; Location points at its Admin read.</response>
    /// <response code="401">Sign-in required, unauthenticated.</response>
    /// <response code="403">Admin role required, forbidden.</response>
    /// <response code="404">Unknown dealership or resource, not-found.</response>
    /// <response code="429">Rate limited; retry after Retry-After seconds.</response>
    /// <response code="400">Invalid fields, validation-error with errors keyed by JSON path.</response>
    /// <response code="413">Body exceeds the 64 KiB limit.</response>
    internal static async Task<Created<AdminTechnicianResponse>> HandleAsync(
        Guid dealershipId, [Description("Complete technician state. Existing appointments are preserved.")] TechnicianWriteRequest request, [FromServices] AdminResourcesHandler handler, HttpContext http, CancellationToken ct)
    {
        var response = await handler.WriteTechnicianAsync(dealershipId, null, request, null, ct);
        AdminEndpointConventions.ETag(http, AdminPreconditions.ResourceTag(response.Version));
        return TypedResults.Created($"/api/v1/dealerships/{dealershipId}/technicians/{response.Id}", response);
    }
}
