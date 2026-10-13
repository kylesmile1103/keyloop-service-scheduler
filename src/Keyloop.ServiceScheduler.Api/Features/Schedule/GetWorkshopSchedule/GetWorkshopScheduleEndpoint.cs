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
            .AllowAnonymous()
            .WithTags(ApiTags.Schedule)
            .AddEndpointFilter<ValidationFilter<GetWorkshopScheduleQuery>>()
            .Produces<WorkshopScheduleResponse>(StatusCodes.Status200OK)
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesRateLimitedProblem();

#pragma warning disable CS1572
    /// <summary>Get the workshop schedule for a date</summary>
    /// <remarks>
    /// Returns the workshop dispatch board for a dealership and local date, including all bays with non-cancelled appointments and all technicians.
    /// Callers with Admin, ServiceAdvisor, or Viewer receive full customer names, VINs, and registrations; other callers receive masked values (<c>ALS</c>, <c>***********123456</c>, and <c>*******</c>).
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
