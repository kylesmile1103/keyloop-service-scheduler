using System.ComponentModel;
using Keyloop.ServiceScheduler.Api.Common.Endpoints;
using Keyloop.ServiceScheduler.Api.Common.OpenApi;
using Keyloop.ServiceScheduler.Api.Common.Validation;
using Keyloop.ServiceScheduler.Api.Features.Admin.Shared;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;

namespace Keyloop.ServiceScheduler.Api.Features.Admin.Policies;

public sealed class GetRequirementPolicyEndpoint : IEndpoint
{
    public static void Map(IEndpointRouteBuilder app) =>
        app.MapGet("/dealerships/{dealershipId:guid}/requirement-policy", HandleAsync)
            .AdminRead("GetRequirementPolicy")
            .Produces<AdminPolicyResponse>(200)
            .WithResponseHeader(200, "ETag", "Current policy version, quoted policy-{version}; send it in If-Match to preview or publish.");

    /// <summary>Get the dealership requirement policy</summary>
    /// <response code="200">Current policy and ordered typed rules.</response>
    /// <response code="401">Sign-in required, unauthenticated.</response>
    /// <response code="403">Admin role required, forbidden.</response>
    /// <response code="404">Unknown dealership or resource, not-found.</response>
    /// <response code="429">Rate limited; retry after Retry-After seconds.</response>
    internal static async Task<Ok<AdminPolicyResponse>> HandleAsync(Guid dealershipId, [FromServices] AdminPolicyHandler handler, HttpContext http, CancellationToken ct)
    {
        var response = await handler.GetAsync(dealershipId, ct);
        AdminEndpointConventions.ETag(http, AdminPreconditions.PolicyTag(response.Version));
        return TypedResults.Ok(response);
    }
}
