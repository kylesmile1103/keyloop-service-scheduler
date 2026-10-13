using Keyloop.ServiceScheduler.Api.Common.Endpoints;
using Keyloop.ServiceScheduler.Api.Common.Http;
using Keyloop.ServiceScheduler.Api.Common.OpenApi;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Mvc;

namespace Keyloop.ServiceScheduler.Api.Features.Triage.GetBookingTriageStatus;

public sealed class GetBookingTriageStatusEndpoint : IEndpoint
{
    public static void Map(IEndpointRouteBuilder app) => app.MapGet("/booking-triage", Handle)
        .WithName("GetBookingTriageStatus").WithTags(ApiTags.Catalog).AllowAnonymous()
        .Produces<BookingTriageStatusResponse>().ProducesRateLimitedProblem();

    /// <summary>Discover whether booking intake suggestions are enabled</summary>
    /// <remarks>Use the feature flag and description limit to display the optional intake control.</remarks>
    /// <param name="handler">Reads non-secret triage settings.</param>
    /// <response code="200">Feature flag, configured model, provider attribution and description limit.</response>
    /// <response code="429">Too many requests from this client (rate-limited, with Retry-After).</response>
    internal static Ok<BookingTriageStatusResponse> Handle([FromServices] GetBookingTriageStatusHandler handler) => TypedResults.Ok(handler.Handle());
}
