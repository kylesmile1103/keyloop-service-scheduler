using System.ComponentModel;
using Keyloop.ServiceScheduler.Api.Common.Endpoints;
using Keyloop.ServiceScheduler.Api.Common.OpenApi;
using Keyloop.ServiceScheduler.Api.Common.Validation;
using Keyloop.ServiceScheduler.Api.Features.Admin.Shared;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;

namespace Keyloop.ServiceScheduler.Api.Features.Admin.History;

public sealed class GetAdminHistoryEndpoint : IEndpoint
{
    public static void Map(IEndpointRouteBuilder app) => app.MapGet("/dealerships/{dealershipId:guid}/admin-history", HandleAsync)
        .AdminRead("GetAdminHistory").Produces<AdminHistoryResponse>(200).ProducesValidationProblem();

    /// <summary>Read Admin change history</summary>
    /// <response code="200">Newest changes, bounded snapshots and the next offset if there are more.</response>
    /// <response code="400">Invalid filters or pagination, validation-error.</response>
    /// <response code="401">Sign-in required, unauthenticated.</response>
    /// <response code="403">Admin role required, forbidden.</response>
    /// <response code="404">Unknown dealership or resource, not-found.</response>
    /// <response code="429">Rate limited; retry after Retry-After seconds.</response>
    internal static async Task<Ok<AdminHistoryResponse>> HandleAsync(Guid dealershipId, string? resourceKind, Guid? resourceId,
        int? offset, int? limit, [FromServices] AdminHistoryHandler handler, HttpContext http, CancellationToken ct)
    {
        http.Response.Headers.CacheControl = "private, no-store";
        return TypedResults.Ok(await handler.ReadAsync(dealershipId, resourceKind, resourceId, offset, limit, ct));
    }
}
