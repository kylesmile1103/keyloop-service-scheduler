using Keyloop.ServiceScheduler.Api.Common.Endpoints;
using Keyloop.ServiceScheduler.Api.Common.Http;
using Keyloop.ServiceScheduler.Api.Common.OpenApi;
using Keyloop.ServiceScheduler.Api.Common.Validation;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;

namespace Keyloop.ServiceScheduler.Api.Features.Schedule.GetWorkshopSchedule;

/// <summary><c>GET /api/v1/dealerships/{dealershipId}/schedule?date=</c>: the dispatch board's read model.</summary>
public sealed class GetWorkshopScheduleEndpoint : IEndpoint
{
    public static void Map(IEndpointRouteBuilder app) =>
        app.MapGet("/dealerships/{dealershipId:guid}/schedule", HandleAsync)
            .WithName("GetWorkshopSchedule")
            .AllowAnonymous() // public read; personal data is masked without a role (ADR-027)
            .WithTags(ApiTags.Schedule)
            .AddEndpointFilter<ValidationFilter<GetWorkshopScheduleQuery>>()
            .Produces<WorkshopScheduleResponse>(StatusCodes.Status200OK)
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesRateLimitedProblem();

    // The dealershipId and date <param> tags document the operation's parameters, which [AsParameters] flattens out of the query
    // record: the OpenAPI XML-comment generator matches <param> to operation parameters by name (its only source of descriptions and
    // examples for them), while the compiler knows only the method's own parameters and reports CS1572.
#pragma warning disable CS1572
    /// <summary>Get the workshop schedule for a date</summary>
    /// <remarks>
    /// The dispatch board for one dealership and local date: every bay (ordered by name) with the appointments it hosts that day, and
    /// every technician (ordered by name). Inactive bays and technicians are listed and flagged, so that appointments they already hold
    /// stay visible. An appointment is on the board when it overlaps the opening hours and is not cancelled: confirmed, checked in and
    /// in progress ones hold their bay and technician, completed and no-show ones are the day's history. A closed day has no
    /// <c>operatingWindow</c> and no appointments, and keeps its lanes. Local times carry the zone's offset (<c>2026-10-13T10:00+01:00</c>).
    /// Admin, ServiceAdvisor and Viewer receive full customer names, VINs and registrations; every other caller receives them masked:
    /// customer initials, the VIN's last six characters and a fully masked registration.
    /// Any well-formed date can be read, past or future. The answer is a snapshot; booking checks again.
    /// </remarks>
    /// <param name="query">The route and query parameters below, bound together and validated before the handler runs.</param>
    /// <param name="dealershipId" example="45fa64a1-baa9-8c61-b11a-ee9d7572ae3e">The dealership whose board is read (the example is the seeded Reading dealership).</param>
    /// <param name="date" example="2026-10-13">The dealership's local calendar date, exactly <c>yyyy-MM-dd</c>.</param>
    /// <param name="httpContext">The caller determines full or masked personal data.</param>
    /// <param name="handler">Reads the dealership-day.</param>
    /// <param name="cancellationToken">Cancelled when the client disconnects.</param>
    /// <response code="200">The board: the dealership, the operating window (null when closed), the slot grid, the bays with their appointments ordered by start, and the technicians.</response>
    /// <response code="400">The date is missing or not a calendar date in the form <c>yyyy-MM-dd</c> (<c>validation-error</c>, <c>errors</c> keyed <c>date</c>).</response>
    /// <response code="404">No dealership has this id (<c>not-found</c>, with <c>resource</c> = <c>dealership</c> and the <c>id</c>).</response>
    /// <response code="429">Too many requests from this client (<c>rate-limited</c>, with <c>retryAfterSeconds</c> and <c>Retry-After</c>).</response>
    internal static async Task<Ok<WorkshopScheduleResponse>> HandleAsync(
        [AsParameters] GetWorkshopScheduleQuery query, HttpContext httpContext, [FromServices] GetWorkshopScheduleHandler handler, CancellationToken cancellationToken) =>
        TypedResults.Ok(await handler.HandleAsync(query, httpContext.User, cancellationToken));
#pragma warning restore CS1572
}
