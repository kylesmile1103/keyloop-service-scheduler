using System.ComponentModel;
using Keyloop.ServiceScheduler.Api.Common.Endpoints;
using Keyloop.ServiceScheduler.Api.Common.OpenApi;
using Keyloop.ServiceScheduler.Api.Common.Validation;
using Keyloop.ServiceScheduler.Api.Features.Admin.Shared;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;

namespace Keyloop.ServiceScheduler.Api.Features.Admin.Resources;

public sealed class ListAdminBaysEndpoint : IEndpoint
{
    public static void Map(IEndpointRouteBuilder app) =>
        app.MapGet("/dealerships/{dealershipId:guid}/bays", HandleAsync)
            .AdminRead("ListAdminBays")
            .Produces<IReadOnlyList<AdminBayResponse>>(200);

    /// <summary>List dealership bays for administration</summary>
    /// <response code="200">Current Admin representation.</response>
    /// <response code="401">Sign-in required, unauthenticated.</response>
    /// <response code="403">Admin role required, forbidden.</response>
    /// <response code="404">Unknown dealership or resource, not-found.</response>
    /// <response code="429">Rate limited; retry after Retry-After seconds.</response>
    internal static async Task<Ok<IReadOnlyList<AdminBayResponse>>> HandleAsync(
        Guid dealershipId, [FromServices] AdminResourcesHandler handler, HttpContext http, CancellationToken ct)
    {
        var response = await handler.ListBaysAsync(dealershipId, ct);
        http.Response.Headers.CacheControl = "private, no-store";
        return TypedResults.Ok(response);
    }
}
