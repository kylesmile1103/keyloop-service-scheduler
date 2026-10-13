using System.ComponentModel;
using Keyloop.ServiceScheduler.Api.Common.Endpoints;
using Keyloop.ServiceScheduler.Api.Common.OpenApi;
using Keyloop.ServiceScheduler.Api.Common.Validation;
using Keyloop.ServiceScheduler.Api.Features.Admin.Shared;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;

namespace Keyloop.ServiceScheduler.Api.Features.Admin.Policies;

public sealed class EditRequirementPolicyEndpoint : IEndpoint
{
    public static void Map(IEndpointRouteBuilder app) =>
        app.MapPut("/dealerships/{dealershipId:guid}/requirement-policy", HandleAsync)
            .AdminWrite("EditRequirementPolicy", edit: true)
            .AddEndpointFilter<ValidationFilter<PolicyWriteRequest>>()
            .Produces<PolicyEditResponse>(200)
            .WithResponseHeader(200, "ETag", "Current policy version. A dry-run returns the unchanged version tag.");

    /// <summary>Preview or publish the next requirement policy</summary>
    /// <response code="200">Preview with saved false, or published version with saved true; changes describe roster bookability.</response>
    /// <response code="401">Sign-in required, unauthenticated.</response>
    /// <response code="403">Admin role required, forbidden.</response>
    /// <response code="404">Unknown dealership or resource, not-found.</response>
    /// <response code="429">Rate limited; retry after Retry-After seconds.</response>
    /// <response code="400">Invalid fields, validation-error with errors keyed by JSON path.</response>
    /// <response code="413">Body exceeds the 64 KiB limit.</response>
    /// <response code="412">Stale version, precondition-failed with current and currentETag.</response>
    /// <response code="428">If-Match required, precondition-required.</response>
    internal static async Task<Ok<PolicyEditResponse>> HandleAsync(Guid dealershipId, [Description("Typed replacement policy, dry-run flag and local preview date.")] PolicyWriteRequest request, [FromHeader(Name = "If-Match"), Description("Exactly one quoted policy version ETag from GetRequirementPolicy.")] string? ifMatch, [FromServices] AdminPolicyHandler handler, HttpContext http, CancellationToken ct)
    {
        var response = await handler.WriteAsync(dealershipId, request, ifMatch, ct);
        AdminEndpointConventions.ETag(http, AdminPreconditions.PolicyTag(response.Saved ? response.Policy.Version : response.Policy.Version - 1));
        return TypedResults.Ok(response);
    }
}
