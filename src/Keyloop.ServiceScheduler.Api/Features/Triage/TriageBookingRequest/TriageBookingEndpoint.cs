using Keyloop.ServiceScheduler.Api.Common.Authentication;
using System.ComponentModel;
using Keyloop.ServiceScheduler.Api.Common.Endpoints;
using Keyloop.ServiceScheduler.Api.Common.Http;
using Keyloop.ServiceScheduler.Api.Common.OpenApi;
using Keyloop.ServiceScheduler.Api.Common.Validation;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Net.Http.Headers;
using Microsoft.OpenApi;

namespace Keyloop.ServiceScheduler.Api.Features.Triage.TriageBookingRequest;

public sealed class TriageBookingEndpoint : IEndpoint
{
    public static void Map(IEndpointRouteBuilder app) => app.MapPost("/dealerships/{dealershipId:guid}/booking-triage", HandleAsync)
        .WithName("TriageBookingRequest").WithTags(ApiTags.Catalog)
            .RequireAuthorization(SchedulerAuthentication.BookingsWrite)
            .ProducesProblem(StatusCodes.Status401Unauthorized)
            .ProducesProblem(StatusCodes.Status403Forbidden)
        .RequireRateLimiting(SchedulerRateLimiting.TriagePolicy)
        .AddEndpointFilter<TriageTelemetryFilter>()
        .AddEndpointFilter<ValidationFilter<TriageBookingRequest>>()
        .Produces<TriageBookingResponse>().ProducesValidationProblem().ProducesProblem(StatusCodes.Status404NotFound)
        .ProducesRateLimitedProblem().ProducesProblem(StatusCodes.Status503ServiceUnavailable)
        .WithResponseHeader(StatusCodes.Status503ServiceUnavailable, HeaderNames.RetryAfter,
            "Whole seconds to wait when the upstream supplied Retry-After.", type: JsonSchemaType.Integer);

    /// <summary>Suggest bookable services, an optional preferred date and a closed uncovered-issue category from an intake description</summary>
    /// <remarks>A person must confirm a suggestion before asking for availability and booking. No description is stored.</remarks>
    /// <param name="dealershipId">Dealership whose active resources and local dates bound the choices.</param>
    /// <param name="request">The booking intake description.</param>
    /// <param name="handler">Evaluates the closed catalogue through Clef.</param>
    /// <param name="cancellationToken">Cancelled when the client disconnects.</param>
    /// <response code="200">Model, recommendation, service confidence, up to three candidates, an optional local date and an optional uncovered issue with a closed category.</response>
    /// <response code="400">Description is missing, blank or over the limit (validation-error).</response>
    /// <response code="404">No dealership has this id (not-found).</response>
    /// <response code="401">Sign-in required (<c>unauthenticated</c>, with <c>loginUrl</c>).</response>
    /// <response code="403">The caller's role does not permit this operation (<c>forbidden</c>).</response>
    /// <response code="429">Too many triage requests from this client (rate-limited, with Retry-After).</response>
    /// <response code="503">Suggestions are disabled or the upstream is unavailable or invalid (triage-unavailable); use manual service selection. Retry-After is preserved when supplied upstream.</response>
    internal static async Task<Ok<TriageBookingResponse>> HandleAsync(Guid dealershipId,
        [Description("The booking intake: the customer's issue and optional preferred date, as untrusted text.")] TriageBookingRequest request,
        [FromServices] TriageBookingHandler handler, CancellationToken cancellationToken) =>
        TypedResults.Ok(await handler.HandleAsync(dealershipId, request, cancellationToken));
}
