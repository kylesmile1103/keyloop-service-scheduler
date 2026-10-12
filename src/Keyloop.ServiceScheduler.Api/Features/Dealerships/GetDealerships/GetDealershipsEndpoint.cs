using Keyloop.ServiceScheduler.Api.Common.Endpoints;
using Keyloop.ServiceScheduler.Api.Common.Http;
using Keyloop.ServiceScheduler.Api.Common.OpenApi;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;

namespace Keyloop.ServiceScheduler.Api.Features.Dealerships.GetDealerships;

/// <summary><c>GET /api/v1/dealerships</c>.</summary>
public sealed class GetDealershipsEndpoint : IEndpoint
{
    public static void Map(IEndpointRouteBuilder app) =>
        app.MapGet("/dealerships", HandleAsync)
            .WithName("GetDealerships")
            .AllowAnonymous() // public read (ADR-027)
            .WithTags(ApiTags.Dealerships)
            .Produces<IReadOnlyList<DealershipResponse>>(StatusCodes.Status200OK)
            .ProducesRateLimitedProblem();

    /// <summary>List dealerships</summary>
    /// <remarks>
    /// Every dealership with its IANA time zone and weekly operating hours as local wall-clock times, ordered by name. Start here:
    /// the catalogue, availability, booking and schedule routes are all scoped by a dealership id.
    /// </remarks>
    /// <param name="handler">Reads the dealerships.</param>
    /// <param name="cancellationToken">Cancelled when the client disconnects.</param>
    /// <response code="200">The dealerships, ordered by name, each with seven days of operating hours from Monday.</response>
    /// <response code="429">Too many requests from this client (<c>rate-limited</c>, with <c>retryAfterSeconds</c> and <c>Retry-After</c>).</response>
    internal static async Task<Ok<IReadOnlyList<DealershipResponse>>> HandleAsync(
        [FromServices] GetDealershipsHandler handler, CancellationToken cancellationToken) =>
        TypedResults.Ok(await handler.HandleAsync(cancellationToken));
}
