using Keyloop.ServiceScheduler.Api.Common.Endpoints;
using Keyloop.ServiceScheduler.Api.Common.Http;
using Keyloop.ServiceScheduler.Api.Common.OpenApi;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;

namespace Keyloop.ServiceScheduler.Api.Features.Catalog.GetServiceTypes;

/// <summary><c>GET /api/v1/dealerships/{dealershipId}/service-types</c>.</summary>
public sealed class GetServiceTypesEndpoint : IEndpoint
{
    public static void Map(IEndpointRouteBuilder app) =>
        app.MapGet("/dealerships/{dealershipId:guid}/service-types", HandleAsync)
            .WithName("GetServiceTypes")
            .AllowAnonymous() // public read (ADR-027)
            .WithTags(ApiTags.Catalog)
            .Produces<IReadOnlyList<ServiceTypeResponse>>(StatusCodes.Status200OK)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesRateLimitedProblem();

    /// <summary>List the service catalogue for a dealership</summary>
    /// <remarks>
    /// The whole catalogue (service types are shared by all dealerships), ordered by name, with the bay capabilities and technician
    /// certifications each requires. <c>bookable</c> is computed for this dealership: at least one active bay and one active
    /// technician qualify. With vehicle-aware requirements on, at least one powertrain/class profile the dialog can submit qualifies
    /// under the latest dealership policy on today's dealership-local date, using inclusive HV expiry. This keeps a service selectable
    /// when an ICE declaration qualifies even though Unknown does not. Availability checks the chosen vehicle and appointment date;
    /// catalogue eligibility ignores busy time, opening hours and the booking window.
    /// </remarks>
    /// <param name="dealershipId">The dealership whose active bays and technicians decide <c>bookable</c>.</param>
    /// <param name="handler">Reads the catalogue and the dealership's resources.</param>
    /// <param name="cancellationToken">Cancelled when the client disconnects.</param>
    /// <response code="200">The catalogue, ordered by name, with <c>bookable</c> for this dealership.</response>
    /// <response code="404">No dealership has this id (<c>not-found</c>, with <c>resource</c> = <c>dealership</c> and the <c>id</c>).</response>
    /// <response code="429">Too many requests from this client (<c>rate-limited</c>, with <c>retryAfterSeconds</c> and <c>Retry-After</c>).</response>
    internal static async Task<Ok<IReadOnlyList<ServiceTypeResponse>>> HandleAsync(
        Guid dealershipId, [FromServices] GetServiceTypesHandler handler, CancellationToken cancellationToken) =>
        TypedResults.Ok(await handler.HandleAsync(dealershipId, cancellationToken));
}
