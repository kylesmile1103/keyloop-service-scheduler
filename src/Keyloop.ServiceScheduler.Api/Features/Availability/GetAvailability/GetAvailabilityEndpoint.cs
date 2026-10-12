using Keyloop.ServiceScheduler.Api.Common.Endpoints;
using Keyloop.ServiceScheduler.Api.Common.Http;
using Keyloop.ServiceScheduler.Api.Common.OpenApi;
using Keyloop.ServiceScheduler.Api.Common.Validation;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;

namespace Keyloop.ServiceScheduler.Api.Features.Availability.GetAvailability;

/// <summary><c>GET /api/v1/dealerships/{dealershipId}/availability?serviceTypeId=&amp;date=</c>.</summary>
public sealed class GetAvailabilityEndpoint : IEndpoint
{
    public static void Map(IEndpointRouteBuilder app) =>
        app.MapGet("/dealerships/{dealershipId:guid}/availability", HandleAsync)
            .WithName("GetAvailability")
            .AllowAnonymous() // public read (ADR-027)
            .WithTags(ApiTags.Availability)
            .AddEndpointFilter<ValidationFilter<GetAvailabilityQuery>>()
            .Produces<AvailabilityResponse>(StatusCodes.Status200OK)
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesRateLimitedProblem();

    // The dealershipId, serviceTypeId and date <param> tags document the operation's parameters, which [AsParameters] flattens out
    // of the query record: the OpenAPI XML-comment generator matches <param> to operation parameters by name (its only source of
    // descriptions and examples for them), while the compiler knows only the method's own parameters and reports CS1572.
#pragma warning disable CS1572
    /// <summary>Find bookable start times for a service on a date</summary>
    /// <remarks>
    /// Start times on the slot grid, counted from opening, at which one active bay with every capability the service requires and one
    /// active technician with every certification it requires are both free for the whole duration, with how many of each are free.
    /// A closed day has no slots and <c>unavailableReason</c> <c>closed</c>; a service the dealership can never perform has
    /// <c>no-qualified-resources</c>. A service longer than that day's opening hours, and opening hours that fall entirely in a
    /// daylight-saving gap (a zero-length window), give no slots and no reason. Local times carry the zone's offset
    /// (<c>2026-10-13T10:00+01:00</c>). The answer is a snapshot; booking checks again.
    /// </remarks>
    /// <param name="query">The route and query parameters below, bound together and validated before the handler runs.</param>
    /// <param name="dealershipId" example="45fa64a1-baa9-8c61-b11a-ee9d7572ae3e">The dealership whose bays, technicians and opening hours are used (the example is the seeded Reading dealership).</param>
    /// <param name="serviceTypeId" example="3153f30d-5700-8f07-a25d-4a4ea44dfeef">The service to fit (the example is the seeded Interim Service).</param>
    /// <param name="date" example="2026-10-13">The dealership's local calendar date, exactly <c>yyyy-MM-dd</c>, from yesterday to the end of the booking horizon.</param>
    /// <param name="powertrain" example="BatteryElectric">Optional powertrain; omitted is conservatively Unknown with vehicle-aware requirements enabled.</param>
    /// <param name="manufacturer" example="VOLKSWAGEN">Optional OEM code; manufacturer preferences are deferred.</param>
    /// <param name="vehicleClass" example="Heavy">Optional class; Heavy requires a heavy lift and HeavyVehicle certification.</param>
    /// <param name="needsLiveDiagnosis" example="false">Explicit live HV work requiring level 4 and an EV bay.</param>
    /// <param name="handler">Computes availability.</param>
    /// <param name="cancellationToken">Cancelled when the client disconnects.</param>
    /// <response code="200">The operating window and the bookable starts in ascending order with free bay and technician counts; no starts, and a reason when the day can have none.</response>
    /// <response code="400">The service type id or the date is missing or malformed, or the date is outside the bookable range (<c>validation-error</c>, <c>errors</c> keyed <c>serviceTypeId</c> or <c>date</c>).</response>
    /// <response code="404">No dealership or no service type has this id (<c>not-found</c>, with <c>resource</c> = <c>dealership</c> or <c>service-type</c> and the <c>id</c>).</response>
    /// <response code="429">Too many requests from this client (<c>rate-limited</c>, with <c>retryAfterSeconds</c> and <c>Retry-After</c>).</response>
    internal static async Task<Ok<AvailabilityResponse>> HandleAsync(
        [AsParameters] GetAvailabilityQuery query, [FromServices] GetAvailabilityHandler handler, CancellationToken cancellationToken) =>
        TypedResults.Ok(await handler.HandleAsync(query, cancellationToken));
#pragma warning restore CS1572
}
